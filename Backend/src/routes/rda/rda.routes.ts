import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { rdaService } from '@/services/rda/rda.service';
import { rdaController } from '@/controllers/rda.controller';
import {
    analyzeModelsBodySchema,
    generateTemplateBodySchema,
    templateFactoryStatusParamsSchema,
} from '@/modules/rda/schemas/template-factory.schema';
import { templateFactoryService } from '@/modules/rda/services/template-factory.service';
import {
    ProjectContextDataSchema,
    SearchQuerySchema,
    SetupProjectSchema,
} from '@/modules/rda/schemas/rag.schema';
import { embeddingService } from '@/modules/rda/services/embedding.service';
import { projectContextService } from '@/modules/rda/services/project-context.service';
import { projectSetupService } from '@/modules/rda/services/project-setup.service';
import { wikiIngestionService } from '@/modules/rda/services/wiki-ingestion.service';
import { documentIngestionService } from '@/modules/rda/services/document-ingestion.service';
import { documentService } from '@/services/rda/document.service';
import {
    MonthlyPreparationRequestSchema,
    MonthlyProjectParamsSchema,
    MonthlyStatusParamsSchema,
    MonthlyWorkItemsFilterSchema,
    PeriodKeySchema,
} from '@/modules/rda/schemas/monthly.schema';
import { monthlyPreparationService } from '@/modules/rda/services/monthly-preparation.service';
import { prisma } from '@/database/client';

const generateRDASchema = z.object({
    projectId: z.string().min(1),
    templateId: z.string().min(1).optional(),
    periodType: z.enum(['monthly', 'general']),
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
    documentIds: z.array(z.string()).default([]),
    wikiPageIds: z.array(z.string()).default([]),
    generatedBy: z.string().min(1),
});

const idParamsSchema = z.object({
    id: z.string().min(1),
});

const projectParamsSchema = z.object({
    projectId: z.string().min(1),
});

const setupJobs = new Map<
    string,
    {
        status: 'processing' | 'completed' | 'failed';
        startedAt: string;
        updatedAt: string;
        progress?: {
            phase: string;
            currentStep: string;
            overallProgress: number;
            details: Record<string, unknown>;
        };
        result?: unknown;
        error?: string;
    }
>();

const monthlyStatusCache = new Map<
    string,
    {
        snapshotId: string;
        projectId: string;
        period: string;
        status: 'collecting' | 'ready' | 'failed';
        step: string;
        progress: number;
        updatedAt: string;
        workItemsStatus: 'pending' | 'collecting' | 'done' | 'error';
        sprintsStatus: 'pending' | 'collecting' | 'done' | 'error';
        wikiStatus: 'pending' | 'collecting' | 'done' | 'error';
        documentsStatus: 'pending' | 'collecting' | 'done' | 'error';
        contextStatus: 'pending' | 'collecting' | 'done' | 'error';
        counters: {
            workItemsTotal: number;
            workItemsNew: number;
            workItemsClosed: number;
            workItemsActive: number;
            sprintsCount: number;
            wikiPagesUpdated: number;
            documentsUploaded: number;
            chunksCreated: number;
        };
        errors: Array<{ source: string; message: string; timestamp: string }>;
    }
>();

const monthlyJobs = new Map<string, { startedAt: number }>();

function monthlyCacheKey(projectId: string, period: string): string {
    return `${projectId}:${period}`;
}

async function parseMultipartDocxRequest(
    req: FastifyRequest,
): Promise<{ files: Buffer[]; filenames: string[]; fields: Record<string, string> }> {
    const parts = req.parts();
    const files: Buffer[] = [];
    const filenames: string[] = [];
    const fields: Record<string, string> = {};

    for await (const part of parts) {
        if (part.type === 'file') {
            if (!part.filename.toLowerCase().endsWith('.docx')) {
                await part.toBuffer();
                continue;
            }

            files.push(await part.toBuffer());
            filenames.push(part.filename);
            continue;
        }

        fields[part.fieldname] = String(part.value ?? '');
    }

    return { files, filenames, fields };
}

