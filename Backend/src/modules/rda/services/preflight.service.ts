
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import { prisma } from '@/database/client';
import { embeddingService } from '@/modules/rda/services/embedding.service';
import { projectContextService } from '@/modules/rda/services/project-context.service';
import {
    GenerationContext,
    PlaceholderInfo,
    PreflightCheck,
    PreflightCheckConfig,
    PreflightConfig,
    PreflightConfigSchema,
    PreflightResult,
} from '@/modules/rda/schemas/preflight.schema';
import { rdaQueueService } from '@/modules/rda/services/rda-queue.service';
import type { ProjectContextData } from '@/modules/rda/schemas/rag.schema';
import type { MonthPeriod } from '@/modules/rda/schemas/monthly.schema';

interface TemplateRecord {
    id: string;
    name: string;
    filePath: string;
    placeholders: string[];
}

interface MonthlySnapshotRecord {
    workItemsTotal: number;
    workItemsClosed: number;
    workItemsActive: number;
    sprintsCount: number;
    wikiPagesUpdated: number;
    chunksCreated: number;
    status: string;
    updatedAt: Date;
}

interface ChunkStatsRecord {
    chunksBySourceType: Record<string, number>;
    totalChunks: number;
}

const REQUIRED_PLACEHOLDERS = [
    'PROJETO_NOME',
    'ANO_BASE',
    'COMPETENCIA',
    'COORDENADOR_TECNICO',
    'ATIVIDADES',
    'RESULTADOS_ALCANCADOS',
];

const REQUIRED_GROUPS = [
    {
        key: 'projeto_nome',
        aliases: ['PROJETO_NOME', 'PROJECT_NAME'],
    },
    {
        key: 'ano_base',
        aliases: ['ANO_BASE', 'YEAR_BASE'],
    },
    {
        key: 'competencia',
        aliases: ['COMPETENCIA', 'COMPETENCE', 'COMPETENCE_MONTH'],
    },
    {
        key: 'coordenador_tecnico',
        aliases: ['COORDENADOR_TECNICO', 'TECHNICAL_COORDINATOR'],
    },
    {
        key: 'atividades',
        aliases: ['ATIVIDADES', 'ATIVIDADE', 'ACTIVITY', 'ACTIVITIES'],
    },
    {
        key: 'resultados_alcancados',
        aliases: ['RESULTADOS_ALCANCADOS', 'RESULTADOS_ALCANCADOS_PROJETO', 'PROJECT_RESULTS', 'RESULTS'],
    },
];

