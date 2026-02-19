import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/database/client';
import { RDA_TEMPLATES_DIR, RDA_TEMPLATE_FACTORY_ANALYSES_DIR } from '@/services/rda/storage-paths';
import {
    PlaceholderDefinition,
    RDAOutputSchema,
    TemplateAnalysisResult,
    templateAnalysisResultSchema,
} from '@/modules/rda/schemas/template-factory.schema';
import { TemplateExtractorService, templateExtractorService } from '@/modules/rda/services/template-extractor.service';
import { TemplateAnalyzerService, templateAnalyzerService } from '@/modules/rda/services/template-analyzer.service';
import { TemplateBuilderService, templateBuilderService } from '@/modules/rda/services/template-builder.service';

interface StoredAnalysis {
    id: string;
    projectId?: string;
    filenames: string[];
    filePaths: string[];
    structures: Array<{ filename: string; elements: number }>;
    analysis: TemplateAnalysisResult;
    createdAt: Date;
    status: 'ready' | 'expired';
}

interface CreateTemplateResult {
    templateId: string;
    schemaId: string;
    placeholders: PlaceholderDefinition[];
    validationResult: { valid: boolean; errors: string[] };
}

export class TemplateFactoryService {
    constructor(
        private readonly extractorService: TemplateExtractorService,
        private readonly analyzerService: TemplateAnalyzerService,
        private readonly builderService: TemplateBuilderService,
    ) {}

