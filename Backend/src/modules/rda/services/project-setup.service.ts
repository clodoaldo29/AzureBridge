import { prisma } from '@/database/client';
import { wikiService } from '@/services/rda/wiki.service';
import { IngestionProgress, IngestionResult, WikiSyncResult } from '@/modules/rda/schemas/rag.schema';
import { ChunkStats, EmbeddingService, embeddingService } from '@/modules/rda/services/embedding.service';
import { DocumentIngestionService, documentIngestionService } from '@/modules/rda/services/document-ingestion.service';
import { MappingInput, ProjectContextService, projectContextService } from '@/modules/rda/services/project-context.service';
import { WikiIngestionService, wikiIngestionService } from '@/modules/rda/services/wiki-ingestion.service';
import { syncService } from '@/services/sync.service';

export interface SetupProgress {
    phase: 'operational' | 'documents' | 'wiki' | 'context' | 'completed';
    currentStep: string;
    overallProgress: number;
    details: {
        workItemsTotal: number;
        sprintsTotal: number;
        teamMembersTotal: number;
        capacitiesTotal: number;
        documentsTotal: number;
        documentsProcessed: number;
        wikiPagesTotal: number;
        wikiPagesProcessed: number;
        contextFields: number;
        contextFieldsExtracted: number;
    };
}

export interface SetupResult {
    projectId: string;
    documentsIngested: number;
    wikiPagesIngested: number;
    totalChunks: number;
    totalEmbeddings: number;
    projectContextBuilt: boolean;
    operationalData: {
        workItemsTotal: number;
        sprintsTotal: number;
        teamMembersTotal: number;
        capacitiesTotal: number;
    };
    errors: Array<{ source: string; error: string }>;
    duration: number;
    stats: ChunkStats & {
        embeddingCost: number;
    };
}

export interface SetupStatus {
    projectId: string;
    isSetupComplete: boolean;
    hasDocuments: boolean;
    documentsChunked: number;
    documentsTotal: number;
    hasWikiSync: boolean;
    wikiPagesChunked: number;
    hasProjectContext: boolean;
    operationalData: {
        workItemsTotal: number;
        sprintsTotal: number;
        teamMembersTotal: number;
        capacitiesTotal: number;
    };
    projectContextFields: {
        projectName: boolean;
        projectScope: boolean;
        teamMembers: boolean;
        technologies: boolean;
        keyMilestones: boolean;
        businessRules: boolean;
        deliveryPlan: boolean;
    };
    totalChunks: number;
    lastUpdated?: Date;
}

interface SetupOptions {
    documentTypeMappings?: Array<{ documentId: string; documentType: MappingInput['documentType'] }>;
    includeWiki?: boolean;
    forceReprocess?: boolean;
    syncOperationalData?: boolean;
    syncMode?: 'none' | 'incremental' | 'full';
}

export class ProjectSetupService {
    constructor(
        private readonly documentIngestion: DocumentIngestionService,
        private readonly wikiIngestion: WikiIngestionService,
        private readonly contextService: ProjectContextService,
        private readonly embeddingService: EmbeddingService,
    ) {}

    async setupProject(
        projectId: string,
        options: SetupOptions = {},
        onProgress?: (progress: SetupProgress) => void,
    ): Promise<SetupResult> {
        const startedAt = Date.now();
        const includeWiki = options.includeWiki ?? true;
        const forceReprocess = options.forceReprocess ?? false;
        const syncOperationalData = options.syncOperationalData ?? true;
        const syncMode = options.syncMode ?? 'incremental';

        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
            throw new Error(`Projeto nao encontrado: ${projectId}`);
        }

        const documents = await prisma.document.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
        if (documents.length === 0) {
            throw new Error('Nenhum documento encontrado no projeto para iniciar setup.');
        }

        if (forceReprocess) {
            await this.resetProject(projectId);
        }

