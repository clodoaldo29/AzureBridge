import { prisma } from '@/database/client';
import { syncService } from '@/services/sync.service';
import { wikiService } from '@/services/rda/wiki.service';
import { documentIngestionService } from '@/modules/rda/services/document-ingestion.service';
import { wikiIngestionService } from '@/modules/rda/services/wiki-ingestion.service';
import { chunkingService } from '@/modules/rda/services/chunking.service';
import { embeddingService } from '@/modules/rda/services/embedding.service';
import { projectContextService } from '@/modules/rda/services/project-context.service';
import type { MonthPeriod, MonthlyPreparationRequest } from '@/modules/rda/schemas/monthly.schema';

type StepStatus = 'pending' | 'collecting' | 'done' | 'error';

interface MonthlyWorkItemFilters {
    type?: string;
    state?: string;
    assignedTo?: string;
    page: number;
    pageSize: number;
}

export interface MonthlyPreparationProgress {
    step: string;
    progress: number;
    statuses: {
        workItemsStatus: StepStatus;
        sprintsStatus: StepStatus;
        wikiStatus: StepStatus;
        documentsStatus: StepStatus;
        contextStatus: StepStatus;
    };
}

interface ErrorItem {
    source: string;
    message: string;
    timestamp: string;
}

export class MonthlyPreparationService {
    async prepareMonthly(
        input: MonthlyPreparationRequest,
        onProgress?: (progress: MonthlyPreparationProgress) => Promise<void> | void,
    ): Promise<{ snapshotId: string; periodKey: string }> {
        const periodKey = this.toPeriodKey(input.period);
        const [periodStart, periodEnd] = this.resolvePeriodRange(input.period);

        const project = await prisma.project.findUnique({ where: { id: input.projectId } });
        if (!project) {
            throw new Error(`Projeto nao encontrado: ${input.projectId}`);
        }

        const existingSnapshot = await this.getSnapshot(input.projectId, periodKey);
        if (existingSnapshot?.status === 'ready' && !input.forceReprocess) {
            return { snapshotId: existingSnapshot.id, periodKey };
        }

        if (input.forceReprocess && existingSnapshot) {
            await this.deletePreparation(input.projectId, periodKey);
        }

        const snapshot = await this.ensureSnapshot(input.projectId, periodKey);
        const errors: ErrorItem[] = [];

        try {
            await this.emitProgress(snapshot.id, {
                step: 'Iniciando preparacao mensal',
                progress: 2,
                statuses: {
                    workItemsStatus: 'pending',
                    sprintsStatus: 'pending',
                    wikiStatus: 'pending',
                    documentsStatus: 'pending',
                    contextStatus: 'pending',
                },
            }, onProgress);

        // 1) Sync operacional
        if (input.includeOperationalSync && input.syncMode !== 'none') {
            try {
                if (input.syncMode === 'full') {
                    await syncService.fullSync();
                } else {
                    await syncService.incrementalSync();
                }
            } catch (error) {
                errors.push(this.toErrorItem('operational_sync', error));
            }
        }

        // 2) Work items do periodo + snapshots + chunks
        let workItemsStatus: StepStatus = 'collecting';
        let sprintsStatus: StepStatus = 'pending';
        let wikiStatus: StepStatus = 'pending';
        let documentsStatus: StepStatus = 'pending';
        let contextStatus: StepStatus = 'pending';

        await this.emitProgress(snapshot.id, {
            step: 'Coletando work items do periodo',
            progress: 15,
            statuses: { workItemsStatus, sprintsStatus, wikiStatus, documentsStatus, contextStatus },
        }, onProgress);

        let workItemsTotal = 0;
        let workItemsNew = 0;
        let workItemsClosed = 0;
        let workItemsActive = 0;
        let workItemChunks = 0;

        try {
            const workItems = await prisma.workItem.findMany({
                where: {
                    projectId: input.projectId,
                    OR: [
                        { createdDate: { gte: periodStart, lte: periodEnd } },
                        { changedDate: { gte: periodStart, lte: periodEnd } },
                        { closedDate: { gte: periodStart, lte: periodEnd } },
                    ],
                },
                include: {
                    assignedTo: {
                        select: {
                            displayName: true,
                        },
                    },
                },
                orderBy: { changedDate: 'desc' },
            });

            workItemsTotal = workItems.length;
            workItemsNew = workItems.filter((wi) => wi.createdDate >= periodStart && wi.createdDate <= periodEnd).length;
            workItemsClosed = workItems.filter((wi) => wi.closedDate && wi.closedDate >= periodStart && wi.closedDate <= periodEnd).length;
            workItemsActive = workItems.filter((wi) => !/closed|done|removed|resolved/i.test(wi.state)).length;

            await this.deleteSnapshotChunks(input.projectId, 'workitem', periodKey);

            const chunkRows: Array<{
                projectId: string;
                content: string;
                metadata: Record<string, unknown>;
                sourceType: 'workitem';
                chunkIndex: number;
                tokenCount: number;
            }> = [];

            let globalChunkIndex = 0;

            for (const wi of workItems) {
                await prisma.rDAWorkItemSnapshot.upsert({
                    where: {
                        projectId_workItemId_periodKey: {
                            projectId: input.projectId,
                            workItemId: wi.id,
                            periodKey,
                        },
                    },
                    create: {
                        projectId: input.projectId,
                        workItemId: wi.id,
                        type: wi.type,
                        title: wi.title,
                        state: wi.state,
                        assignedTo: wi.assignedTo?.displayName ?? null,
                        areaPath: wi.areaPath ?? null,
                        iterationPath: wi.iterationPath ?? null,
                        tags: wi.tags.length > 0 ? wi.tags.join(';') : null,
                        priority: wi.priority ?? null,
                        storyPoints: wi.storyPoints ?? null,
                        description: this.stripHtml(wi.description ?? null),
                        acceptanceCriteria: this.stripHtml(wi.acceptanceCriteria ?? null),
                        createdDate: wi.createdDate,
                        changedDate: wi.changedDate,
                        closedDate: wi.closedDate ?? null,
                        parentId: wi.parentId ?? null,
                        url: wi.url ?? null,
                        periodKey,
                    },
                    update: {
                        type: wi.type,
                        title: wi.title,
                        state: wi.state,
                        assignedTo: wi.assignedTo?.displayName ?? null,
                        areaPath: wi.areaPath ?? null,
                        iterationPath: wi.iterationPath ?? null,
                        tags: wi.tags.length > 0 ? wi.tags.join(';') : null,
                        priority: wi.priority ?? null,
                        storyPoints: wi.storyPoints ?? null,
                        description: this.stripHtml(wi.description ?? null),
                        acceptanceCriteria: this.stripHtml(wi.acceptanceCriteria ?? null),
                        changedDate: wi.changedDate,
                        closedDate: wi.closedDate ?? null,
                        parentId: wi.parentId ?? null,
                        url: wi.url ?? null,
                        collectedAt: new Date(),
                    },
                });

                const workItemText = [
                    `Work Item ${wi.id}`,
                    `Tipo: ${wi.type}`,
                    `Estado: ${wi.state}`,
                    `Titulo: ${wi.title}`,
                    `Responsavel: ${wi.assignedTo?.displayName ?? 'Nao informado'}`,
                    `Sprint: ${wi.iterationPath ?? 'Nao informado'}`,
                    `Story Points: ${wi.storyPoints ?? 0}`,
                    `URL: ${wi.url ?? ''}`,
                    `Descricao: ${this.stripHtml(wi.description ?? '')}`,
                    `Criterios de aceite: ${this.stripHtml(wi.acceptanceCriteria ?? '')}`,
                ].join('\n');

                const chunks = chunkingService.chunkText({
                    text: workItemText,
                    sourceType: 'workitem',
                    documentName: `WI-${wi.id}`,
                });

                for (const chunk of chunks) {
                    chunkRows.push({
                        projectId: input.projectId,
                        content: chunk.content,
                        metadata: {
                            ...chunk.metadata,
                            periodKey,
                            workItemId: wi.id,
                            title: wi.title,
                            type: wi.type,
                            state: wi.state,
                            url: wi.url,
                        },
                        sourceType: 'workitem',
                        chunkIndex: globalChunkIndex++,
                        tokenCount: chunk.tokenCount,
                    });
                }
            }

            if (chunkRows.length > 0) {
                const embeddings = await embeddingService.generateEmbeddingsBatch(chunkRows.map((row) => row.content));
                const rowsToStore = chunkRows.map((row, index) => ({
                    ...row,
                    embedding: embeddings[index]?.embedding ?? [],
                })).filter((row) => row.embedding.length > 0);

                workItemChunks = await embeddingService.storeChunksWithEmbeddings(rowsToStore);
            }

            workItemsStatus = 'done';
        } catch (error) {
            workItemsStatus = 'error';
            errors.push(this.toErrorItem('workitems', error));
        }

        // 3) Sprints do periodo
        sprintsStatus = 'collecting';
        await this.emitProgress(snapshot.id, {
            step: 'Consolidando sprints do periodo',
            progress: 42,
            statuses: { workItemsStatus, sprintsStatus, wikiStatus, documentsStatus, contextStatus },
        }, onProgress);

        let sprintsCount = 0;
        let sprintChunks = 0;
        try {
            const sprints = await prisma.sprint.findMany({
                where: {
                    projectId: input.projectId,
                    startDate: { lte: periodEnd },
                    endDate: { gte: periodStart },
                },
                orderBy: { startDate: 'asc' },
            });

            sprintsCount = sprints.length;
            await this.deleteSnapshotChunks(input.projectId, 'sprint', periodKey);

            const sprintChunkRows: Array<{
                projectId: string;
                content: string;
                metadata: Record<string, unknown>;
                sourceType: 'sprint';
                chunkIndex: number;
                tokenCount: number;
            }> = [];

            let sprintChunkIndex = 0;

            for (const sprint of sprints) {
                const scopedWIs = await prisma.workItem.findMany({
                    where: {
                        projectId: input.projectId,
                        iterationPath: sprint.path,
                    },
                    select: {
                        id: true,
                        type: true,
                        state: true,
                        storyPoints: true,
                    },
                });

                const tasksByState = this.groupByState(scopedWIs.filter((wi) => /task/i.test(wi.type)));
                const bugsByState = this.groupByState(scopedWIs.filter((wi) => /bug/i.test(wi.type)));
                const storiesByState = this.groupByState(scopedWIs.filter((wi) => /story|product backlog item/i.test(wi.type)));

                const totalStoryPoints = scopedWIs.reduce((acc, wi) => acc + (wi.storyPoints ?? 0), 0);
                const completedStoryPoints = scopedWIs
                    .filter((wi) => /done|closed|resolved/i.test(wi.state))
                    .reduce((acc, wi) => acc + (wi.storyPoints ?? 0), 0);

                const sprintCapacity = await prisma.teamCapacity.aggregate({
                    where: {
                        sprintId: sprint.id,
                    },
                    _sum: {
                        availableHours: true,
                    },
                });

                const velocity = totalStoryPoints > 0
                    ? Number(((completedStoryPoints / totalStoryPoints) * 100).toFixed(2))
                    : 0;

                await prisma.rDASprintSnapshot.upsert({
                    where: {
                        projectId_iterationPath_period: {
                            projectId: input.projectId,
                            iterationPath: sprint.path,
                            period: periodKey,
                        },
                    },
                    create: {
                        projectId: input.projectId,
                        sprintName: sprint.name,
                        iterationPath: sprint.path,
                        startDate: sprint.startDate,
                        endDate: sprint.endDate,
                        totalWorkItems: scopedWIs.length,
                        completedItems: scopedWIs.filter((wi) => /done|closed|resolved/i.test(wi.state)).length,
                        activeItems: scopedWIs.filter((wi) => /active|in progress|committed/i.test(wi.state)).length,
                        newItems: scopedWIs.filter((wi) => /new|to do/i.test(wi.state)).length,
                        removedItems: scopedWIs.filter((wi) => /removed/i.test(wi.state)).length,
                        totalStoryPoints,
                        completedStoryPoints,
                        tasksByState,
                        bugsByState,
                        storiesByState,
                        teamCapacity: sprintCapacity._sum.availableHours ?? 0,
                        velocity,
                        taskboardUrl: this.buildTaskboardUrl(project.name, sprint.name),
                        period: periodKey,
                    },
                    update: {
                        totalWorkItems: scopedWIs.length,
                        completedItems: scopedWIs.filter((wi) => /done|closed|resolved/i.test(wi.state)).length,
                        activeItems: scopedWIs.filter((wi) => /active|in progress|committed/i.test(wi.state)).length,
                        newItems: scopedWIs.filter((wi) => /new|to do/i.test(wi.state)).length,
                        removedItems: scopedWIs.filter((wi) => /removed/i.test(wi.state)).length,
                        totalStoryPoints,
                        completedStoryPoints,
                        tasksByState,
                        bugsByState,
                        storiesByState,
                        teamCapacity: sprintCapacity._sum.availableHours ?? 0,
                        velocity,
                        taskboardUrl: this.buildTaskboardUrl(project.name, sprint.name),
                        collectedAt: new Date(),
                    },
                });

                const sprintText = [
                    `Sprint: ${sprint.name}`,
                    `Iteration Path: ${sprint.path}`,
                    `Periodo: ${sprint.startDate.toISOString().slice(0, 10)} a ${sprint.endDate.toISOString().slice(0, 10)}`,
                    `Total itens: ${scopedWIs.length}`,
                    `Concluidos: ${scopedWIs.filter((wi) => /done|closed|resolved/i.test(wi.state)).length}`,
                    `Ativos: ${scopedWIs.filter((wi) => /active|in progress|committed/i.test(wi.state)).length}`,
                    `Story Points: ${completedStoryPoints}/${totalStoryPoints}`,
                    `Velocity (%): ${velocity}`,
                    `Taskboard URL: ${this.buildTaskboardUrl(project.name, sprint.name)}`,
                ].join('\n');

                const chunks = chunkingService.chunkText({
                    text: sprintText,
                    sourceType: 'sprint',
                    documentName: `SPRINT-${sprint.name}`,
                });

                for (const chunk of chunks) {
                    sprintChunkRows.push({
                        projectId: input.projectId,
                        content: chunk.content,
                        metadata: {
                            ...chunk.metadata,
                            periodKey,
                            sprintId: sprint.id,
                            sprintName: sprint.name,
                            iterationPath: sprint.path,
                        },
                        sourceType: 'sprint',
                        chunkIndex: sprintChunkIndex++,
                        tokenCount: chunk.tokenCount,
                    });
                }
            }

            if (sprintChunkRows.length > 0) {
                const embeddings = await embeddingService.generateEmbeddingsBatch(sprintChunkRows.map((row) => row.content));
                const rowsToStore = sprintChunkRows.map((row, index) => ({
                    ...row,
                    embedding: embeddings[index]?.embedding ?? [],
                })).filter((row) => row.embedding.length > 0);

                sprintChunks = await embeddingService.storeChunksWithEmbeddings(rowsToStore);
            }

            sprintsStatus = 'done';
        } catch (error) {
            sprintsStatus = 'error';
            errors.push(this.toErrorItem('sprints', error));
        }

        // 4) Wiki incremental + chunks
        wikiStatus = 'collecting';
        await this.emitProgress(snapshot.id, {
            step: 'Sincronizando wiki do periodo',
            progress: 64,
            statuses: { workItemsStatus, sprintsStatus, wikiStatus, documentsStatus, contextStatus },
        }, onProgress);

        let wikiPagesUpdated = 0;
        try {
            if (input.includeWiki) {
                const wikiResult = await this.withRetry(() => wikiService.syncWikiPages(input.projectId), 3, 1200);
                wikiPagesUpdated = wikiResult.synced;
                await this.withRetry(() => wikiIngestionService.processProjectWikiPages(input.projectId, {
                    forceReprocess: input.forceReprocessChunks,
                }), 3, 1200);
            }
            wikiStatus = 'done';
        } catch (error) {
            if (this.isDatabaseConnectivityError(error)) {
                wikiStatus = 'done';
                errors.push(this.toErrorItem('wiki_warning', error));
            } else {
                wikiStatus = 'error';
                errors.push(this.toErrorItem('wiki', error));
            }
        }

        // 5) Documentos novos do periodo
        documentsStatus = 'collecting';
        await this.emitProgress(snapshot.id, {
            step: 'Processando documentos novos do periodo',
            progress: 78,
            statuses: { workItemsStatus, sprintsStatus, wikiStatus, documentsStatus, contextStatus },
        }, onProgress);

        let documentsUploaded = 0;
        try {
            const docs = await prisma.document.findMany({
                where: {
                    projectId: input.projectId,
                    createdAt: { gte: periodStart, lte: periodEnd },
                },
                orderBy: { createdAt: 'asc' },
            });

            let missingFiles = 0;
            for (const doc of docs) {
                try {
                    await documentIngestionService.ingestDocument(doc.id, {
                        forceReprocess: input.forceReprocessChunks,
                    });
                    documentsUploaded += 1;
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    if (message.includes('Arquivo do documento nao encontrado em disco')) {
                        missingFiles += 1;
                        errors.push(this.toErrorItem('documents_warning', error));
                        continue;
                    }
                    throw error;
                }
            }
            if (missingFiles > 0 && documentsUploaded === 0 && docs.length > 0) {
                documentsStatus = 'error';
            } else {
                documentsStatus = 'done';
            }
        } catch (error) {
            documentsStatus = 'error';
            errors.push(this.toErrorItem('documents', error));
        }

        // 6) Contexto
        contextStatus = 'collecting';
        await this.emitProgress(snapshot.id, {
            step: 'Atualizando ProjectContext',
            progress: 90,
            statuses: { workItemsStatus, sprintsStatus, wikiStatus, documentsStatus, contextStatus },
        }, onProgress);

        try {
            if (input.refreshProjectContext) {
                await this.withRetry(() => projectContextService.buildProjectContext(input.projectId), 3, 1500);
            } else {
                const existingContext = await projectContextService.getProjectContext(input.projectId);
                if (!existingContext) {
                    await this.withRetry(() => projectContextService.buildProjectContext(input.projectId), 3, 1500);
                }
            }
            contextStatus = 'done';
        } catch (error) {
            const fallbackContext = await projectContextService.getProjectContext(input.projectId).catch(() => null);
            if (fallbackContext) {
                contextStatus = 'done';
            } else {
                contextStatus = 'error';
                errors.push(this.toErrorItem('context', error));
            }
        }

        const stats = await embeddingService.getProjectChunkStats(input.projectId);
        const chunksCreated = workItemChunks + sprintChunks;
        const criticalErrorSources = new Set(['workitems', 'sprints', 'wiki', 'documents', 'context', 'prepare_monthly']);
        const hasCriticalErrors = errors.some((item) => criticalErrorSources.has(item.source));
        const finalStatus = hasCriticalErrors ? 'failed' : 'ready';

        await prisma.rDAMonthlySnapshot.update({
            where: { id: snapshot.id },
            data: {
                status: finalStatus,
                workItemsTotal,
                workItemsNew,
                workItemsClosed,
                workItemsActive,
                sprintsCount,
                wikiPagesUpdated,
                documentsUploaded,
                chunksCreated,
                workItemsStatus,
                sprintsStatus,
                wikiStatus,
                documentsStatus,
                contextStatus,
                errors: errors as unknown as object,
                metadata: {
                    totalProjectChunks: stats.totalChunks,
                    totalProjectTokens: stats.totalTokens,
                } as unknown as object,
                completedAt: new Date(),
            },
        });

        await this.emitProgress(snapshot.id, {
            step: finalStatus === 'ready' ? 'Preparacao mensal concluida' : 'Preparacao mensal concluida com alertas',
            progress: 100,
            statuses: { workItemsStatus, sprintsStatus, wikiStatus, documentsStatus, contextStatus },
        }, onProgress);

            return { snapshotId: snapshot.id, periodKey };
        } catch (error) {
            const unexpected = this.toErrorItem('prepare_monthly', error);
            errors.push(unexpected);

            await prisma.rDAMonthlySnapshot.update({
                where: { id: snapshot.id },
                data: {
                    status: 'failed',
                    errors: errors as unknown as object,
                    metadata: {
                        progress: 100,
                        currentStep: 'Falha inesperada na preparacao mensal',
                    } as unknown as object,
                    completedAt: new Date(),
                },
            });

            throw error;
        }
    }