export class PreflightService {
    async run(input: PreflightConfig): Promise<PreflightResult> {
        const startedAt = Date.now();
        const parsed = PreflightConfigSchema.parse(input);
        const periodKey = this.periodToKey(parsed.period);
        console.log('[Preflight] Iniciando verificacao', {
            projectId: parsed.projectId,
            periodKey,
            dryRun: parsed.options.dryRun,
        });
        const checks: PreflightCheck[] = [];
        const blockers: string[] = [];
        const warnings: string[] = [];

        const config = {
            ...this.getDefaultConfig(),
            ...(parsed.checkConfig ?? {}),
        };

        const project = await prisma.project.findUnique({
            where: { id: parsed.projectId },
            select: { id: true, name: true },
        });

        if (!project) {
            return {
                projectId: parsed.projectId,
                period: periodKey,
                status: 'blocked',
                checks: [{
                    name: 'Projeto encontrado',
                    key: 'project_exists',
                    status: 'fail',
                    severity: 'critical',
                    message: `Projeto nao encontrado: ${parsed.projectId}`,
                    action: 'Selecione um projeto valido antes de gerar o RDA.',
                    duration: 0,
                }],
                summary: {
                    total: 1,
                    passed: 0,
                    failed: 1,
                    warnings: 0,
                    skipped: 0,
                },
                blockers: [`Projeto nao encontrado: ${parsed.projectId}`],
                warnings: [],
                duration: Date.now() - startedAt,
            };
        }

        const templateCheck = await this.runCheck(
            'Template ativo e compativel',
            'template_active',
            'critical',
            checks,
            async () => {
                const template = await this.resolveTemplate(parsed.templateId);
                if (!template) {
                    return {
                        status: 'fail' as const,
                        message: 'Nenhum template ativo encontrado para o projeto.',
                        action: 'Ative ou envie um template DOCX antes de gerar o RDA.',
                    };
                }
                if (!fs.existsSync(template.filePath)) {
                    return {
                        status: 'fail' as const,
                        message: `Template ativo nao encontrado em disco: ${template.filePath}`,
                        action: 'Reenvie o template DOCX do projeto para corrigir o caminho.',
                    };
                }
                const placeholders = await this.extractPlaceholders(template.filePath);
                if (placeholders.length === 0) {
                    return {
                        status: 'fail' as const,
                        message: 'Template sem placeholders detectados.',
                        action: 'Valide o template DOCX e os placeholders docxtemplater.',
                    };
                }

                return {
                    status: 'pass' as const,
                    message: `Template validado: ${template.name}`,
                    details: {
                        templateId: template.id,
                        templatePath: template.filePath,
                        placeholders: placeholders.length,
                    },
                    data: {
                        template,
                        placeholders,
                    },
                };
            },
        );

        let fillingGuide = '';
        let placeholders: PlaceholderInfo[] = templateCheck.data?.placeholders ?? [];

        await this.runCheck(
            'Guia de preenchimento carregado',
            'filling_guide',
            'warning',
            checks,
            async () => {
                const guidePath = this.resolveGuidePath();
                if (!guidePath) {
                    return {
                        status: 'warn' as const,
                        message: 'Guia de preenchimento nao encontrado no disco.',
                        action: 'Verifique o arquivo Guia_Preenchimento_Placeholders_RDA.md.',
                    };
                }

                const content = fs.readFileSync(guidePath, 'utf8');
                fillingGuide = content;

                if (placeholders.length > 0) {
                    placeholders = this.enrichPlaceholdersFromGuide(placeholders, content);
                }

                return {
                    status: 'pass' as const,
                    message: 'Guia de preenchimento carregado com sucesso.',
                    details: {
                        guidePath,
                        placeholderCount: placeholders.length,
                    },
                };
            },
        );

        const monthlyCheck = await this.runCheck(
            'Preparacao mensal concluida',
            'monthly_snapshot_ready',
            'critical',
            checks,
            async () => {
                const snapshot = await prisma.rDAMonthlySnapshot.findUnique({
                    where: {
                        projectId_period: {
                            projectId: project.id,
                            period: periodKey,
                        },
                    },
                });

                if (!snapshot) {
                    return {
                        status: 'fail' as const,
                        message: `Snapshot mensal nao encontrado para ${periodKey}.`,
                        action: 'Execute a preparacao mensal antes de iniciar a geracao.',
                    };
                }

                if (snapshot.status !== 'ready') {
                    return {
                        status: 'fail' as const,
                        message: `Snapshot mensal em status ${snapshot.status}.`,
                        action: 'Aguarde a conclusao da preparacao mensal ou reprocesse o periodo.',
                        details: {
                            snapshotId: snapshot.id,
                            status: snapshot.status,
                        },
                    };
                }

                const data: MonthlySnapshotRecord = {
                    workItemsTotal: snapshot.workItemsTotal,
                    workItemsClosed: snapshot.workItemsClosed,
                    workItemsActive: snapshot.workItemsActive,
                    sprintsCount: snapshot.sprintsCount,
                    wikiPagesUpdated: snapshot.wikiPagesUpdated,
                    chunksCreated: snapshot.chunksCreated,
                    status: snapshot.status,
                    updatedAt: snapshot.updatedAt,
                };

                return {
                    status: 'pass' as const,
                    message: `Preparacao mensal pronta para ${periodKey}.`,
                    details: {
                        snapshotId: snapshot.id,
                        workItemsTotal: snapshot.workItemsTotal,
                        sprintsCount: snapshot.sprintsCount,
                        chunksCreated: snapshot.chunksCreated,
                    },
                    data,
                };
            },
        );

        await this.runCheck(
            'Cobertura de dados do periodo',
            'data_coverage',
            parsed.options.allowPartialData ? 'warning' : 'critical',
            checks,
            async () => {
                const workItemsCount = await prisma.rDAWorkItemSnapshot.count({
                    where: { projectId: project.id, periodKey },
                });
                const sprintsCount = await prisma.rDASprintSnapshot.count({
                    where: { projectId: project.id, period: periodKey },
                });

                const missing: string[] = [];
                if (workItemsCount < config.minWorkItems) {
                    missing.push(`Work items abaixo do minimo (${workItemsCount}/${config.minWorkItems})`);
                }
                if (sprintsCount < config.minSprints) {
                    missing.push(`Sprints abaixo do minimo (${sprintsCount}/${config.minSprints})`);
                }

                if (missing.length > 0) {
                    const status = parsed.options.allowPartialData ? 'warn' : 'fail';
                    return {
                        status: status as 'warn' | 'fail',
                        message: missing.join(' | '),
                        action: 'Reexecute a preparacao mensal para consolidar os dados do periodo.',
                        details: {
                            workItemsCount,
                            sprintsCount,
                        },
                    };
                }

                return {
                    status: 'pass' as const,
                    message: 'Cobertura minima de work items e sprints atendida.',
                    details: {
                        workItemsCount,
                        sprintsCount,
                    },
                };
            },
        );

        await this.runCheck(
            'Wiki atualizada',
            'wiki_freshness',
            'warning',
            checks,
            async () => {
                if (parsed.options.skipWikiCheck) {
                    return {
                        status: 'skip' as const,
                        message: 'Verificacao de wiki ignorada por configuracao.',
                    };
                }

                const row = await prisma.wikiPage.findFirst({
                    where: { projectId: project.id, lastSyncAt: { not: null } },
                    orderBy: { lastSyncAt: 'desc' },
                    select: { lastSyncAt: true },
                });

                if (!row?.lastSyncAt) {
                    return {
                        status: 'warn' as const,
                        message: 'Nao ha registro de sincronizacao da wiki.',
                        action: 'Execute a sincronizacao da wiki para enriquecer as evidencias.',
                    };
                }

                const ageDays = this.daysSince(row.lastSyncAt);
                if (ageDays > config.maxWikiAge) {
                    return {
                        status: 'warn' as const,
                        message: `Wiki desatualizada ha ${ageDays} dias.`,
                        action: 'Sincronize a wiki antes de gerar para melhorar a qualidade do conteudo.',
                        details: { ageDays },
                    };
                }

                return {
                    status: 'pass' as const,
                    message: `Wiki atualizada ha ${ageDays} dias.`,
                    details: { ageDays },
                };
            },
        );

        const contextCheck = await this.runCheck(
            'ProjectContext valido',
            'project_context',
            'critical',
            checks,
            async () => {
                const row = await prisma.projectContext.findUnique({
                    where: { projectId: project.id },
                    select: { lastUpdated: true },
                });

                if (!row) {
                    return {
                        status: 'fail' as const,
                        message: 'ProjectContext nao encontrado para o projeto.',
                        action: 'Reconstrua o contexto do projeto antes da geracao.',
                    };
                }

                const ageDays = this.daysSince(row.lastUpdated);
                const data = await projectContextService.getProjectContext(project.id);
                if (!data) {
                    return {
                        status: 'fail' as const,
                        message: 'Falha ao carregar ProjectContext estruturado.',
                        action: 'Reconstrua o contexto do projeto para corrigir dados incompletos.',
                    };
                }

                if (ageDays > config.maxContextAge) {
                    return {
                        status: 'warn' as const,
                        message: `ProjectContext desatualizado ha ${ageDays} dias.`,
                        action: 'Atualize o contexto para reduzir inconsistencias na geracao.',
                        details: { ageDays },
                        data,
                    };
                }

                return {
                    status: 'pass' as const,
                    message: `ProjectContext atualizado ha ${ageDays} dias.`,
                    details: { ageDays },
                    data,
                };
            },
        );

        const chunksCheck = await this.runCheck<ChunkStatsRecord>(
            'Base de conhecimento por fonte',
            'chunk_sources',
            'critical',
            checks,
            async () => {
                const stats = await embeddingService.getProjectChunkStats(project.id);
                const bySource = stats.chunksBySourceType;

                const missing = config.requiredSourceTypes.filter((source) => (bySource[source] ?? 0) <= config.minChunksPerSource);
                if (missing.length > 0) {
                    return {
                        status: parsed.options.allowPartialData ? 'warn' as const : 'fail' as const,
                        message: `Fontes com chunks insuficientes: ${missing.join(', ')}`,
                        action: 'Reprocesse ingestao/documentos para completar as fontes obrigatorias.',
                        details: {
                            requiredSourceTypes: config.requiredSourceTypes,
                            minChunksPerSource: config.minChunksPerSource,
                            chunksBySourceType: bySource,
                            totalChunks: stats.totalChunks,
                        },
                        data: stats,
                    };
                }

                return {
                    status: 'pass' as const,
                    message: `Base validada com ${stats.totalChunks} chunks.`,
                    details: {
                        chunksBySourceType: bySource,
                        totalChunks: stats.totalChunks,
                    },
                    data: stats,
                };
            },
        );

        await this.runCheck(
            'Fontes suficientes para placeholders obrigatorios',
            'placeholder_source_coverage',
            'critical',
            checks,
            async () => {
                const monthlySnapshot = monthlyCheck.data;
                const context = contextCheck.data;
                const chunkStats = chunksCheck.data;

                if (!monthlySnapshot || !context || !chunkStats) {
                    return {
                        status: 'fail' as const,
                        message: 'Dados insuficientes para validar cobertura de fontes dos placeholders.',
                        action: 'Reexecute o preflight apos corrigir dados de contexto, snapshot e base vetorial.',
                    };
                }

                const names = this.flattenPlaceholderNames(placeholders);
                const coverage = this.validateRequiredPlaceholderSources(names, context, monthlySnapshot, chunkStats);
                if (coverage.missing.length > 0) {
                    return {
                        status: 'fail' as const,
                        message: `Fontes insuficientes para placeholders: ${coverage.missing.join(', ')}`,
                        details: {
                            missing: coverage.missing,
                            reasons: coverage.reasons,
                        },
                        action: 'Atualize o contexto do projeto e reforce ingestao de workitems/wiki/documentos para preencher os placeholders obrigatorios.',
                    };
                }

                return {
                    status: 'pass' as const,
                    message: 'Cobertura de fontes para placeholders obrigatorios validada.',
                    details: {
                        validated: coverage.validated,
                    },
                };
            },
        );

        await this.runCheck(
            'Placeholders obrigatorios cobertos',
            'placeholder_requirements',
            'critical',
            checks,
            async () => {
                const names = this.flattenPlaceholderNames(placeholders);
                const missing = this.resolveMissingRequiredGroups(names);
                const templateName = String(templateCheck.data?.template?.name ?? '').toLowerCase();
                const isTemplateFactory = templateName.includes('template factory');

                if (missing.length > 0) {
                    const status: PreflightCheck['status'] = isTemplateFactory ? 'warn' : 'fail';
                    return {
                        status,
                        message: `Template sem placeholders obrigatorios: ${missing.join(', ')}`,
                        action: 'Revise o template ativo para incluir os placeholders mandatarios.',
                        details: {
                            missing,
                            isTemplateFactory,
                        },
                    };
                }

                return {
                    status: 'pass' as const,
                    message: 'Placeholders obrigatorios disponiveis no template.',
                    details: { required: REQUIRED_PLACEHOLDERS.length },
                };
            },
        );

        for (const check of checks) {
            if (check.status === 'fail' && check.severity === 'critical') {
                blockers.push(check.message);
            }
            if (check.status === 'warn') {
                warnings.push(check.message);
            }
        }

        const summary = {
            total: checks.length,
            passed: checks.filter((item) => item.status === 'pass').length,
            failed: checks.filter((item) => item.status === 'fail').length,
            warnings: checks.filter((item) => item.status === 'warn').length,
            skipped: checks.filter((item) => item.status === 'skip').length,
        };

        const hasBlocker = blockers.length > 0;
        const finalStatus: PreflightResult['status'] = hasBlocker
            ? 'blocked'
            : warnings.length > 0
                ? 'warning'
                : 'approved';

        const duration = Date.now() - startedAt;

        if (finalStatus === 'blocked' || parsed.options.dryRun) {
            console.log('[Preflight] Verificacao finalizada sem criacao de geracao', {
                projectId: project.id,
                periodKey,
                status: finalStatus,
                durationMs: duration,
            });
            return {
                projectId: project.id,
                period: periodKey,
                status: finalStatus,
                checks,
                summary,
                blockers,
                warnings,
                duration,
            };
        }

        const template = templateCheck.data?.template;
        const monthlySnapshot = monthlyCheck.data;
        const projectContext = contextCheck.data;
        const chunkStatsRaw = chunksCheck.data;

        if (!template || !monthlySnapshot || !projectContext || !chunkStatsRaw) {
            return {
                projectId: project.id,
                period: periodKey,
                status: 'blocked',
                checks,
                summary,
                blockers: [...blockers, 'Dados insuficientes para montar contexto de geracao.'],
                warnings,
                duration,
            };
        }

        const generationId = await this.createGeneration(project.id, template.id, periodKey);
        const context = await this.buildGenerationContext(
            project.id,
            project.name,
            periodKey,
            generationId,
            template,
            placeholders,
            fillingGuide,
            projectContext,
            monthlySnapshot,
            chunkStatsRaw.chunksBySourceType,
            chunkStatsRaw.totalChunks,
        );

        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: {
                partialResults: {
                    context,
                },
            },
        });
        await rdaQueueService.enqueue({
            generationId,
            projectId: project.id,
            templateId: template.id,
            periodKey,
        });
        console.log('[Preflight] Geracao preparada com sucesso', {
            projectId: project.id,
            periodKey,
            generationId,
            status: finalStatus,
            durationMs: duration,
        });

        return {
            projectId: project.id,
            period: periodKey,
            status: finalStatus,
            checks,
            summary,
            blockers,
            warnings,
            generationReady: {
                generationId,
                templateId: template.id,
                templatePath: template.filePath,
                periodKey,
                context,
            },
            duration,
        };
    }

    async getTemplateInfo(_projectId: string): Promise<{ template: TemplateRecord; placeholders: PlaceholderInfo[] }> {
        const template = await this.resolveTemplate();
        if (!template) {
            throw new Error('Nenhum template ativo encontrado.');
        }

        let placeholders = await this.extractPlaceholders(template.filePath);
        const guidePath = this.resolveGuidePath();
        if (guidePath) {
            const content = fs.readFileSync(guidePath, 'utf8');
            placeholders = this.enrichPlaceholdersFromGuide(placeholders, content);
        }

        return {
            template,
            placeholders,
        };
    }

    getFillingGuide(projectId: string): { content: string; placeholderCount: number } {
        const guidePath = this.resolveGuidePath();
        if (!guidePath) {
            throw new Error(`Guia de preenchimento nao encontrado para projeto ${projectId}.`);
        }

        const content = fs.readFileSync(guidePath, 'utf8');
        const placeholderCount = (content.match(/\b[A-Z_]{3,}\b/g) ?? []).length;

        return {
            content,
            placeholderCount,
        };
    }

    async getReadiness(projectId: string, periodKey: string): Promise<{ ready: boolean; issues: string[]; warnings: string[] }> {
        const [templates, snapshot, context] = await Promise.all([
            prisma.rDATemplate.findMany({
                select: { id: true, isActive: true },
                orderBy: { updatedAt: 'desc' },
            }),
            prisma.rDAMonthlySnapshot.findUnique({
                where: {
                    projectId_period: {
                        projectId,
                        period: periodKey,
                    },
                },
                select: {
                    status: true,
                    workItemsTotal: true,
                    sprintsCount: true,
                },
            }),
            prisma.projectContext.findUnique({
                where: { projectId },
                select: { id: true, lastUpdated: true },
            }),
        ]);

        const issues: string[] = [];
        const warns: string[] = [];

        if (templates.length === 0) {
            issues.push('Nenhum template encontrado.');
        } else if (!templates.some((template) => template.isActive)) {
            issues.push('Template ativo nao encontrado.');
        }

        if (!snapshot) {
            issues.push(`Snapshot mensal ${periodKey} nao encontrado.`);
        } else if (snapshot.status !== 'ready') {
            issues.push(`Snapshot mensal em status ${snapshot.status}.`);
        } else {
            if (snapshot.workItemsTotal <= 0) {
                issues.push('Nao ha work items no periodo.');
            }
            if (snapshot.sprintsCount <= 0) {
                warns.push('Nao ha sprints no periodo.');
            }
        }

        if (!context) {
            issues.push('ProjectContext nao encontrado.');
        } else if (this.daysSince(context.lastUpdated) > this.getDefaultConfig().maxContextAge) {
            warns.push('ProjectContext desatualizado.');
        }

        return {
            ready: issues.length === 0,
            issues,
            warnings: warns,
        };
    }

    private async runCheck<T>(
        name: string,
        key: string,
        severity: PreflightCheck['severity'],
        target: PreflightCheck[],
        fn: () => Promise<{
            status: PreflightCheck['status'];
            message: string;
            details?: Record<string, unknown>;
            action?: string;
            data?: T;
        }>,
    ): Promise<{ check: PreflightCheck; data?: T }> {
        const startedAt = Date.now();
        try {
            const result = await fn();
            const check: PreflightCheck = {
                name,
                key,
                severity,
                status: result.status,
                message: result.message,
                details: result.details,
                action: result.action,
                duration: Date.now() - startedAt,
            };
            target.push(check);
            console.log('[Preflight] Check concluido', {
                key,
                status: check.status,
                severity,
                durationMs: check.duration ?? 0,
            });
            return { check, data: result.data };
        } catch (error) {
            const check: PreflightCheck = {
                name,
                key,
                severity,
                status: 'fail',
                message: error instanceof Error ? error.message : String(error),
                action: 'Revise os dados de entrada e tente novamente.',
                duration: Date.now() - startedAt,
            };
            target.push(check);
            console.log('[Preflight] Check com erro', {
                key,
                status: check.status,
                severity,
                durationMs: check.duration ?? 0,
                error: check.message,
            });
            return { check };
        }
    }

    private async resolveTemplate(templateId?: string): Promise<TemplateRecord | null> {
        if (templateId) {
            const byId = await prisma.rDATemplate.findUnique({
                where: { id: templateId },
                select: { id: true, name: true, filePath: true, placeholders: true },
            });

            if (!byId) {
                return null;
            }

            return {
                id: byId.id,
                name: byId.name,
                filePath: byId.filePath,
                placeholders: byId.placeholders,
            };
        }

        const active = await prisma.rDATemplate.findFirst({
            where: { isActive: true },
            orderBy: { updatedAt: 'desc' },
            select: { id: true, name: true, filePath: true, placeholders: true },
        });

        if (!active) {
            return null;
        }

        return {
            id: active.id,
            name: active.name,
            filePath: active.filePath,
            placeholders: active.placeholders,
        };
    }

    private resolveGuidePath(): string | null {
        const custom = process.env.RDA_FILLING_GUIDE_PATH?.trim();
        const candidates = [
            custom,
            path.resolve(process.cwd(), 'prompts', 'rda', 'Guia_Preenchimento_Placeholders_RDA.md'),
            path.resolve(process.cwd(), 'Backend', 'prompts', 'rda', 'Guia_Preenchimento_Placeholders_RDA.md'),
        ].filter((item): item is string => Boolean(item));

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    private async buildGenerationContext(
        projectId: string,
        projectName: string,
        periodKey: string,
        generationId: string,
        template: TemplateRecord,
        placeholders: PlaceholderInfo[],
        fillingGuide: string,
        projectContext: ProjectContextData,
        snapshot: MonthlySnapshotRecord,
        chunkStats: Record<string, number>,
        totalChunks: number,
    ): Promise<GenerationContext> {
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL ?? '';
        const org = this.extractOrganization(orgUrl);

        return {
            projectId,
            periodKey,
            generationId,
            templateId: template.id,
            templatePath: template.filePath,
            placeholders,
            fillingGuide,
            projectContext,
            monthlySnapshot: {
                workItemsTotal: snapshot.workItemsTotal,
                workItemsClosed: snapshot.workItemsClosed,
                workItemsActive: snapshot.workItemsActive,
                sprintsCount: snapshot.sprintsCount,
                wikiPagesUpdated: snapshot.wikiPagesUpdated,
                chunksCreated: snapshot.chunksCreated,
            },
            azureDevOps: {
                organization: org,
                project: projectName,
                teamName: process.env.AZURE_DEVOPS_TEAM_NAME?.trim() || `${projectName} Team`,
            },
            chunkStats: {
                document: Number(chunkStats.document ?? 0),
                wiki: Number(chunkStats.wiki ?? 0),
                workitem: Number(chunkStats.workitem ?? 0),
                sprint: Number(chunkStats.sprint ?? 0),
                total: Number(totalChunks ?? 0),
            },
        };
    }

    private async createGeneration(
        projectId: string,
        templateId: string,
        periodKey: string,
    ): Promise<string> {
        const [yearRaw, monthRaw] = periodKey.split('-');
        const year = Number(yearRaw);
        const month = Number(monthRaw);

        const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
        const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59));

        const generation = await prisma.rDAGeneration.create({
            data: {
                projectId,
                templateId,
                status: 'queued',
                progress: 0,
                currentStep: 'queued',
                periodType: 'monthly',
                periodStart,
                periodEnd,
                period: {
                    month,
                    year,
                },
                schemaVersion: '3.0.0',
                createdBy: 'preflight',
                tokensUsed: 0,
                partialResults: {},
            },
            select: { id: true },
        });

        return generation.id;
    }

    private async extractPlaceholders(templatePath: string): Promise<PlaceholderInfo[]> {
        console.log('[Template] Extraindo placeholders', { templatePath });
        const binary = fs.readFileSync(templatePath, 'binary');
        const zip = new PizZip(binary);
        const documentXml = zip.file('word/document.xml')?.asText();

        if (!documentXml) {
            throw new Error('Nao foi possivel ler word/document.xml do template DOCX.');
        }

        const paragraphRegex = /<w:p[\s\S]*?<\/w:p>/g;
        const textRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;

        const paragraphs = documentXml.match(paragraphRegex) ?? [];
        const reconstructed = paragraphs.map((paragraph) => {
            const pieces: string[] = [];
            let textMatch: RegExpExecArray | null = null;
            while ((textMatch = textRegex.exec(paragraph)) !== null) {
                pieces.push(this.decodeXml(textMatch[1] ?? ''));
            }
            return pieces.join('');
        });

        const fullText = reconstructed.join('\n');
        const tokenRegex = /\{#([A-Z_]+)\}|\{\/([A-Z_]+)\}|\{([A-Z_]+)\}/g;

        const topLevel = new Map<string, PlaceholderInfo>();
        const loops = new Map<string, PlaceholderInfo>();
        const stack: PlaceholderInfo[] = [];

        let token: RegExpExecArray | null = null;
        while ((token = tokenRegex.exec(fullText)) !== null) {
            const openName = token[1];
            const closeName = token[2];
            const simpleName = token[3];

            if (openName) {
                const loop = loops.get(openName) ?? {
                    name: openName,
                    type: 'loop' as const,
                    required: openName === 'ATIVIDADES',
                    section: 'template',
                    loopVariable: openName,
                    childPlaceholders: [],
                };

                loops.set(openName, loop);

                if (stack.length === 0) {
                    topLevel.set(openName, loop);
                } else {
                    const parent = stack[stack.length - 1];
                    parent.type = 'nested_loop';
                    parent.childPlaceholders = parent.childPlaceholders ?? [];
                    if (!parent.childPlaceholders.some((item) => item.name === loop.name)) {
                        parent.childPlaceholders.push(loop);
                    }
                }

                stack.push(loop);
                continue;
            }

            if (closeName) {
                for (let index = stack.length - 1; index >= 0; index -= 1) {
                    if (stack[index].name === closeName) {
                        stack.splice(index);
                        break;
                    }
                }
                continue;
            }

            if (!simpleName) {
                continue;
            }

            const info: PlaceholderInfo = {
                name: simpleName,
                type: 'simple',
                required: REQUIRED_PLACEHOLDERS.includes(simpleName),
                section: 'template',
            };

            if (stack.length === 0) {
                if (!topLevel.has(simpleName)) {
                    topLevel.set(simpleName, info);
                }
            } else {
                const parent = stack[stack.length - 1];
                parent.childPlaceholders = parent.childPlaceholders ?? [];
                if (!parent.childPlaceholders.some((item) => item.name === simpleName)) {
                    parent.childPlaceholders.push(info);
                }
            }
        }

        console.log('[Template] Placeholders extraidos', {
            templatePath,
            total: topLevel.size,
        });
        return Array.from(topLevel.values());
    }

    private enrichPlaceholdersFromGuide(
        placeholders: PlaceholderInfo[],
        guideContent: string,
    ): PlaceholderInfo[] {
        console.log('[Guide] Enriquecendo placeholders com guia');
        const sections = new Map<
        string,
        { description?: string; sourceHint?: string; required?: boolean; guideType?: string; rules?: string[] }
        >();
        const sectionRegex = /(?:^|\n)###?\s+\{?([A-Z_]+)\}?\s*\n([\s\S]*?)(?=\n###?\s+\{?[A-Z_]+\}?\s*\n|\n---\n|$)/g;

        let match: RegExpExecArray | null = null;
        while ((match = sectionRegex.exec(guideContent)) !== null) {
            const name = (match[1] ?? '').trim();
            const block = match[2] ?? '';
            const requiredLine = block.match(/\*\*Obrigat[oó]rio:\*\*\s*(.+)/i)?.[1] ?? '';
            const typeLine = block.match(/\*\*Tipo:\*\*\s*(.+)/i)?.[1] ?? '';
            const sourceLine = block.match(/\*\*Fonte(?: de dados)?:\*\*\s*(.+)/i)?.[1] ?? '';
            const descriptionLine = block.match(/\*\*Descri[cç][aã]o:\*\*\s*(.+)/i)?.[1] ?? '';
            const rulesBlock = block.match(/\*\*Regras:\*\*\s*([\s\S]*?)(?=\n-\s+\*\*|$)/i)?.[1] ?? '';

            sections.set(name, {
                required: /sim/i.test(requiredLine),
                guideType: typeLine.trim() || undefined,
                sourceHint: sourceLine.trim() || undefined,
                description: descriptionLine.trim() || undefined,
                rules: this.parseRules(rulesBlock),
            });
        }

        const enrichOne = (item: PlaceholderInfo): PlaceholderInfo => {
            const mapped = sections.get(item.name);
            const next: PlaceholderInfo = {
                ...item,
                required: mapped?.required ?? item.required,
                guideType: mapped?.guideType ?? item.guideType,
                sourceHint: mapped?.sourceHint ?? item.sourceHint,
                description: mapped?.description ?? item.description,
                rules: mapped?.rules ?? item.rules,
            };

            if (item.childPlaceholders?.length) {
                next.childPlaceholders = item.childPlaceholders.map((child) => enrichOne(child));
            }

            return next;
        };

        console.log('[Guide] Enriquecimento concluido', {
            placeholders: placeholders.length,
            sections: sections.size,
        });
        return placeholders.map((item) => enrichOne(item));
    }

    private periodToKey(period: MonthPeriod): string {
        return `${period.year}-${String(period.month).padStart(2, '0')}`;
    }

    private daysSince(date: Date): number {
        return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    }

    private getDefaultConfig(): PreflightCheckConfig {
        return {
            minWorkItems: 1,
            minSprints: 0,
            maxContextAge: 60,
            maxWikiAge: 30,
            minChunksPerSource: 0,
            requiredSourceTypes: ['document', 'workitem'],
        };
    }

    private decodeXml(value: string): string {
        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
    }

    private flattenPlaceholderNames(placeholders: PlaceholderInfo[]): Set<string> {
        const names = new Set<string>();

        const visit = (item: PlaceholderInfo) => {
            names.add(item.name.toUpperCase());
            item.childPlaceholders?.forEach((child) => visit(child));
        };

        placeholders.forEach((item) => visit(item));
        return names;
    }

    private resolveMissingRequiredGroups(names: Set<string>): string[] {
        return REQUIRED_GROUPS
            .filter((group) => !group.aliases.some((alias) => {
                const aliasUpper = alias.toUpperCase();
                if (names.has(aliasUpper)) {
                    return true;
                }

                for (const item of names) {
                    if (item.includes(aliasUpper)) {
                        return true;
                    }
                }
                return false;
            }))
            .map((group) => group.aliases[0]);
    }

    private parseRules(raw: string): string[] {
        return raw
            .split('\n')
            .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
            .filter(Boolean);
    }

    private hasSource(names: Set<string>, aliases: string[]): boolean {
        return aliases.some((alias) => {
            const normalized = alias.toUpperCase();
            if (names.has(normalized)) return true;
            for (const item of names) {
                if (item.includes(normalized)) return true;
            }
            return false;
        });
    }

    private validateRequiredPlaceholderSources(
        names: Set<string>,
        context: ProjectContextData,
        snapshot: MonthlySnapshotRecord,
        chunkStats: ChunkStatsRecord,
    ): { missing: string[]; reasons: Record<string, string>; validated: string[] } {
        const missing: string[] = [];
        const reasons: Record<string, string> = {};
        const validated: string[] = [];

        const addMissing = (placeholder: string, reason: string) => {
            missing.push(placeholder);
            reasons[placeholder] = reason;
        };

        if (this.hasSource(names, ['PROJETO_NOME', 'PROJECT_NAME'])) {
            if (!context.projectName?.trim()) {
                addMissing('PROJETO_NOME', 'ProjectContext.projectName vazio.');
            } else {
                validated.push('PROJETO_NOME');
            }
        }

        if (this.hasSource(names, ['ANO_BASE', 'YEAR_BASE'])) {
            validated.push('ANO_BASE');
        }
        if (this.hasSource(names, ['COMPETENCIA', 'COMPETENCE', 'COMPETENCE_MONTH'])) {
            validated.push('COMPETENCIA');
        }

        if (this.hasSource(names, ['COORDENADOR_TECNICO', 'TECHNICAL_COORDINATOR'])) {
            const hasCoordinatorByRole = context.teamMembers.some(
                (member) => /coordenador|gerente t[eé]cnico|l[ií]der t[eé]cnico|technical coordinator|tech lead/i.test(member.role),
            );
            const hasCoordinatorByNameInSummary = Boolean(
                context.summary
                && context.teamMembers.some((member) => {
                    const name = member.name.trim();
                    return Boolean(name)
                        && context.summary
                        && context.summary.toLowerCase().includes(name.toLowerCase());
                }),
            );
            const hasCoordinatorByStakeholder = context.stakeholders.some(
                (item) => /coordenador|gerente t[eé]cnico|l[ií]der t[eé]cnico|technical coordinator|tech lead/i.test(item.role),
            );
            const hasCoordinator = hasCoordinatorByRole || hasCoordinatorByNameInSummary || hasCoordinatorByStakeholder;
            if (!hasCoordinator) {
                addMissing(
                    'COORDENADOR_TECNICO',
                    'Nao foi encontrado indicio de coordenacao tecnica em teamMembers.role, stakeholders.role ou summary.',
                );
            } else {
                validated.push('COORDENADOR_TECNICO');
            }
        }

        if (this.hasSource(names, ['ATIVIDADES', 'ACTIVITY', 'ACTIVITIES'])) {
            const hasWorkItems = snapshot.workItemsTotal > 0;
            const hasWorkitemChunks = Number(chunkStats.chunksBySourceType.workitem ?? 0) > 0;
            if (!hasWorkItems || !hasWorkitemChunks) {
                addMissing('ATIVIDADES', `workItemsTotal=${snapshot.workItemsTotal}, chunks(workitem)=${Number(chunkStats.chunksBySourceType.workitem ?? 0)}.`);
            } else {
                validated.push('ATIVIDADES');
            }
        }

        if (this.hasSource(names, ['RESULTADOS_ALCANCADOS', 'RESULTADOS_ALCANCADOS_PROJETO', 'PROJECT_RESULTS', 'RESULTS'])) {
            const hasNarrativeSources = snapshot.workItemsClosed > 0
                || Number(chunkStats.chunksBySourceType.wiki ?? 0) > 0
                || Number(chunkStats.chunksBySourceType.document ?? 0) > 0;

            if (!hasNarrativeSources) {
                addMissing(
                    'RESULTADOS_ALCANCADOS',
                    `workItemsClosed=${snapshot.workItemsClosed}, chunks(wiki)=${Number(chunkStats.chunksBySourceType.wiki ?? 0)}, chunks(document)=${Number(chunkStats.chunksBySourceType.document ?? 0)}.`,
                );
            } else {
                validated.push('RESULTADOS_ALCANCADOS');
            }
        }

        return { missing, reasons, validated };
    }

    private extractOrganization(orgUrl: string): string {
        const cleaned = orgUrl.trim().replace(/\/+$/, '');
        if (!cleaned) {
            return 'organization';
        }

        try {
            const parsed = new URL(cleaned);
            const pieces = parsed.pathname.split('/').filter(Boolean);
            if (pieces.length > 0) {
                return pieces[pieces.length - 1];
            }
            return parsed.hostname;
        } catch {
            const parts = cleaned.split('/').filter(Boolean);
            return parts[parts.length - 1] ?? cleaned;
        }
    }
}

export const preflightService = new PreflightService();