        let documentsProcessed = 0;
        let wikiPagesProcessed = 0;
        let wikiPagesTotal = 0;
        let contextFieldsExtracted = 0;
        let workItemsTotal = 0;
        let sprintsTotal = 0;
        let teamMembersTotal = 0;
        let capacitiesTotal = 0;
        const errors: Array<{ source: string; error: string }> = [];

        onProgress?.({
            phase: 'operational',
            currentStep: 'Sincronizando dados operacionais do projeto',
            overallProgress: 0,
            details: {
                workItemsTotal,
                sprintsTotal,
                teamMembersTotal,
                capacitiesTotal,
                documentsTotal: documents.length,
                documentsProcessed,
                wikiPagesTotal,
                wikiPagesProcessed,
                contextFields: 7,
                contextFieldsExtracted,
            },
        });

        if (syncOperationalData && syncMode !== 'none') {
            try {
                if (syncMode === 'full') {
                    await syncService.fullSync();
                } else {
                    await syncService.incrementalSync();
                }
            } catch (error) {
                errors.push({
                    source: 'operational_sync',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        const operational = await this.collectOperationalCounts(projectId);
        workItemsTotal = operational.workItemsTotal;
        sprintsTotal = operational.sprintsTotal;
        teamMembersTotal = operational.teamMembersTotal;
        capacitiesTotal = operational.capacitiesTotal;

        onProgress?.({
            phase: 'documents',
            currentStep: 'Iniciando ingestao de documentos',
            overallProgress: 10,
            details: {
                workItemsTotal,
                sprintsTotal,
                teamMembersTotal,
                capacitiesTotal,
                documentsTotal: documents.length,
                documentsProcessed,
                wikiPagesTotal,
                wikiPagesProcessed,
                contextFields: 7,
                contextFieldsExtracted,
            },
        });

        for (const [index, doc] of documents.entries()) {
            try {
                await this.documentIngestion.ingestDocument(
                    doc.id,
                    { forceReprocess },
                    (progress: IngestionProgress) => {
                        const base = 10 + 45 * (index / Math.max(1, documents.length));
                        const docProgress = (progress.progress / 100) * (45 / Math.max(1, documents.length));

                        onProgress?.({
                            phase: 'documents',
                            currentStep: `Documento ${doc.filename}: ${progress.step}`,
                            overallProgress: Math.round(base + docProgress),
                            details: {
                                workItemsTotal,
                                sprintsTotal,
                                teamMembersTotal,
                                capacitiesTotal,
                                documentsTotal: documents.length,
                                documentsProcessed,
                                wikiPagesTotal,
                                wikiPagesProcessed,
                                contextFields: 7,
                                contextFieldsExtracted,
                            },
                        });
                    },
                );
                documentsProcessed += 1;
            } catch (error) {
                errors.push({
                    source: `document:${doc.id}`,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        if (includeWiki) {
            const pages = await prisma.wikiPage.findMany({ where: { projectId } });
            wikiPagesTotal = pages.length;

            onProgress?.({
                phase: 'wiki',
                currentStep: 'Sincronizando wiki e ingerindo chunks',
                overallProgress: 58,
                details: {
                    workItemsTotal,
                    sprintsTotal,
                    teamMembersTotal,
                    capacitiesTotal,
                    documentsTotal: documents.length,
                    documentsProcessed,
                    wikiPagesTotal,
                    wikiPagesProcessed,
                    contextFields: 7,
                    contextFieldsExtracted,
                },
            });

            try {
                await wikiService.syncWikiPages(projectId);
                await this.wikiIngestion.processProjectWikiPages(
                    projectId,
                    { forceReprocess },
                    ({ current, total }) => {
                        wikiPagesProcessed = current;
                        const progress = 58 + Math.round((current / Math.max(1, total)) * 17);

                        onProgress?.({
                            phase: 'wiki',
                            currentStep: `Ingestao da wiki (${current}/${total})`,
                            overallProgress: progress,
                            details: {
                                workItemsTotal,
                                sprintsTotal,
                                teamMembersTotal,
                                capacitiesTotal,
                                documentsTotal: documents.length,
                                documentsProcessed,
                                wikiPagesTotal: total,
                                wikiPagesProcessed,
                                contextFields: 7,
                                contextFieldsExtracted,
                            },
                        });
                    },
                );
            } catch (error) {
                errors.push({
                    source: 'wiki',
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        onProgress?.({
            phase: 'context',
            currentStep: 'Construindo ProjectContext',
            overallProgress: 78,
            details: {
                workItemsTotal,
                sprintsTotal,
                teamMembersTotal,
                capacitiesTotal,
                documentsTotal: documents.length,
                documentsProcessed,
                wikiPagesTotal,
                wikiPagesProcessed,
                contextFields: 7,
                contextFieldsExtracted,
            },
        });

        const mappingByDocumentType = this.groupMappingsByType(options.documentTypeMappings);
        let projectContextBuilt = false;

        try {
            const contextData = await this.contextService.buildProjectContext(
                projectId,
                mappingByDocumentType,
                ({ current, total }) => {
                    contextFieldsExtracted = current;
                    const progress = 78 + Math.round((current / Math.max(1, total)) * 20);

                    onProgress?.({
                        phase: 'context',
                        currentStep: `Extraindo contexto (${current}/${total})`,
                        overallProgress: progress,
                        details: {
                            workItemsTotal,
                            sprintsTotal,
                            teamMembersTotal,
                            capacitiesTotal,
                            documentsTotal: documents.length,
                            documentsProcessed,
                            wikiPagesTotal,
                            wikiPagesProcessed,
                            contextFields: total,
                            contextFieldsExtracted,
                        },
                    });
                },
            );

            projectContextBuilt = Boolean(contextData.projectName || contextData.projectScope);
        } catch (error) {
            errors.push({
                source: 'project_context',
                error: error instanceof Error ? error.message : String(error),
            });
        }

        const stats = await this.embeddingService.getProjectChunkStats(projectId);
        const embeddingCost = Number(((stats.totalTokens * 0.02) / 1_000_000).toFixed(6));

        onProgress?.({
            phase: 'completed',
            currentStep: 'Setup concluido',
            overallProgress: 100,
            details: {
                workItemsTotal,
                sprintsTotal,
                teamMembersTotal,
                capacitiesTotal,
                documentsTotal: documents.length,
                documentsProcessed,
                wikiPagesTotal,
                wikiPagesProcessed,
                contextFields: 7,
                contextFieldsExtracted,
            },
        });

        const result: SetupResult = {
            projectId,
            documentsIngested: documentsProcessed,
            wikiPagesIngested: wikiPagesProcessed,
            totalChunks: stats.totalChunks,
            totalEmbeddings: stats.totalChunks,
            projectContextBuilt,
            operationalData: {
                workItemsTotal,
                sprintsTotal,
                teamMembersTotal,
                capacitiesTotal,
            },
            errors,
            duration: Date.now() - startedAt,
            stats: {
                ...stats,
                embeddingCost,
            },
        };

        console.log('[Setup] setupProject concluido', {
            projectId,
            durationMs: result.duration,
            errors: errors.length,
        });

        return result;
    }

    async getSetupStatus(projectId: string): Promise<SetupStatus> {
        const [documentsTotal, documentsChunked, wikiTotal, wikiChunked, context, stats, operational] = await Promise.all([
            prisma.document.count({ where: { projectId } }),
            prisma.document.count({ where: { projectId, chunked: true } }),
            prisma.wikiPage.count({ where: { projectId } }),
            prisma.wikiPage.count({ where: { projectId, chunked: true } }),
            this.contextService.getProjectContext(projectId),
            this.embeddingService.getProjectChunkStats(projectId),
            this.collectOperationalCounts(projectId),
        ]);

        return {
            projectId,
            isSetupComplete: documentsTotal > 0 && documentsChunked === documentsTotal && Boolean(context),
            hasDocuments: documentsTotal > 0,
            documentsChunked,
            documentsTotal,
            hasWikiSync: wikiTotal > 0,
            wikiPagesChunked: wikiChunked,
            hasProjectContext: Boolean(context),
            operationalData: operational,
            projectContextFields: {
                projectName: Boolean(context?.projectName),
                projectScope: Boolean(context?.projectScope),
                teamMembers: (context?.teamMembers?.length ?? 0) > 0,
                technologies: (context?.technologies?.length ?? 0) > 0,
                keyMilestones: (context?.keyMilestones?.length ?? 0) > 0,
                businessRules: (context?.businessRules?.length ?? 0) > 0,
                deliveryPlan: (context?.deliveryPlan?.length ?? 0) > 0,
            },
            totalChunks: stats.totalChunks,
            lastUpdated: undefined,
        };
    }

    async resetProject(projectId: string): Promise<void> {
        await prisma.$transaction([
            prisma.documentChunk.deleteMany({ where: { projectId } }),
            prisma.projectContext.deleteMany({ where: { projectId } }),
            prisma.document.updateMany({
                where: { projectId },
                data: {
                    chunked: false,
                    chunkCount: null,
                    extractionMethod: null,
                    extractionQuality: null,
                },
            }),
            prisma.wikiPage.updateMany({
                where: { projectId },
                data: {
                    chunked: false,
                    chunkCount: null,
                },
            }),
        ]);
    }

    async addDocument(
        projectId: string,
        documentId: string,
        documentType: MappingInput['documentType'],
        onProgress?: (progress: IngestionProgress) => void,
    ): Promise<IngestionResult> {
        const document = await prisma.document.findUnique({ where: { id: documentId } });
        if (!document || document.projectId !== projectId) {
            throw new Error('Documento invalido para o projeto informado.');
        }

        const result = await this.documentIngestion.ingestDocument(documentId, { forceReprocess: true }, onProgress);

        await this.contextService.buildProjectContext(projectId, [{ documentType }]);

        return result;
    }

    async refreshWiki(
        projectId: string,
        onProgress?: (progress: { current: number; total: number }) => void,
    ): Promise<WikiSyncResult> {
        await wikiService.syncWikiPages(projectId);
        return this.wikiIngestion.processProjectWikiPages(projectId, { forceReprocess: true }, onProgress);
    }

    private groupMappingsByType(mappings?: Array<{ documentId: string; documentType: MappingInput['documentType'] }>): MappingInput[] {
        if (!mappings || mappings.length === 0) {
            return [
                { documentType: 'visao' },
                { documentType: 'plano_trabalho' },
                { documentType: 'delivery_plan' },
                { documentType: 'requisitos' },
                { documentType: 'regras_negocio' },
                { documentType: 'prototipagem' },
                { documentType: 'outro' },
            ];
        }

        const uniqueTypes = Array.from(new Set(mappings.map((item) => item.documentType)));
        return uniqueTypes.map((type) => ({ documentType: type }));
    }

    private async collectOperationalCounts(projectId: string): Promise<{
        workItemsTotal: number;
        sprintsTotal: number;
        teamMembersTotal: number;
        capacitiesTotal: number;
    }> {
        const [workItemsTotal, sprintsTotal, teamMembersTotal, capacitiesTotal] = await Promise.all([
            prisma.workItem.count({ where: { projectId } }),
            prisma.sprint.count({ where: { projectId } }),
            prisma.teamMember.count({ where: { projectId } }),
            prisma.teamCapacity.count({
                where: {
                    sprint: {
                        projectId,
                    },
                },
            }),
        ]);

        return { workItemsTotal, sprintsTotal, teamMembersTotal, capacitiesTotal };
    }
}

export const projectSetupService = new ProjectSetupService(
    documentIngestionService,
    wikiIngestionService,
    projectContextService,
    embeddingService,
);