    async getSnapshot(projectId: string, periodKey: string) {
        return prisma.rDAMonthlySnapshot.findUnique({
            where: {
                projectId_period: {
                    projectId,
                    period: periodKey,
                },
            },
        });
    }

    async getStatus(projectId: string, periodKey: string) {
        const snapshot = await this.getSnapshot(projectId, periodKey);
        if (!snapshot) {
            return null;
        }

        const metadata = (snapshot.metadata ?? {}) as Record<string, unknown>;
        const progress = Number(metadata.progress ?? 0);
        const step = String(metadata.currentStep ?? 'Aguardando processamento');

        return {
            snapshotId: snapshot.id,
            projectId,
            period: snapshot.period,
            status: snapshot.status as 'collecting' | 'ready' | 'failed',
            step,
            progress,
            updatedAt: snapshot.updatedAt.toISOString(),
            workItemsStatus: snapshot.workItemsStatus as StepStatus,
            sprintsStatus: snapshot.sprintsStatus as StepStatus,
            wikiStatus: snapshot.wikiStatus as StepStatus,
            documentsStatus: snapshot.documentsStatus as StepStatus,
            contextStatus: snapshot.contextStatus as StepStatus,
            counters: {
                workItemsTotal: snapshot.workItemsTotal,
                workItemsNew: snapshot.workItemsNew,
                workItemsClosed: snapshot.workItemsClosed,
                workItemsActive: snapshot.workItemsActive,
                sprintsCount: snapshot.sprintsCount,
                wikiPagesUpdated: snapshot.wikiPagesUpdated,
                documentsUploaded: snapshot.documentsUploaded,
                chunksCreated: snapshot.chunksCreated,
            },
            errors: ((snapshot.errors as unknown as ErrorItem[]) ?? []),
        };
    }