    async analyzeModels(
        files: Buffer[],
        filenames: string[],
        projectId?: string,
    ): Promise<StoredAnalysis> {
        if (files.length < 2 || files.length > 5) {
            throw new Error('Envie entre 2 e 5 arquivos DOCX para analise.');
        }

        const structures = await Promise.all(
            files.map(async (file, index) => {
                const structure = await this.extractorService.extractStructure(file);
                return {
                    ...structure,
                    filename: filenames[index] ?? `modelo-${index + 1}.docx`,
                };
            }),
        );

        const analysis = await this.analyzerService.analyzeModels(structures);
        let normalizedPlaceholders: PlaceholderDefinition[] = [];
        try {
            normalizedPlaceholders = await this.analyzerService.generatePlaceholderMap(analysis);
        } catch (error) {
            console.warn('[TemplateFactory] Falha ao normalizar placeholders via IA. Usando placeholders da analise.', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        if (!Array.isArray(normalizedPlaceholders) || normalizedPlaceholders.length === 0) {
            normalizedPlaceholders = analysis.globalPlaceholders;
        }
        const hydratedAnalysis: TemplateAnalysisResult = {
            ...analysis,
            globalPlaceholders: normalizedPlaceholders,
        };

        const id = randomUUID();
        const persistedFiles = this.persistAnalysisFiles(id, files, filenames);

        const created = await prisma.rDATemplateFactoryAnalysis.create({
            data: {
                id,
                projectId: projectId ?? null,
                status: 'ready',
                filenames: persistedFiles.filenames as unknown as Prisma.InputJsonValue,
                filePaths: persistedFiles.filePaths as unknown as Prisma.InputJsonValue,
                structures: structures.map((item) => ({
                    filename: item.filename,
                    elements: item.elements.length,
                })) as unknown as Prisma.InputJsonValue,
                analysis: hydratedAnalysis as unknown as Prisma.InputJsonValue,
                expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 6),
            },
        });

        return {
            id: created.id,
            projectId: created.projectId ?? undefined,
            filenames: persistedFiles.filenames,
            filePaths: persistedFiles.filePaths,
            structures: structures.map((item) => ({ filename: item.filename, elements: item.elements.length })),
            analysis: hydratedAnalysis,
            createdAt: created.createdAt,
            status: 'ready',
        };
    }

    async createTemplateFromModels(
        files: Buffer[],
        filenames: string[],
        projectId?: string,
        placeholderOverrides?: PlaceholderDefinition[],
    ): Promise<CreateTemplateResult> {
        console.log('[TemplateFactory] Iniciando criacao de template a partir de modelos...');

        const structures = await Promise.all(
            files.map(async (file, index) => {
                const structure = await this.extractorService.extractStructure(file);
                return {
                    ...structure,
                    filename: filenames[index] ?? `modelo-${index + 1}.docx`,
                };
            }),
        );

        const analysis = await this.analyzerService.analyzeModels(structures);
        let placeholderMap: PlaceholderDefinition[] = [];
        try {
            placeholderMap = await this.analyzerService.generatePlaceholderMap(analysis);
        } catch (error) {
            console.warn('[TemplateFactory] Falha ao gerar mapa de placeholders. Usando placeholders da analise.', {
                error: error instanceof Error ? error.message : String(error),
            });
        }

        if (!Array.isArray(placeholderMap) || placeholderMap.length === 0) {
            placeholderMap = analysis.globalPlaceholders;
        }
        const placeholders = placeholderOverrides && placeholderOverrides.length > 0
            ? placeholderOverrides
            : placeholderMap;
        const analysisWithPlaceholders: TemplateAnalysisResult = {
            ...analysis,
            globalPlaceholders: placeholders,
        };

        return this.persistTemplateResult(structures, analysisWithPlaceholders, files, filenames, projectId);
    }

    async createTemplateFromAnalysis(
        analysisId: string,
        placeholderOverrides?: PlaceholderDefinition[],
    ): Promise<CreateTemplateResult> {
        const stored = await this.fetchAnalysis(analysisId);
        if (!stored || stored.status !== 'ready') {
            throw new Error('Analise nao encontrada ou expirada. Execute a analise novamente.');
        }

        const files = stored.filePaths.map((filePath) => {
            if (!fs.existsSync(filePath)) {
                throw new Error(`Arquivo do modelo nao encontrado para analise ${analysisId}: ${filePath}`);
            }

            return fs.readFileSync(filePath);
        });

        const structures = await Promise.all(
            files.map(async (file, index) => {
                const structure = await this.extractorService.extractStructure(file);
                return {
                    ...structure,
                    filename: stored.filenames[index] ?? `modelo-${index + 1}.docx`,
                };
            }),
        );

        const placeholders = placeholderOverrides && placeholderOverrides.length > 0
            ? placeholderOverrides
            : stored.analysis.globalPlaceholders;

        const analysisWithPlaceholders: TemplateAnalysisResult = {
            ...stored.analysis,
            globalPlaceholders: placeholders,
        };

        return this.persistTemplateResult(
            structures,
            analysisWithPlaceholders,
            files,
            stored.filenames,
            stored.projectId,
        );
    }

    async getAnalysisStatus(id: string): Promise<StoredAnalysis | null> {
        const stored = await this.fetchAnalysis(id);
        if (!stored) {
            return null;
        }

        if (stored.status === 'ready' && stored.createdAt.getTime() + 1000 * 60 * 60 * 6 < Date.now()) {
            await prisma.rDATemplateFactoryAnalysis.update({
                where: { id },
                data: { status: 'expired' },
            });
            return { ...stored, status: 'expired' };
        }

        return stored;
    }

    async listSchemas(projectId?: string): Promise<unknown[]> {
        return prisma.rDASchema.findMany({
            where: projectId
                ? {
                    template: {
                        projectId,
                    },
                }
                : undefined,
            include: {
                template: {
                    select: {
                        id: true,
                        name: true,
                        projectId: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
    }

    private async persistTemplateResult(
        structures: Awaited<ReturnType<TemplateExtractorService['extractStructure']>>[],
        analysisWithPlaceholders: TemplateAnalysisResult,
        files: Buffer[],
        filenames: string[],
        projectId?: string,
    ): Promise<CreateTemplateResult> {
        if (!analysisWithPlaceholders.globalPlaceholders || analysisWithPlaceholders.globalPlaceholders.length === 0) {
            throw new Error('Nao foi possivel identificar placeholders variaveis nos modelos enviados.');
        }

        const { templateBuffer } = await this.builderService.buildTemplate(structures, analysisWithPlaceholders, files);
        const validationResult = await this.builderService.validateTemplate(templateBuffer, analysisWithPlaceholders.globalPlaceholders);
        const resolvedProjectId = await this.resolveProjectId(projectId);

        fs.mkdirSync(RDA_TEMPLATES_DIR, { recursive: true });
        const storageName = `factory-${Date.now()}-${randomUUID()}.docx`;
        const filePath = path.join(RDA_TEMPLATES_DIR, storageName);
        fs.writeFileSync(filePath, templateBuffer);

        const createdTemplate = await prisma.rDATemplate.create({
            data: {
                projectId: resolvedProjectId,
                name: `Template Factory ${new Date().toISOString().slice(0, 10)}`,
                description: 'Template gerado automaticamente via Template Factory',
                filePath,
                placeholders: analysisWithPlaceholders.globalPlaceholders.map((item) => `{{${item.name}}}`),
                isActive: false,
                uploadedBy: 'template-factory',
                sourceModels: filenames,
            },
        });

        const version = this.generateSchemaVersion();
        const outputSchema = this.buildOutputSchema(analysisWithPlaceholders.globalPlaceholders, createdTemplate.id, version);

        const createdSchema = await prisma.rDASchema.create({
            data: {
                version,
                templateId: createdTemplate.id,
                schema: outputSchema as unknown as Prisma.InputJsonValue,
                isActive: true,
            },
        });

        const examples = this.analyzerService.extractExamples(structures, analysisWithPlaceholders);
        const exampleRows = analysisWithPlaceholders.globalPlaceholders.flatMap((placeholder) => {
            const values = examples.get(placeholder.name) ?? [];
            return values.map((value) => ({
                schemaId: createdSchema.id,
                section: placeholder.section,
                fieldName: placeholder.name,
                content: value,
                source: 'template_factory',
                quality: 1.0,
            }));
        });

        if (exampleRows.length > 0) {
            await prisma.rDAExample.createMany({
                data: exampleRows,
            });
        }

        await prisma.rDATemplate.update({
            where: { id: createdTemplate.id },
            data: {
                activeSchemaId: createdSchema.id,
            },
        });

        console.log('[TemplateFactory] Template Factory concluido', {
            templateId: createdTemplate.id,
            schemaId: createdSchema.id,
            valid: validationResult.valid,
        });

        return {
            templateId: createdTemplate.id,
            schemaId: createdSchema.id,
            placeholders: analysisWithPlaceholders.globalPlaceholders,
            validationResult,
        };
    }

    private persistAnalysisFiles(
        analysisId: string,
        files: Buffer[],
        filenames: string[],
    ): { filenames: string[]; filePaths: string[] } {
        const analysisDir = path.join(RDA_TEMPLATE_FACTORY_ANALYSES_DIR, analysisId);
        fs.mkdirSync(analysisDir, { recursive: true });

        const persistedFilenames: string[] = [];
        const persistedPaths: string[] = [];

        files.forEach((file, index) => {
            const safeName = (filenames[index] ?? `modelo-${index + 1}.docx`).replace(/[^a-zA-Z0-9._-]/g, '_');
            const fileName = `${index + 1}-${safeName}`;
            const filePath = path.join(analysisDir, fileName);
            fs.writeFileSync(filePath, file);
            persistedFilenames.push(filenames[index] ?? fileName);
            persistedPaths.push(filePath);
        });

        return {
            filenames: persistedFilenames,
            filePaths: persistedPaths,
        };
    }

    private async fetchAnalysis(id: string): Promise<StoredAnalysis | null> {
        const raw = await prisma.rDATemplateFactoryAnalysis.findUnique({
            where: { id },
        });

        if (!raw) {
            return null;
        }

        const filenames = this.toStringArray(raw.filenames);
        const filePaths = this.toStringArray(raw.filePaths);
        const structures = this.toStructureSummaryArray(raw.structures);
        const analysis = templateAnalysisResultSchema.parse(raw.analysis);

        return {
            id: raw.id,
            projectId: raw.projectId ?? undefined,
            filenames,
            filePaths,
            structures,
            analysis,
            createdAt: raw.createdAt,
            status: raw.status === 'expired' ? 'expired' : 'ready',
        };
    }

    private toStringArray(value: unknown): string[] {
        if (Array.isArray(value)) {
            return value.filter((item): item is string => typeof item === 'string');
        }

        return [];
    }

    private toStructureSummaryArray(value: unknown): Array<{ filename: string; elements: number }> {
        if (!Array.isArray(value)) {
            return [];
        }

        return value
            .map((item) => {
                if (!item || typeof item !== 'object') {
                    return null;
                }

                const raw = item as { filename?: unknown; elements?: unknown };
                if (typeof raw.filename !== 'string') {
                    return null;
                }

                return {
                    filename: raw.filename,
                    elements: typeof raw.elements === 'number' ? raw.elements : 0,
                };
            })
            .filter((item): item is { filename: string; elements: number } => Boolean(item));
    }

    private generateSchemaVersion(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
    }

    private buildOutputSchema(
        placeholders: PlaceholderDefinition[],
        templateId: string,
        version: string,
    ): RDAOutputSchema {
        const sections: RDAOutputSchema['sections'] = {};

        placeholders.forEach((placeholder) => {
            const sectionName = placeholder.section || 'GERAL';
            if (!sections[sectionName]) {
                sections[sectionName] = { fields: {} };
            }

            sections[sectionName].fields[placeholder.name] = {
                type: placeholder.type,
                required: placeholder.required,
                description: placeholder.description,
                maxLength: placeholder.maxLength,
                tableSchema: placeholder.tableColumns
                    ? { columns: placeholder.tableColumns }
                    : undefined,
                enumValues: placeholder.enumValues,
            };
        });

        return {
            schemaVersion: version,
            templateId,
            sections,
        };
    }

    private async resolveProjectId(projectId?: string): Promise<string> {
        if (projectId) {
            return projectId;
        }

        const fallback = await prisma.project.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { id: true },
        });

        if (!fallback) {
            throw new Error('Nenhum projeto encontrado para associar o template factory.');
        }

        return fallback.id;
    }
}

export const templateFactoryService = new TemplateFactoryService(
    templateExtractorService,
    templateAnalyzerService,
    templateBuilderService,
);
