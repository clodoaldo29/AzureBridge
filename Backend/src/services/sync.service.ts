import { workItemsService, sprintsService, teamsService } from '@/integrations/azure';
import {
    projectRepository,
    sprintRepository,
    workItemRepository,
} from '@/repositories';
import { prisma } from '@/database/client';
import { logger } from '@/utils/logger';
import type { AzureWorkItem } from '@/integrations/azure/types';
import { snapshotService } from '@/services/snapshot.service';

/**
 * Servico de Sincronizacao
 * Sincroniza dados do Azure DevOps para o banco de dados
 */
export class SyncService {
    /**
     * Sincronizacao completa - sincroniza tudo
     */
    async fullSync(projectAzureId?: string): Promise<{
        projects: number;
        sprints: number;
        workItems: number;
        teamMembers: number;
    }> {
        const startTime = Date.now();
        logger.info('Starting full sync...');

        const syncLog = await prisma.syncLog.create({
            data: {
                syncType: 'full_sync',
                status: 'running',
                projectId: projectAzureId,
                startedAt: new Date(),
            },
        });

        try {
            // 1. Sincronizar projetos
            const projects = await this.syncProjects();

            // 2. Sincronizar membros do time
            const teamMembers = await this.syncTeamMembers();

            // 3. Sincronizar sprints
            const sprints = await this.syncSprints();

            // 4. Sincronizar work items
            const workItems = await this.syncWorkItems();
            // 5. Atualizar snapshots do dia para manter CFD/Burndown alinhados com o sync
            await snapshotService.captureDailySnapshots();

            const duration = Math.floor((Date.now() - startTime) / 1000);

            await prisma.syncLog.update({
                where: { id: syncLog.id },
                data: {
                    status: 'completed',
                    completedAt: new Date(),
                    duration,
                    itemsProcessed: projects + sprints + workItems + teamMembers,
                    itemsCreated: projects + sprints + workItems + teamMembers,
                },
            });

            logger.info('Full sync completed', {
                duration,
                projects,
                sprints,
                workItems,
                teamMembers,
            });

            return { projects, sprints, workItems, teamMembers };
        } catch (error) {
            logger.error('Full sync failed', error);

            await prisma.syncLog.update({
                where: { id: syncLog.id },
                data: {
                    status: 'failed',
                    completedAt: new Date(),
                    error: error instanceof Error ? error.message : 'Unknown error',
                },
            });

            throw error;
        }
    }

    /**
     * Sincronizacao incremental - sincroniza apenas alteracoes desde o ultimo sync
     */
    async incrementalSync(since?: Date): Promise<{
        workItems: number;
        sprints: number;
    }> {
        const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000); // Ultimas 24h
        logger.info('Starting incremental sync', { since: sinceDate });

        const syncLog = await prisma.syncLog.create({
            data: {
                syncType: 'incremental_sync',
                status: 'running',
                startedAt: new Date(),
                metadata: { since: sinceDate },
            },
        });