    async listSnapshots(projectId: string) {
        return prisma.rDAMonthlySnapshot.findMany({
            where: { projectId },
            orderBy: { period: 'desc' },
        });
    }

    async getSnapshotDetail(projectId: string, periodKey: string) {
        const snapshot = await this.getSnapshot(projectId, periodKey);
        if (!snapshot) {
            return null;
        }

        const [workItemsCount, sprintsCount, chunkStatsRows] = await Promise.all([
            prisma.rDAWorkItemSnapshot.count({ where: { projectId, periodKey } }),
            prisma.rDASprintSnapshot.count({ where: { projectId, period: periodKey } }),
            prisma.$queryRaw<Array<{ sourceType: string; total: bigint | number | string }>>`
                SELECT "sourceType", COUNT(*) AS total
                FROM "document_chunks"
                WHERE "projectId" = ${projectId}
                  AND "metadata"->>'periodKey' = ${periodKey}
                GROUP BY "sourceType"
            `,
        ]);

        const chunksBySourceType: Record<string, number> = {};
        for (const row of chunkStatsRows) {
            chunksBySourceType[row.sourceType] = Number(row.total ?? 0);
        }

        return {
            ...snapshot,
            stats: {
                workItemsCount,
                sprintsCount,
                chunksBySourceType,
            },
        };
    }

