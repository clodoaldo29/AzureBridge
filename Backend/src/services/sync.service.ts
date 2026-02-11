import { workItemsService, sprintsService, teamsService } from '@/integrations/azure';
import {
    projectRepository,
    sprintRepository,
    workItemRepository,
} from '@/repositories';
import { prisma } from '@/database/client';
import { logger } from '@/utils/logger';
import type { AzureWorkItem } from '@/integrations/azure/types';

/**
 * Sync Service
 * Synchronizes data from Azure DevOps to database
 */
export class SyncService {
    /**
     * Full sync - syncs everything
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
            // 1. Sync projects
            const projects = await this.syncProjects();

            // 2. Sync team members
            const teamMembers = await this.syncTeamMembers();

            // 3. Sync sprints
            const sprints = await this.syncSprints();

            // 4. Sync work items
            const workItems = await this.syncWorkItems();

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
     * Incremental sync - only syncs changes since last sync
     */
    async incrementalSync(since?: Date): Promise<{
        workItems: number;
        sprints: number;
    }> {
        const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24h
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
            // Sync work items changed since date
            const changedWorkItems = await workItemsService.getWorkItemsChangedSince(sinceDate);
            const workItems = await this.processWorkItems(changedWorkItems);

            // Sync current sprints
            const sprints = await this.syncSprints();

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
     * Sync projects
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
     * Sync team members
     */
    private async syncTeamMembers(): Promise<number> {
        try {
            const azureMembers = await teamsService.getTeamMembers();
            let count = 0;

            // Get or create project
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
     * Sync sprints
     */
    private async syncSprints(): Promise<number> {
        try {
            const azureSprints = await sprintsService.getSprints();
            let count = 0;

            // Get or create project
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
     * Sync work items
     */
    private async syncWorkItems(): Promise<number> {
        try {
            // Get all sprints
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
     * Process and save work items
     */
    private async processWorkItems(azureWorkItems: AzureWorkItem[]): Promise<number> {
        let count = 0;

        // Get project
        const projects = await projectRepository.findAll();
        if (projects.length === 0) {
            logger.warn('No projects found, skipping work items processing');
            return 0;
        }

        const project = projects[0];

        for (const azureWI of azureWorkItems) {
            try {
                const fields = azureWI.fields;
                const remainingWork = fields['Microsoft.VSTS.Scheduling.RemainingWork'] || 0;
                const completedWork = fields['Microsoft.VSTS.Scheduling.CompletedWork'] || 0;
                const state = (fields['System.State'] || '').toString();
                const isDone = state.toLowerCase() === 'done' || state.toLowerCase() === 'closed' || state.toLowerCase() === 'completed';
                const doneRemainingWork = isDone
                    ? (remainingWork > 0 ? remainingWork : completedWork)
                    : null;

                // Find sprint by iteration path
                const sprint = await prisma.sprint.findFirst({
                    where: { path: fields['System.IterationPath'] },
                });

                // Find assigned team member
                let assignedTo = null;
                if (fields['System.AssignedTo']) {
                    assignedTo = await prisma.teamMember.findFirst({
                        where: { uniqueName: fields['System.AssignedTo'].uniqueName },
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
                    acceptanceCriteria: fields['System.AcceptanceCriteria'],
                    reproSteps: fields['Microsoft.VSTS.TCM.ReproSteps'],
                    originalEstimate: fields['Microsoft.VSTS.Scheduling.OriginalEstimate'],
                    completedWork,
                    remainingWork,
                    // @ts-ignore - Field exists in DB but client might not be generated yet
                    lastRemainingWork: remainingWork,
                    // @ts-ignore - Field exists in DB but client might not be generated yet
                    doneRemainingWork,
                    storyPoints: fields['Microsoft.VSTS.Scheduling.StoryPoints'],
                    priority: fields['Microsoft.VSTS.Common.Priority'],
                    severity: fields['Microsoft.VSTS.Common.Severity'],
                    createdDate: new Date(fields['System.CreatedDate']),
                    changedDate: new Date(fields['System.ChangedDate']),
                    closedDate: fields['System.ClosedDate'] ? new Date(fields['System.ClosedDate']) : null,
                    resolvedDate: fields['System.ResolvedDate'] ? new Date(fields['System.ResolvedDate']) : null,
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
                        connect: { id: project.id },
                    },
                    ...(sprint && {
                        sprint: {
                            connect: { id: sprint.id },
                        },
                    }),
                    ...(assignedTo && {
                        assignedTo: {
                            connect: { id: assignedTo.id },
                        },
                    }),
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

// Export singleton instance
export const syncService = new SyncService();