        try {
            // Sincronizar work items alterados desde a data
            const changedWorkItems = await workItemsService.getWorkItemsChangedSince(sinceDate);
            const workItems = await this.processWorkItems(changedWorkItems);

            // Sincronizar sprints atuais
            const sprints = await this.syncSprints();
            // Atualizar snapshots do dia apos sincronizacao incremental
            await snapshotService.captureDailySnapshots();

            await prisma.syncLog.update({
                where: { id: syncLog.id },
                data: {
                    status: 'completed',
                    completedAt: new Date(),
                    itemsProcessed: workItems + sprints,
                    itemsUpdated: workItems + sprints,
                },
            });

            logger.info('Incremental sync completed', { workItems, sprints });
            return { workItems, sprints };
        } catch (error) {
            logger.error('Incremental sync failed', error);

            await prisma.syncLog.update({
                where: { id: syncLog.id },
                data: {
                    status: 'failed',
                    completedAt: new Date(),
                    error: error instanceof Error ? error.message : 'Unknown error',
                },
            });

            throw error;
        }
    }

    /**
     * Sincronizar projetos
     */
    private async syncProjects(): Promise<number> {
        try {
            const azureProjects = await teamsService.getProjects();
            let count = 0;

            for (const azureProject of azureProjects) {
                await projectRepository.upsert({
                    azureId: azureProject.id,
                    name: azureProject.name,
                    description: azureProject.description,
                    state: azureProject.state,
                    visibility: azureProject.visibility === 'public' ? 1 : 0,
                });
                count++;
            }

            logger.info(`Synced ${count} projects`);
            return count;
        } catch (error) {
            logger.error('Failed to sync projects', error);
            throw error;
        }
    }

    /**
     * Sincronizar membros do time
     */
    private async syncTeamMembers(): Promise<number> {
        try {
            const azureMembers = await teamsService.getTeamMembers();
            let count = 0;

            // Obter ou criar projeto
            const projects = await projectRepository.findAll();
            if (projects.length === 0) {
                logger.warn('No projects found, skipping team members sync');
                return 0;
            }

            const project = projects[0];

            for (const azureMember of azureMembers) {
                const azureId = azureMember.identity.id || azureMember.identity.uniqueName;
                await prisma.teamMember.upsert({
                    where: {
                        azureId_projectId: {
                            azureId,
                            projectId: project.id,
                        },
                    },
                    create: {
                        azureId,
                        displayName: azureMember.identity.displayName,
                        uniqueName: azureMember.identity.uniqueName,
                        imageUrl: azureMember.identity.imageUrl,
                        projectId: project.id,
                    },
                    update: {
                        displayName: azureMember.identity.displayName,
                        imageUrl: azureMember.identity.imageUrl,
                    },
                });
                count++;
            }

            logger.info(`Synced ${count} team members`);
            return count;
        } catch (error) {
            logger.error('Failed to sync team members', error);
            throw error;
        }
    }

    /**
     * Sincronizar sprints
     */
    private async syncSprints(): Promise<number> {
        try {
            const azureSprints = await sprintsService.getSprints();
            let count = 0;

            // Obter ou criar projeto
            const projects = await projectRepository.findAll();
            if (projects.length === 0) {
                logger.warn('No projects found, skipping sprints sync');
                return 0;
            }

            const project = projects[0];

            for (const azureSprint of azureSprints) {
                if (!azureSprint.attributes.startDate || !azureSprint.attributes.finishDate) {
                    continue;
                }

                await sprintRepository.upsert({
                    azureId: azureSprint.id,
                    name: azureSprint.name,
                    path: azureSprint.path,
                    startDate: new Date(azureSprint.attributes.startDate),
                    endDate: new Date(azureSprint.attributes.finishDate),
                    state: azureSprint.attributes.timeFrame === 'current' ? 'Active' : 'Past',
                    timeFrame: azureSprint.attributes.timeFrame || 'future',
                    project: {
                        connect: { id: project.id },
                    },
                });
                count++;
            }

            logger.info(`Synced ${count} sprints`);
            return count;
        } catch (error) {
            logger.error('Failed to sync sprints', error);
            throw error;
        }
    }

    /**
     * Sincronizar work items
     */
    private async syncWorkItems(): Promise<number> {
        try {
            // Buscar todas as sprints
            const sprints = await sprintRepository.findAll();
            let totalCount = 0;

            for (const sprint of sprints) {
                const azureWorkItems = await workItemsService.getWorkItemsForSprint(sprint.path);
                const count = await this.processWorkItems(azureWorkItems);
                totalCount += count;
            }

            logger.info(`Synced ${totalCount} work items`);
            return totalCount;
        } catch (error) {
            logger.error('Failed to sync work items', error);
            throw error;
        }
    }

    /**
     * Processar e salvar work items
     */
    private async processWorkItems(azureWorkItems: AzureWorkItem[]): Promise<number> {
        let count = 0;

        // Obter projeto
        const projects = await projectRepository.findAll();
        if (projects.length === 0) {
            logger.warn('No projects found, skipping work items processing');
            return 0;
        }

        const fallbackProject = projects[0];
        const workItemIds = azureWorkItems.map((wi) => wi.id).filter((id): id is number => typeof id === 'number');
        const existingItems = await prisma.workItem.findMany({
            where: {
                id: {
                    in: workItemIds
                }
            },
            select: {
                id: true,
                lastRemainingWork: true,
                doneRemainingWork: true,
                initialRemainingWork: true,
                originalEstimate: true,
                completedWork: true
            }
        });
        const existingById = new Map(existingItems.map((item) => [item.id, item]));

        for (const azureWI of azureWorkItems) {
            try {
                const fields = azureWI.fields;
                const acceptanceCriteria =
                    fields['Microsoft.VSTS.Common.AcceptanceCriteria']
                    ?? fields['System.AcceptanceCriteria'];
                const remainingWork = fields['Microsoft.VSTS.Scheduling.RemainingWork'] || 0;
                const completedWorkIncoming = fields['Microsoft.VSTS.Scheduling.CompletedWork'] || 0;
                const existing = existingById.get(azureWI.id!);
                const state = (fields['System.State'] || '').toString();
                const isDone = state.toLowerCase() === 'done' || state.toLowerCase() === 'closed' || state.toLowerCase() === 'completed';
                const fallbackHistoricalEffort = Math.max(
                    Number(existing?.doneRemainingWork || 0),
                    Number(existing?.lastRemainingWork || 0),
                    Number(existing?.initialRemainingWork || 0),
                    Number(existing?.originalEstimate || 0),
                    Number(fields['Microsoft.VSTS.Scheduling.OriginalEstimate'] || 0),
                    Number(completedWorkIncoming || 0)
                );

                const lastRemainingWork = remainingWork > 0
                    ? remainingWork
                    : Math.max(
                        Number(existing?.lastRemainingWork || 0),
                        isDone ? fallbackHistoricalEffort : 0
                    );

                const doneRemainingWork = isDone
                    ? (remainingWork > 0
                        ? remainingWork
                        : (completedWorkIncoming > 0 ? completedWorkIncoming : (fallbackHistoricalEffort > 0 ? fallbackHistoricalEffort : null)))
                    : existing?.doneRemainingWork ?? null;

                const completedWork = completedWorkIncoming > 0
                    ? completedWorkIncoming
                    : (isDone ? Math.max(Number(existing?.completedWork || 0), Number(doneRemainingWork || 0)) : 0);

                // Buscar sprint pelo caminho de iteracao
                const sprint = await prisma.sprint.findFirst({
                    where: { path: fields['System.IterationPath'] },
                    select: { id: true, projectId: true },
                });

                const projectForItem = sprint?.projectId
                    ? (projects.find((p) => p.id === sprint.projectId) ?? fallbackProject)
                    : fallbackProject;

                // Buscar membro do time atribuido
                let assignedTo = null;
                const assignedIdentity = fields['System.AssignedTo'];
                if (assignedIdentity?.uniqueName) {
                    const azureIdentityId = (assignedIdentity.id || assignedIdentity.uniqueName).toString();
                    assignedTo = await prisma.teamMember.upsert({
                        where: {
                            azureId_projectId: {
                                azureId: azureIdentityId,
                                projectId: projectForItem.id,
                            }
                        },
                        create: {
                            azureId: azureIdentityId,
                            displayName: assignedIdentity.displayName || assignedIdentity.uniqueName,
                            uniqueName: assignedIdentity.uniqueName,
                            imageUrl: assignedIdentity.imageUrl,
                            projectId: projectForItem.id,
                            isActive: true,
                        },
                        update: {
                            displayName: assignedIdentity.displayName || assignedIdentity.uniqueName,
                            uniqueName: assignedIdentity.uniqueName,
                            imageUrl: assignedIdentity.imageUrl,
                            isActive: true,
                        }
                    });
                }

                await workItemRepository.upsert({
                    id: azureWI.id!,
                    azureId: azureWI.id!,
                    type: fields['System.WorkItemType'],
                    state: fields['System.State'],
                    reason: fields['System.Reason'],
                    title: fields['System.Title'],
                    description: fields['System.Description'],
                    acceptanceCriteria,
                    reproSteps: fields['Microsoft.VSTS.TCM.ReproSteps'],
                    originalEstimate: fields['Microsoft.VSTS.Scheduling.OriginalEstimate'],
                    completedWork,
                    remainingWork,
                    // @ts-ignore - Campo existe no BD mas o client pode nao estar gerado ainda
                    lastRemainingWork,
                    // @ts-ignore - Campo existe no BD mas o client pode nao estar gerado ainda
                    doneRemainingWork,
                    storyPoints: fields['Microsoft.VSTS.Scheduling.StoryPoints'],
                    priority: fields['Microsoft.VSTS.Common.Priority'],
                    severity: fields['Microsoft.VSTS.Common.Severity'],
                    createdDate: new Date(fields['System.CreatedDate']),
                    changedDate: new Date(fields['System.ChangedDate']),
                    closedDate: (fields['System.ClosedDate'] || fields['Microsoft.VSTS.Common.ClosedDate'])
                        ? new Date((fields['System.ClosedDate'] || fields['Microsoft.VSTS.Common.ClosedDate']) as string)
                        : null,
                    resolvedDate: (fields['System.ResolvedDate'] || fields['Microsoft.VSTS.Common.ResolvedDate'])
                        ? new Date((fields['System.ResolvedDate'] || fields['Microsoft.VSTS.Common.ResolvedDate']) as string)
                        : null,
                    stateChangeDate: fields['System.StateChangeDate'] ? new Date(fields['System.StateChangeDate']) : null,
                    activatedDate: fields['Microsoft.VSTS.Common.ActivatedDate'] ? new Date(fields['Microsoft.VSTS.Common.ActivatedDate']) : null,
                    createdBy: fields['System.CreatedBy'].displayName,
                    changedBy: fields['System.ChangedBy'].displayName,
                    closedBy: fields['System.ClosedBy']?.displayName,
                    resolvedBy: fields['System.ResolvedBy']?.displayName,
                    tags: fields['System.Tags'] ? fields['System.Tags'].split(';').map((t: string) => t.trim()) : [],
                    areaPath: fields['System.AreaPath'],
                    iterationPath: fields['System.IterationPath'],
                    url: azureWI.url,
                    rev: azureWI.rev,
                    commentCount: azureWI.commentCount || 0,
                    project: {
                        connect: { id: projectForItem.id },
                    },
                    ...(sprint && {
                        sprint: {
                            connect: { id: sprint.id },
                        },
                    }),
                    ...(assignedTo
                        ? {
                            assignedTo: {
                                connect: { id: assignedTo.id },
                            },
                        }
                        : {}),
                    ...(fields['System.Parent'] && {
                        parent: {
                            connect: { id: fields['System.Parent'] },
                        },
                    }),
                });

                count++;
            } catch (error) {
                logger.error(`Failed to process work item ${azureWI.id}`, error);
            }
        }

        return count;
    }
}

// Exporta instancia singleton
export const syncService = new SyncService();