    async listWorkItems(projectId: string, periodKey: string, filters: MonthlyWorkItemFilters) {
        const where = {
            projectId,
            periodKey,
            ...(filters.type ? { type: filters.type } : {}),
            ...(filters.state ? { state: filters.state } : {}),
            ...(filters.assignedTo ? { assignedTo: filters.assignedTo } : {}),
        };

        const [total, items] = await Promise.all([
            prisma.rDAWorkItemSnapshot.count({ where }),
            prisma.rDAWorkItemSnapshot.findMany({
                where,
                orderBy: [{ changedDate: 'desc' }, { workItemId: 'desc' }],
                skip: (filters.page - 1) * filters.pageSize,
                take: filters.pageSize,
            }),
        ]);

        return {
            items,
            total,
            page: filters.page,
            pageSize: filters.pageSize,
            totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
        };
    }

    async listSprints(projectId: string, periodKey: string) {
        return prisma.rDASprintSnapshot.findMany({
            where: { projectId, period: periodKey },
            orderBy: [{ startDate: 'asc' }, { sprintName: 'asc' }],
        });
    }

    async deletePreparation(projectId: string, periodKey: string) {
        const chunksRemoved = await prisma.$executeRaw`
            DELETE FROM "document_chunks"
            WHERE "projectId" = ${projectId}
              AND "metadata"->>'periodKey' = ${periodKey}
              AND "sourceType" IN ('workitem', 'sprint')
        `;

        await prisma.rDAWorkItemSnapshot.deleteMany({
            where: { projectId, periodKey },
        });

        await prisma.rDASprintSnapshot.deleteMany({
            where: { projectId, period: periodKey },
        });

        await prisma.rDAMonthlySnapshot.deleteMany({
            where: { projectId, period: periodKey },
        });

        return { deleted: true, chunksRemoved: Number(chunksRemoved ?? 0) };
    }

