import fs from 'fs';
import path from 'path';
import { prisma } from '@/database/client';
import {
    AgentContext,
    AgentResult,
    DocumentData,
    GenerateRDARequest,
    RDAGenerationData,
    RDATemplateData,
    RDATemplateDocPayload,
    WikiPageData,
} from '@/types/rda.types';
import { logger } from '@/utils/logger';
import { AgentOrchestrator } from '@/services/agents/orchestrator';
import { DocxGeneratorService } from '@/services/rda/docx-generator.service';
import { documentService } from '@/services/rda/document.service';
import { wikiService } from '@/services/rda/wiki.service';
import { RDA_TEMPLATES_DIR } from '@/services/rda/storage-paths';
import { templateContractService } from '@/services/rda/template-contract.service';
import { projectEvidencePackService } from '@/services/rda/project-evidence-pack.service';

interface FormatterResultData {
    replacements: Record<string, string>;
    templatePayload?: RDATemplateDocPayload;
    structuredData?: {
        projectName: string;
        periodStart: string;
        periodEnd: string;
        yearBase: string;
        competence: string;
        technicalCoordinator: string;
        activityName: string;
        activityDescription: string;
        activityJustification: string;
        activityResult: string;
    };
}

export class RDAService {
    private readonly staleProcessingMs: number;

    constructor(
        private readonly orchestrator = new AgentOrchestrator(),
        private readonly docxGenerator = new DocxGeneratorService(),
    ) {
        const staleMinutes = Number(process.env.RDA_STALE_PROCESSING_MINUTES ?? 20);
        this.staleProcessingMs = Number.isFinite(staleMinutes) && staleMinutes > 0 ? staleMinutes * 60 * 1000 : 20 * 60 * 1000;
    }

    async generateRDA(request: GenerateRDARequest): Promise<RDAGenerationData> {
        const resolvedTemplateId = await this.resolveTemplateId(request.templateId);
        const requestWithTemplate: GenerateRDARequest = {
            ...request,
            templateId: resolvedTemplateId,
        };

        await this.validateGenerateRequest(requestWithTemplate);
        const generation = await this.createGeneration(requestWithTemplate);
        void this.processGeneration(generation.id, requestWithTemplate);
        return generation;
    }

    private async validateGenerateRequest(request: GenerateRDARequest): Promise<void> {
        if (!request.templateId) {
            const error = new Error('Nenhum template ativo encontrado para gerar o RDA.');
            (error as Error & { statusCode?: number }).statusCode = 400;
            throw error;
        }

        const template = await this.getTemplateDelegate().findUnique({ where: { id: request.templateId } });
        if (!template) {
            const error = new Error('Template inválido ou inexistente. Selecione um template válido.');
            (error as Error & { statusCode?: number }).statusCode = 400;
            throw error;
        }
    }