async function parseMultipartDocumentRequest(
    req: FastifyRequest,
): Promise<{ files: Array<{ buffer: Buffer; filename: string; mimetype: string }>; fields: Record<string, string> }> {
    const parts = req.parts();
    const files: Array<{ buffer: Buffer; filename: string; mimetype: string }> = [];
    const fields: Record<string, string> = {};

    for await (const part of parts) {
        if (part.type === 'file') {
            files.push({
                buffer: await part.toBuffer(),
                filename: part.filename,
                mimetype: part.mimetype,
            });
            continue;
        }

        fields[part.fieldname] = String(part.value ?? '');
    }

    return { files, fields };
}

function parseGenerateBody(fieldsOrBody: unknown) {
    const source = (fieldsOrBody ?? {}) as Record<string, unknown>;
    const parsedSource: Record<string, unknown> = { ...source };

    if (typeof source.placeholderOverrides === 'string' && source.placeholderOverrides.trim()) {
        try {
            parsedSource.placeholderOverrides = JSON.parse(source.placeholderOverrides);
        } catch {
            parsedSource.placeholderOverrides = [];
        }
    }

    return generateTemplateBodySchema.parse(parsedSource);
}

export async function rdaRoutes(fastify: FastifyInstance) {
    // Documentos
    fastify.post('/documents', rdaController.uploadDocument);
    fastify.get('/documents', rdaController.listDocuments);
    fastify.delete('/documents/:id', rdaController.deleteDocument);

    // Wiki
    fastify.post('/wiki/sync', rdaController.syncWiki);
    fastify.get('/wiki/pages', rdaController.listWikiPages);
    fastify.get('/wiki/search', rdaController.searchWiki);

    // Fase 0 - Setup e RAG
    fastify.post('/setup/:projectId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = projectParamsSchema.parse(req.params);
        const body = SetupProjectSchema.partial({ projectId: true }).parse(req.body ?? {});

        const existing = setupJobs.get(projectId);
        if (existing?.status === 'processing') {
            return reply.status(409).send({
                success: false,
                error: 'Ja existe um setup em processamento para este projeto.',
            });
        }

        const setupId = `${projectId}-${Date.now()}`;
        setupJobs.set(projectId, {
            status: 'processing',
            startedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        void projectSetupService
            .setupProject(
                projectId,
                {
                    documentTypeMappings: body.documentTypeMappings,
                    includeWiki: body.includeWiki,
                    forceReprocess: body.forceReprocess,
                    syncOperationalData: body.syncOperationalData,
                    syncMode: body.syncMode,
                },
                (progress) => {
                    const current = setupJobs.get(projectId);
                    setupJobs.set(projectId, {
                        status: 'processing',
                        startedAt: current?.startedAt ?? new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        progress: {
                            phase: progress.phase,
                            currentStep: progress.currentStep,
                            overallProgress: progress.overallProgress,
                            details: progress.details as unknown as Record<string, unknown>,
                        },
                    });
                },
            )
            .then((result) => {
                setupJobs.set(projectId, {
                    status: 'completed',
                    startedAt: setupJobs.get(projectId)?.startedAt ?? new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    result,
                });
            })
            .catch((error) => {
                setupJobs.set(projectId, {
                    status: 'failed',
                    startedAt: setupJobs.get(projectId)?.startedAt ?? new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    error: error instanceof Error ? error.message : String(error),
                });
            });

        return reply.status(202).send({
            success: true,
            data: {
                setupId,
                status: 'processing',
            },
        });
    });

    fastify.get('/setup/:projectId/status', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = projectParamsSchema.parse(req.params);
        const job = setupJobs.get(projectId);
        try {
            const setupStatus = await projectSetupService.getSetupStatus(projectId);
            return reply.send({
                success: true,
                data: {
                    ...setupStatus,
                    jobStatus: job?.status ?? null,
                    jobUpdatedAt: job?.updatedAt ?? null,
                    progress: job?.progress ?? null,
                    lastError: job?.error ?? null,
                    lastResult: job?.result ?? null,
                },
            });
        } catch (error) {
            fastify.log.warn(
                { err: error, projectId },
                '[RDA] Falha ao consultar setup status no banco. Retornando status em memoria.',
            );

            return reply.send({
                success: true,
                data: {
                    projectId,
                    isSetupComplete: false,
                    hasDocuments: false,
                    documentsChunked: 0,
                    documentsTotal: 0,
                    hasWikiSync: false,
                    wikiPagesChunked: 0,
                    hasProjectContext: false,
                    totalChunks: 0,
                    operationalData: {
                        workItemsTotal: 0,
                        sprintsTotal: 0,
                        teamMembersTotal: 0,
                        capacitiesTotal: 0,
                    },
                    jobStatus: job?.status ?? null,
                    jobUpdatedAt: job?.updatedAt ?? null,
                    progress: job?.progress ?? null,
                    lastError: job?.error ?? null,
                    lastResult: job?.result ?? null,
                },
            });
        }
    });

    fastify.post('/setup/:projectId/reset', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = projectParamsSchema.parse(req.params);

        const before = await embeddingService.getProjectChunkStats(projectId);
        await projectSetupService.resetProject(projectId);
        setupJobs.delete(projectId);

        return reply.send({
            success: true,
            data: {
                chunksDeleted: before.totalChunks,
            },
        });
    });

    fastify.post('/documents/:id/ingest', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = idParamsSchema.parse(req.params);
        const body = z
            .object({
                documentType: z
                    .enum(['visao', 'plano_trabalho', 'delivery_plan', 'requisitos', 'regras_negocio', 'prototipagem', 'outro'])
                    .optional(),
                forceReprocess: z.boolean().optional(),
            })
            .parse(req.body ?? {});

        const result = await documentIngestionService.ingestDocument(id, {
            forceReprocess: body.forceReprocess,
        });

        return reply.send({ success: true, data: result });
    });

    fastify.post('/wiki/ingest', async (req: FastifyRequest, reply: FastifyReply) => {
        const body = z.object({ projectId: z.string().min(1), forceReprocess: z.boolean().optional() }).parse(req.body ?? {});
        const result = await wikiIngestionService.processProjectWikiPages(body.projectId, {
            forceReprocess: body.forceReprocess,
        });
        return reply.send({ success: true, data: result });
    });

    fastify.post('/search', async (req: FastifyRequest, reply: FastifyReply) => {
        const body = SearchQuerySchema.parse(req.body ?? {});
        const data = await embeddingService.hybridSearch({
            projectId: body.projectId,
            query: body.query,
            topK: body.topK,
            sourceTypes: body.sourceTypes,
            minScore: body.minScore,
        });
        return reply.send({ success: true, data });
    });

    fastify.get('/chunks/stats/:projectId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = projectParamsSchema.parse(req.params);
        const stats = await embeddingService.getProjectChunkStats(projectId);
        return reply.send({ success: true, data: stats });
    });

    fastify.get('/context/:projectId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = projectParamsSchema.parse(req.params);
        const context = await projectContextService.getProjectContext(projectId);
        return reply.send({ success: true, data: context });
    });

    fastify.post('/context/:projectId/rebuild', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = projectParamsSchema.parse(req.params);
        const body = z
            .object({
                documentTypeMappings: z
                    .array(
                        z.object({
                            documentType: z.enum(['visao', 'plano_trabalho', 'delivery_plan', 'requisitos', 'regras_negocio', 'prototipagem', 'outro']),
                            fieldsToExtract: z.array(z.string()).optional(),
                            searchQueries: z.array(z.string()).optional(),
                        }),
                    )
                    .optional(),
            })
            .parse(req.body ?? {});

        const context = await projectContextService.buildProjectContext(projectId, body.documentTypeMappings as never[] | undefined);
        return reply.send({ success: true, data: context });
    });

    fastify.put('/context/:projectId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = projectParamsSchema.parse(req.params);
        const body = ProjectContextDataSchema.partial().parse(req.body ?? {});
        const context = await projectContextService.updateProjectContext(projectId, body);
        return reply.send({ success: true, data: context });
    });

    // Preparacao mensal (Etapa 1)
    fastify.post('/monthly/prepare', async (req: FastifyRequest, reply: FastifyReply) => {
        try {
            const payload = MonthlyPreparationRequestSchema.parse(req.body ?? {});
            const periodKey = `${payload.period.year}-${String(payload.period.month).padStart(2, '0')}`;
            const cacheKey = monthlyCacheKey(payload.projectId, periodKey);

            if (!process.env.AZURE_DEVOPS_ORG_URL || !process.env.AZURE_DEVOPS_PAT) {
                return reply.status(400).send({
                    success: false,
                    error: 'Variaveis AZURE_DEVOPS_ORG_URL e AZURE_DEVOPS_PAT sao obrigatorias.',
                });
            }

            const project = await prisma.project.findUnique({ where: { id: payload.projectId } });
            if (!project) {
                return reply.status(400).send({
                    success: false,
                    error: `Projeto nao encontrado: ${payload.projectId}`,
                });
            }

            const currentStatus = await monthlyPreparationService.getStatus(payload.projectId, periodKey);
            const activeJob = monthlyJobs.get(cacheKey);
            if (currentStatus?.status === 'collecting') {
                const lastUpdateTs = Date.parse(currentStatus.updatedAt);
                const staleTimeoutMs = 15 * 60 * 1000;
                const isStale = Number.isFinite(lastUpdateTs) && (Date.now() - lastUpdateTs > staleTimeoutMs);

                if (activeJob) {
                    monthlyStatusCache.set(cacheKey, currentStatus as never);
                    return reply.status(202).send({
                        success: true,
                        data: {
                            snapshotId: currentStatus.snapshotId,
                            periodKey,
                            status: 'collecting',
                        },
                    });
                }

                if (payload.forceReprocess || isStale) {
                    await monthlyPreparationService.deletePreparation(payload.projectId, periodKey);
                    monthlyStatusCache.delete(cacheKey);
                } else {
                    monthlyStatusCache.set(cacheKey, currentStatus as never);
                    return reply.status(202).send({
                        success: true,
                        data: {
                            snapshotId: currentStatus.snapshotId,
                            periodKey,
                            status: 'collecting',
                        },
                    });
                }
            }

            monthlyStatusCache.set(cacheKey, {
                snapshotId: currentStatus?.snapshotId ?? '',
                projectId: payload.projectId,
                period: periodKey,
                status: 'collecting',
                step: 'Aguardando inicializacao da preparacao mensal',
                progress: 0,
                updatedAt: new Date().toISOString(),
                workItemsStatus: 'pending',
                sprintsStatus: 'pending',
                wikiStatus: 'pending',
                documentsStatus: 'pending',
                contextStatus: 'pending',
                counters: {
                    workItemsTotal: 0,
                    workItemsNew: 0,
                    workItemsClosed: 0,
                    workItemsActive: 0,
                    sprintsCount: 0,
                    wikiPagesUpdated: 0,
                    documentsUploaded: 0,
                    chunksCreated: 0,
                },
                errors: [],
            });

            // Executa em background para evitar timeout no frontend.
            monthlyJobs.set(cacheKey, { startedAt: Date.now() });
            void monthlyPreparationService.prepareMonthly(payload, (progress) => {
                const previous = monthlyStatusCache.get(cacheKey);
                monthlyStatusCache.set(cacheKey, {
                    snapshotId: previous?.snapshotId ?? '',
                    projectId: payload.projectId,
                    period: periodKey,
                    status: progress.progress >= 100 ? 'ready' : 'collecting',
                    step: progress.step,
                    progress: progress.progress,
                    updatedAt: new Date().toISOString(),
                    workItemsStatus: progress.statuses.workItemsStatus,
                    sprintsStatus: progress.statuses.sprintsStatus,
                    wikiStatus: progress.statuses.wikiStatus,
                    documentsStatus: progress.statuses.documentsStatus,
                    contextStatus: progress.statuses.contextStatus,
                    counters: previous?.counters ?? {
                        workItemsTotal: 0,
                        workItemsNew: 0,
                        workItemsClosed: 0,
                        workItemsActive: 0,
                        sprintsCount: 0,
                        wikiPagesUpdated: 0,
                        documentsUploaded: 0,
                        chunksCreated: 0,
                    },
                    errors: previous?.errors ?? [],
                });
            }).then(async () => {
                try {
                    const finalStatus = await monthlyPreparationService.getStatus(payload.projectId, periodKey);
                    if (finalStatus) {
                        monthlyStatusCache.set(cacheKey, finalStatus as never);
                    }
                } catch (error: unknown) {
                    fastify.log.warn({ err: error, projectId: payload.projectId, periodKey }, '[RDA] Falha ao consolidar status final no cache');
                } finally {
                    monthlyJobs.delete(cacheKey);
                }
            }).catch((error: unknown) => {
                const previous = monthlyStatusCache.get(cacheKey);
                monthlyStatusCache.set(cacheKey, {
                    ...(previous ?? {
                        snapshotId: '',
                        projectId: payload.projectId,
                        period: periodKey,
                        workItemsStatus: 'pending',
                        sprintsStatus: 'pending',
                        wikiStatus: 'pending',
                        documentsStatus: 'pending',
                        contextStatus: 'pending',
                        counters: {
                            workItemsTotal: 0,
                            workItemsNew: 0,
                            workItemsClosed: 0,
                            workItemsActive: 0,
                            sprintsCount: 0,
                            wikiPagesUpdated: 0,
                            documentsUploaded: 0,
                            chunksCreated: 0,
                        },
                        errors: [],
                    }),
                    status: 'failed',
                    progress: 100,
                    step: 'Falha na preparacao mensal',
                    updatedAt: new Date().toISOString(),
                    errors: [
                        ...(previous?.errors ?? []),
                        {
                            source: 'monthly_prepare',
                            message: error instanceof Error ? error.message : String(error),
                            timestamp: new Date().toISOString(),
                        },
                    ],
                });

                fastify.log.error(
                    {
                        err: error,
                        projectId: payload.projectId,
                        periodKey,
                    },
                    '[RDA] Falha na preparacao mensal em background',
                );
                monthlyJobs.delete(cacheKey);
            });

            return reply.status(202).send({
                success: true,
                data: {
                    snapshotId: currentStatus?.snapshotId ?? null,
                    periodKey,
                    status: 'collecting',
                },
            });
        } catch (error) {
            fastify.log.error({ err: error }, '[RDA] Erro ao iniciar preparacao mensal');
            const message = error instanceof Error ? error.message : 'Falha ao iniciar preparacao mensal.';
            return reply.status(500).send({
                success: false,
                error: message,
            });
        }
    });

    fastify.get('/monthly/status/:projectId/:period', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, period } = MonthlyStatusParamsSchema.parse(req.params);
        const cacheKey = monthlyCacheKey(projectId, period);
        const cached = monthlyStatusCache.get(cacheKey);
        let status: Awaited<ReturnType<typeof monthlyPreparationService.getStatus>> | null = null;

        try {
            status = await monthlyPreparationService.getStatus(projectId, period);
        } catch (error) {
            fastify.log.warn(
                {
                    err: error,
                    projectId,
                    period,
                },
                '[RDA] Falha ao consultar status mensal no banco. Usando cache em memoria.',
            );

            if (cached) {
                return reply.send({ success: true, data: cached });
            }

            return reply.send({
                success: true,
                data: {
                    snapshotId: '',
                    projectId,
                    period,
                    status: 'collecting',
                    step: 'Aguardando disponibilidade do status',
                    progress: 0,
                    updatedAt: new Date().toISOString(),
                    workItemsStatus: 'pending',
                    sprintsStatus: 'pending',
                    wikiStatus: 'pending',
                    documentsStatus: 'pending',
                    contextStatus: 'pending',
                    counters: {
                        workItemsTotal: 0,
                        workItemsNew: 0,
                        workItemsClosed: 0,
                        workItemsActive: 0,
                        sprintsCount: 0,
                        wikiPagesUpdated: 0,
                        documentsUploaded: 0,
                        chunksCreated: 0,
                    },
                    errors: [],
                },
            });
        }

        if (!status) {
            if (cached) {
                return reply.send({ success: true, data: cached });
            }
            return reply.send({
                success: true,
                data: {
                    snapshotId: '',
                    projectId,
                    period,
                    status: 'collecting',
                    step: 'Aguardando inicializacao da preparacao mensal',
                    progress: 0,
                    updatedAt: new Date().toISOString(),
                    workItemsStatus: 'pending',
                    sprintsStatus: 'pending',
                    wikiStatus: 'pending',
                    documentsStatus: 'pending',
                    contextStatus: 'pending',
                    counters: {
                        workItemsTotal: 0,
                        workItemsNew: 0,
                        workItemsClosed: 0,
                        workItemsActive: 0,
                        sprintsCount: 0,
                        wikiPagesUpdated: 0,
                        documentsUploaded: 0,
                        chunksCreated: 0,
                    },
                    errors: [],
                },
            });
        }

        monthlyStatusCache.set(cacheKey, status as never);
        return reply.send({ success: true, data: status });
    });

    fastify.get('/monthly/snapshots/:projectId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = MonthlyProjectParamsSchema.parse(req.params);
        const snapshots = await monthlyPreparationService.listSnapshots(projectId);
        return reply.send({ success: true, data: snapshots });
    });

    fastify.get('/monthly/snapshot/:projectId/:period', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, period } = MonthlyStatusParamsSchema.parse(req.params);
        const snapshot = await monthlyPreparationService.getSnapshotDetail(projectId, period);

        if (!snapshot) {
            return reply.status(404).send({ success: false, error: 'Snapshot mensal nao encontrado.' });
        }

        return reply.send({ success: true, data: snapshot });
    });

    fastify.get('/monthly/workitems/:projectId/:period', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, period } = MonthlyStatusParamsSchema.parse(req.params);
        const filters = MonthlyWorkItemsFilterSchema.parse(req.query ?? {});
        const data = await monthlyPreparationService.listWorkItems(projectId, period, filters);
        return reply.send({ success: true, data });
    });

    fastify.get('/monthly/sprints/:projectId/:period', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, period } = MonthlyStatusParamsSchema.parse(req.params);
        const items = await monthlyPreparationService.listSprints(projectId, period);
        return reply.send({ success: true, data: items });
    });

    fastify.delete('/monthly/:projectId/:period', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, period } = MonthlyStatusParamsSchema.parse(req.params);
        const result = await monthlyPreparationService.deletePreparation(projectId, period);
        return reply.send({ success: true, data: result });
    });

    fastify.post('/monthly/upload-documents/:projectId/:period', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, period } = MonthlyStatusParamsSchema.parse(req.params);
        PeriodKeySchema.parse(period);

        const { files, fields } = await parseMultipartDocumentRequest(req);
        if (files.length === 0) {
            return reply.status(400).send({ success: false, error: 'Nenhum arquivo enviado.' });
        }

        const uploadedBy = fields.uploadedBy || 'monthly-preparation';
        const results = [];

        for (const file of files) {
            const saved = await documentService.uploadDocument({
                projectId,
                filename: file.filename,
                buffer: file.buffer,
                mimeType: file.mimetype,
                uploadedBy,
            });

            const ingestion = await documentIngestionService.ingestDocument(saved.id, { forceReprocess: true });
            await monthlyPreparationService.attachDocumentToPeriod(projectId, period, saved.id);

            results.push({
                documentId: saved.id,
                filename: file.filename,
                ingestion,
            });
        }

        return reply.send({ success: true, data: results });
    });

    // Geração RDA
    fastify.post('/generate', async (req: FastifyRequest, reply: FastifyReply) => {
        const payload = generateRDASchema.parse(req.body);
        const generation = await rdaService.generateRDA(payload);
        return reply.status(202).send({ success: true, data: generation });
    });

    fastify.get('/project/:projectId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = projectParamsSchema.parse(req.params);
        const history = await rdaService.listRDAs(projectId);
        return reply.send({ success: true, data: history });
    });

    fastify.get('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = idParamsSchema.parse(req.params);
        const generation = await rdaService.getRDAById(id);
        return reply.send({ success: true, data: generation });
    });

    fastify.get('/:id/download', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = idParamsSchema.parse(req.params);
        const file = await rdaService.downloadRDA(id);

        reply
            .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            .header('Content-Disposition', `attachment; filename="rda-${id}.docx"`);

        return reply.send(file);
    });

    fastify.delete('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = idParamsSchema.parse(req.params);
        await rdaService.cancelGeneration(id);
        return reply.send({ success: true });
    });

    fastify.post('/:id/retry', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = idParamsSchema.parse(req.params);
        const retried = await rdaService.retryGeneration(id);
        return reply.send({ success: true, data: retried });
    });

    // Template Factory
    fastify.post('/template-factory/analyze', async (req: FastifyRequest, reply: FastifyReply) => {
        const { files, filenames, fields } = await parseMultipartDocxRequest(req);
        const body = analyzeModelsBodySchema.parse(fields);

        if (files.length < 2 || files.length > 5) {
            return reply.status(400).send({
                success: false,
                error: 'Envie entre 2 e 5 arquivos DOCX para analise.',
            });
        }

        const analysis = await templateFactoryService.analyzeModels(files, filenames, body.projectId);
        return reply.status(201).send({
            success: true,
            data: {
                analysisId: analysis.id,
                createdAt: analysis.createdAt,
                structures: analysis.structures,
                analysis: analysis.analysis,
            },
        });
    });

    fastify.post('/template-factory/generate', async (req: FastifyRequest, reply: FastifyReply) => {
        const contentType = String(req.headers['content-type'] ?? '');

        if (contentType.includes('multipart/form-data')) {
            const { files, filenames, fields } = await parseMultipartDocxRequest(req);
            const body = parseGenerateBody(fields);

            if (body.analysisId) {
                const result = await templateFactoryService.createTemplateFromAnalysis(
                    body.analysisId,
                    body.placeholderOverrides,
                );
                return reply.status(201).send({ success: true, data: result });
            }

            if (files.length < 2 || files.length > 5) {
                return reply.status(400).send({
                    success: false,
                    error: 'Envie entre 2 e 5 arquivos DOCX para gerar sem analysisId.',
                });
            }

            const result = await templateFactoryService.createTemplateFromModels(
                files,
                filenames,
                body.projectId,
                body.placeholderOverrides,
            );
            return reply.status(201).send({ success: true, data: result });
        }

        const body = parseGenerateBody(req.body as Record<string, unknown>);
        if (!body.analysisId) {
            return reply.status(400).send({
                success: false,
                error: 'analysisId e obrigatorio quando nao ha upload de arquivos.',
            });
        }
        const result = await templateFactoryService.createTemplateFromAnalysis(
            body.analysisId,
            body.placeholderOverrides,
        );

        return reply.status(201).send({ success: true, data: result });
    });

    fastify.get('/template-factory/:id/status', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = templateFactoryStatusParamsSchema.parse(req.params);
        const status = await templateFactoryService.getAnalysisStatus(id);

        if (!status) {
            return reply.status(404).send({
                success: false,
                error: 'Analise nao encontrada.',
            });
        }

        return reply.send({ success: true, data: status });
    });

    fastify.get('/schemas', async (req: FastifyRequest, reply: FastifyReply) => {
        const query = z.object({ projectId: z.string().optional() }).parse(req.query);
        const list = await templateFactoryService.listSchemas(query.projectId);
        return reply.send({ success: true, data: list });
    });
}