    async attachDocumentToPeriod(projectId: string, periodKey: string, documentId: string) {
        await prisma.$executeRaw`
            UPDATE "document_chunks"
            SET "metadata" = "metadata" || jsonb_build_object('periodKey', ${periodKey}, 'scope', 'monthly')
            WHERE "projectId" = ${projectId}
              AND "documentId" = ${documentId}
              AND "sourceType" = 'document'
        `;
    }

    private async ensureSnapshot(projectId: string, periodKey: string) {
        return prisma.rDAMonthlySnapshot.upsert({
            where: {
                projectId_period: {
                    projectId,
                    period: periodKey,
                },
            },
            create: {
                projectId,
                period: periodKey,
                status: 'collecting',
                startedAt: new Date(),
                errors: [],
            },
            update: {
                status: 'collecting',
                startedAt: new Date(),
                completedAt: null,
                errors: [],
                workItemsStatus: 'pending',
                sprintsStatus: 'pending',
                wikiStatus: 'pending',
                documentsStatus: 'pending',
                contextStatus: 'pending',
                chunksCreated: 0,
            },
        });
    }

    private async emitProgress(
        snapshotId: string,
        progress: MonthlyPreparationProgress,
        onProgress?: (progress: MonthlyPreparationProgress) => Promise<void> | void,
    ) {
        await prisma.rDAMonthlySnapshot.update({
            where: { id: snapshotId },
            data: {
                status: progress.progress >= 100 ? undefined : 'collecting',
                workItemsStatus: progress.statuses.workItemsStatus,
                sprintsStatus: progress.statuses.sprintsStatus,
                wikiStatus: progress.statuses.wikiStatus,
                documentsStatus: progress.statuses.documentsStatus,
                contextStatus: progress.statuses.contextStatus,
                metadata: {
                    progress: progress.progress,
                    currentStep: progress.step,
                } as unknown as object,
            },
        });

        if (onProgress) {
            await onProgress(progress);
        }
    }