    private async processGeneration(generationId: string, request: GenerateRDARequest): Promise<void> {
        try {
            if (!request.templateId) {
                throw new Error('Template nao resolvido para processamento da geracao.');
            }

            await this.runWikiPreflightSync(generationId, request.projectId, request.wikiPageIds);

            const template = await this.getTemplateById(request.templateId);
            const project = await this.getProjectById(request.projectId);
            const workItems = await this.getWorkItemsByPeriod(request.projectId, request.periodStart, request.periodEnd);
            const sprints = await this.getSprintsByPeriod(request.projectId, request.periodStart, request.periodEnd);
            const documents = await this.getDocuments(request.documentIds);
            const wikiPages = await this.getWikiPages(request.wikiPageIds);
            const evidencePack = projectEvidencePackService.build({
                projectId: project.id,
                projectName: project.name,
                periodStart: request.periodStart,
                periodEnd: request.periodEnd,
                periodType: request.periodType,
                workItems,
                sprints,
                wikiPages,
                documents,
            });

            const context: AgentContext = {
                generationId,
                request,
                template,
                workItems,
                sprints,
                documents,
                wikiPages,
                evidencePack,
                previousResults: [],
                totalTokensUsed: 0,
            };

            const results = await this.orchestrator.executeAgents(context);
            const formatter = this.findFormatterResult(results);

            await this.updateGeneration(generationId, {
                progress: 96,
                currentStep: 'generating_docx',
            });

            const templateBuffer = await this.docxGenerator.readTemplate(template.filePath);
            const renderedBuffer = await this.docxGenerator.replaceText(
                templateBuffer,
                formatter.replacements,
                formatter.templatePayload,
                formatter.structuredData,
            );
            const outputPath = this.docxGenerator.getDefaultOutputPath(generationId);
            const savedPath = await this.docxGenerator.save(renderedBuffer, outputPath);

            await this.updateGeneration(generationId, {
                status: 'completed',
                progress: 100,
                currentStep: 'completed',
                outputFilePath: savedPath,
                fileSize: renderedBuffer.length,
                tokensUsed: results.reduce((sum, result) => sum + result.tokensUsed, 0),
                partialResults: results,
            });

            logger.info('[RDAService] Geração concluída', {
                generationId,
                outputFilePath: savedPath,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.updateGeneration(generationId, {
                status: 'failed',
                progress: 100,
                currentStep: 'failed',
                errorMessage: message,
            });
            logger.error('[RDAService] Falha ao gerar RDA', {
                generationId,
                error: message,
            });
        }
    }

    async getRDAById(id: string): Promise<RDAGenerationData> {
        const generationDelegate = this.getGenerationDelegate();
        const generation = await generationDelegate.findUnique({ where: { id } });
        if (!generation) {
            throw new Error(`Geração de RDA não encontrada: ${id}`);
        }

        const freshGeneration = await this.markAsFailedIfStale(generation);
        return this.mapGeneration(freshGeneration);
    }

    async listRDAs(projectId: string): Promise<RDAGenerationData[]> {
        const generationDelegate = this.getGenerationDelegate();
        const list = await generationDelegate.findMany({
            where: { projectId },
            orderBy: { createdAt: 'desc' },
        });

        const refreshed = await Promise.all(list.map((item: unknown) => this.markAsFailedIfStale(item)));
        return refreshed.map((item: unknown) => this.mapGeneration(item));
    }

    async downloadRDA(id: string): Promise<Buffer> {
        const generation = await this.getRDAById(id);

        if (!generation.outputFilePath) {
            throw new Error('Arquivo ainda não foi gerado para este RDA.');
        }

        if (!fs.existsSync(generation.outputFilePath)) {
            throw new Error(`Arquivo gerado não encontrado: ${generation.outputFilePath}`);
        }

        return fs.readFileSync(generation.outputFilePath);
    }

    async cancelGeneration(id: string): Promise<void> {
        await this.updateGeneration(id, {
            status: 'cancelled',
            currentStep: 'cancelled',
        });
    }

    async retryGeneration(id: string): Promise<RDAGenerationData> {
        const oldGeneration = await this.getRDAById(id);

        const request: GenerateRDARequest = {
            projectId: oldGeneration.projectId,
            templateId: oldGeneration.templateId,
            periodType: oldGeneration.periodType,
            periodStart: oldGeneration.periodStart.toISOString().slice(0, 10),
            periodEnd: oldGeneration.periodEnd.toISOString().slice(0, 10),
            documentIds: [],
            wikiPageIds: [],
            generatedBy: oldGeneration.createdBy,
        };

        return this.generateRDA(request);
    }

    private async runWikiPreflightSync(generationId: string, projectId: string, wikiPageIds: string[]): Promise<void> {
        if (wikiPageIds.length === 0) {
            return;
        }

        await this.updateGeneration(generationId, {
            progress: 5,
            currentStep: 'syncing_wiki',
        });

        try {
            const result = await wikiService.syncWikiPages(projectId);
            logger.info('[RDAService] Preflight wiki sync concluído', {
                generationId,
                projectId,
                synced: result.synced,
                total: result.total,
            });
        } catch (error) {
            logger.warn('[RDAService] Preflight wiki sync falhou; seguindo com dados locais', {
                generationId,
                projectId,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        await this.updateGeneration(generationId, {
            progress: 8,
            currentStep: 'collecting_data',
        });
    }

    private async createGeneration(request: GenerateRDARequest): Promise<RDAGenerationData> {
        if (!request.templateId) {
            throw new Error('Template nao resolvido para criacao da geracao.');
        }

        const generation = await this.getGenerationDelegate().create({
            data: {
                projectId: request.projectId,
                templateId: request.templateId,
                status: 'processing',
                progress: 0,
                currentStep: 'starting',
                periodType: request.periodType,
                periodStart: new Date(request.periodStart),
                periodEnd: new Date(request.periodEnd),
                createdBy: request.generatedBy,
                tokensUsed: 0,
            },
        });

        return this.mapGeneration(generation);
    }

    private async updateGeneration(id: string, data: Record<string, unknown>): Promise<RDAGenerationData> {
        const updated = await this.getGenerationDelegate().update({
            where: { id },
            data,
        });

        return this.mapGeneration(updated);
    }

    private findFormatterResult(results: AgentResult[]): FormatterResultData {
        const formatter = results.find((result) => result.agentName === 'FormatterAgent');

        if (!formatter?.data) {
            throw new Error('Resultado do FormatterAgent não encontrado no pipeline.');
        }

        return formatter.data as FormatterResultData;
    }

    private async getTemplateById(id: string): Promise<RDATemplateData> {
        const template = await this.getTemplateDelegate().findUnique({ where: { id } });
        if (!template) {
            throw new Error(`Template não encontrado: ${id}`);
        }

        const value = template as {
            id: string;
            projectId: string;
            name: string;
            description?: string | null;
            filePath: string;
            placeholders?: string[];
            isActive: boolean;
            version?: number;
            createdAt?: Date;
            updatedAt?: Date;
        };

        const resolvedTemplatePath = await this.resolveTemplatePath(value.id, value.filePath);
        const templateContract = templateContractService.parseTemplateContract(resolvedTemplatePath);

        return {
            id: value.id,
            projectId: value.projectId,
            name: value.name,
            description: value.description,
            filePath: resolvedTemplatePath,
            placeholders: value.placeholders ?? [],
            templateContract,
            isActive: value.isActive,
            version: value.version,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt,
        };
    }

    private async resolveTemplatePath(templateId: string, currentPath: string): Promise<string> {
        if (currentPath && fs.existsSync(currentPath)) {
            return currentPath;
        }

        const fallbackPath = path.join(RDA_TEMPLATES_DIR, path.basename(currentPath || ''));
        if (fs.existsSync(fallbackPath)) {
            const prismaClient = prisma as unknown as {
                rDATemplate?: {
                    update: (args: { where: { id: string }; data: { filePath: string } }) => Promise<unknown>;
                };
            };

            await prismaClient.rDATemplate?.update({
                where: { id: templateId },
                data: { filePath: fallbackPath },
            });

            logger.warn('[RDAService] Caminho antigo de template corrigido automaticamente', {
                templateId,
                previousPath: currentPath,
                newPath: fallbackPath,
            });

            return fallbackPath;
        }

        throw new Error(`Template DOCX não encontrado: ${currentPath}. Faça upload novamente do template para este projeto.`);
    }

    private async getWorkItemsByPeriod(projectId: string, periodStart: string, periodEnd: string) {
        return prisma.workItem.findMany({
            where: {
                projectId,
                changedDate: {
                    gte: new Date(periodStart),
                    lte: new Date(periodEnd),
                },
                isRemoved: false,
            },
            orderBy: { changedDate: 'desc' },
        });
    }

    private async getProjectById(projectId: string): Promise<{ id: string; name: string }> {
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            select: { id: true, name: true },
        });

        if (!project) {
            throw new Error(`Projeto não encontrado: ${projectId}`);
        }

        return project;
    }

    private async getSprintsByPeriod(projectId: string, periodStart: string, periodEnd: string) {
        return prisma.sprint.findMany({
            where: {
                projectId,
                OR: [
                    {
                        startDate: {
                            gte: new Date(periodStart),
                            lte: new Date(periodEnd),
                        },
                    },
                    {
                        endDate: {
                            gte: new Date(periodStart),
                            lte: new Date(periodEnd),
                        },
                    },
                ],
            },
            orderBy: { startDate: 'asc' },
        });
    }

    private async getDocuments(documentIds: string[]): Promise<DocumentData[]> {
        if (documentIds.length === 0) {
            return [];
        }

        const documents = await Promise.all(documentIds.map((id) => documentService.getDocumentById(id)));
        return documents.filter((doc): doc is NonNullable<typeof doc> => Boolean(doc));
    }

    private async getWikiPages(wikiPageIds: string[]): Promise<WikiPageData[]> {
        if (wikiPageIds.length === 0) {
            return [];
        }

        const pages = await Promise.all(wikiPageIds.map((id) => wikiService.getWikiPageById(id)));
        return pages.filter((page): page is NonNullable<typeof page> => Boolean(page));
    }

    private getGenerationDelegate(): {
        create: (args: unknown) => Promise<unknown>;
        update: (args: unknown) => Promise<unknown>;
        findUnique: (args: unknown) => Promise<unknown | null>;
        findMany: (args: unknown) => Promise<unknown[]>;
    } {
        const prismaClient = prisma as unknown as {
            rDAGeneration?: {
                create: (args: unknown) => Promise<unknown>;
                update: (args: unknown) => Promise<unknown>;
                findUnique: (args: unknown) => Promise<unknown | null>;
                findMany: (args: unknown) => Promise<unknown[]>;
            };
        };

        if (!prismaClient.rDAGeneration) {
            throw new Error('Modelo RDAGeneration não está disponível no Prisma Client. Execute a migration da Fase 1/2.');
        }

        return prismaClient.rDAGeneration;
    }

    private getTemplateDelegate(): {
        findUnique: (args: unknown) => Promise<unknown | null>;
        findFirst: (args: unknown) => Promise<unknown | null>;
    } {
        const prismaClient = prisma as unknown as {
            rDATemplate?: {
                findUnique: (args: unknown) => Promise<unknown | null>;
                findFirst: (args: unknown) => Promise<unknown | null>;
            };
        };

        if (!prismaClient.rDATemplate) {
            throw new Error('Modelo RDATemplate não está disponível no Prisma Client. Execute a migration da Fase 1/2.');
        }

        return prismaClient.rDATemplate;
    }

    private async resolveTemplateId(templateId?: string): Promise<string> {
        if (templateId) {
            return templateId;
        }

        const activeTemplate = await this.getTemplateDelegate().findFirst({
            where: { isActive: true },
            orderBy: { updatedAt: 'desc' },
            select: { id: true },
        }) as { id: string } | null;

        if (!activeTemplate?.id) {
            const error = new Error('Nenhum template ativo global encontrado.');
            (error as Error & { statusCode?: number }).statusCode = 400;
            throw error;
        }

        return activeTemplate.id;
    }

    private async markAsFailedIfStale(raw: unknown): Promise<unknown> {
        const value = raw as {
            id?: string;
            status?: string;
            currentStep?: string | null;
            updatedAt?: Date | string;
        };

        if (!value?.id || value.status !== 'processing' || !value.updatedAt) {
            return raw;
        }

        const updatedAt = value.updatedAt instanceof Date ? value.updatedAt : new Date(value.updatedAt);
        const ageMs = Date.now() - updatedAt.getTime();
        if (!Number.isFinite(ageMs) || ageMs < this.staleProcessingMs) {
            return raw;
        }

        logger.warn('[RDAService] Geração stale detectada, marcando como failed', {
            generationId: value.id,
            currentStep: value.currentStep ?? null,
            updatedAt: updatedAt.toISOString(),
            staleAgeMs: ageMs,
            staleThresholdMs: this.staleProcessingMs,
        });

        return this.getGenerationDelegate().update({
            where: { id: value.id },
            data: {
                status: 'failed',
                progress: 100,
                currentStep: 'failed',
                errorMessage:
                    'Processamento interrompido por reinício/instabilidade do serviço. Clique em "Tentar novamente" para gerar um novo RDA.',
            },
        });
    }

    private mapGeneration(raw: unknown): RDAGenerationData {
        const value = raw as {
            id: string;
            projectId: string;
            templateId: string;
            status: RDAGenerationData['status'];
            progress: number;
            currentStep?: string | null;
            periodType: RDAGenerationData['periodType'];
            periodStart: Date;
            periodEnd: Date;
            outputFilePath?: string | null;
            fileSize?: number | null;
            tokensUsed?: number | null;
            errorMessage?: string | null;
            partialResults?: unknown;
            createdBy: string;
            createdAt: Date;
            updatedAt: Date;
        };

        return {
            id: value.id,
            projectId: value.projectId,
            templateId: value.templateId,
            status: value.status,
            progress: value.progress,
            currentStep: value.currentStep,
            periodType: value.periodType,
            periodStart: value.periodStart,
            periodEnd: value.periodEnd,
            outputFilePath: value.outputFilePath,
            fileSize: value.fileSize,
            tokensUsed: value.tokensUsed,
            errorMessage: value.errorMessage,
            partialResults: value.partialResults,
            createdBy: value.createdBy,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt,
        };
    }
}

export const rdaService = new RDAService();