    private toPeriodKey(period: MonthPeriod): string {
        return `${period.year}-${String(period.month).padStart(2, '0')}`;
    }

    private resolvePeriodRange(period: MonthPeriod): [Date, Date] {
        const start = new Date(Date.UTC(period.year, period.month - 1, 1, 0, 0, 0));
        const end = new Date(Date.UTC(period.year, period.month, 0, 23, 59, 59));
        return [start, end];
    }

    private toErrorItem(source: string, error: unknown): ErrorItem {
        return {
            source,
            message: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
        };
    }

    private stripHtml(input: string | null): string | null {
        if (!input) return null;
        return input
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private groupByState(items: Array<{ state: string }>): Record<string, number> {
        return items.reduce<Record<string, number>>((acc, item) => {
            const key = item.state || 'Unknown';
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
        }, {});
    }

    private buildTaskboardUrl(projectName: string, sprintName: string): string {
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL ?? '';
        if (!orgUrl) return '';
        const encodedProject = encodeURIComponent(projectName);
        const encodedSprint = encodeURIComponent(sprintName);
        return `${orgUrl}/${encodedProject}/${encodedProject}/_sprints/taskboard/${encodedSprint}`;
    }

    private async deleteSnapshotChunks(projectId: string, sourceType: 'workitem' | 'sprint', periodKey: string): Promise<void> {
        await prisma.$executeRaw`
            DELETE FROM "document_chunks"
            WHERE "projectId" = ${projectId}
              AND "sourceType" = ${sourceType}
              AND "metadata"->>'periodKey' = ${periodKey}
        `;
    }

    private async withRetry<T>(fn: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
        let lastError: unknown;
        for (let i = 0; i < attempts; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                if (i < attempts - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                }
            }
        }
        throw lastError;
    }

    private isDatabaseConnectivityError(error: unknown): boolean {
        const message = error instanceof Error ? error.message : String(error);
        return message.includes("Can't reach database server") || message.includes('P1001');
    }
}

export const monthlyPreparationService = new MonthlyPreparationService();
