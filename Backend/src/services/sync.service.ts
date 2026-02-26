import { workItemsService, sprintsService, teamsService } from '@/integrations/azure';
import {
    projectRepository,
    sprintRepository,
    workItemRepository,
} from '@/repositories';
import { prisma } from '@/database/client';
import { logger } from '@/utils/logger';
import type { AzureWorkItem, AzureWorkItemRevision } from '@/integrations/azure/types';
import { snapshotService } from '@/services/snapshot.service';

/**
 * Servico de Sincronizacao
 * Sincroniza dados do Azure DevOps para o banco de dados
 */
export class SyncService {
    private readonly revisionPersistenceEnabled = this.parseBooleanEnv(process.env.ENABLE_REVISION_PERSISTENCE, false);
    private readonly revisionSyncMaxItemsPerRun = this.parsePositiveIntEnv(process.env.REVISION_SYNC_MAX_ITEMS_PER_RUN, 100);

    private parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
        if (value == null) return fallback;
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'sim', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'nao', 'off'].includes(normalized)) return false;
        return fallback;
    }

    private parsePositiveIntEnv(value: string | undefined, fallback: number): number {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
        return Math.floor(parsed);
    }

    private normalizeToStartOfUtcDay(date: Date): Date {
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
    }

    private normalizeToEndOfUtcDay(date: Date): Date {
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
    }

    private mapSprintStateFromTimeFrame(timeFrameRaw?: string | null): 'Active' | 'Past' | 'Future' | null {
        const timeFrame = String(timeFrameRaw || '').trim().toLowerCase();
        if (timeFrame === 'current') return 'Active';
        if (timeFrame === 'past') return 'Past';
        if (timeFrame === 'future') return 'Future';
        return null;
    }

    private mapSprintStateByDateWindow(startDate: Date, endDate: Date, now: Date = new Date()): 'Active' | 'Past' | 'Future' {
        const windowStart = this.normalizeToStartOfUtcDay(startDate);
        const windowEnd = this.normalizeToEndOfUtcDay(endDate);

        if (now >= windowStart && now <= windowEnd) return 'Active';
        if (now < windowStart) return 'Future';
        return 'Past';
    }

    private resolveSprintState(timeFrameRaw: string | null | undefined, startDate: Date, endDate: Date): 'Active' | 'Past' | 'Future' {
        const byTimeFrame = this.mapSprintStateFromTimeFrame(timeFrameRaw);
        const byDateWindow = this.mapSprintStateByDateWindow(startDate, endDate);

        // Regra de seguranca: se a sprint ainda esta dentro da janela de datas, manter como Active.
        if (byDateWindow === 'Active') return 'Active';
        return byTimeFrame ?? byDateWindow;
    }

    private resolveProjectForSprintPath(pathRaw: string | undefined, projects: Array<{ id: string; name: string }>) {
        const normalizedPath = String(pathRaw || '').trim().toLowerCase();
        const matchedProject = projects.find((project) => {
            const normalizedName = project.name.trim().toLowerCase();
            return normalizedPath === normalizedName || normalizedPath.startsWith(`${normalizedName}\\`);
        });

        if (matchedProject) return matchedProject;
        return projects[0];
    }

    private isBlockedState(state?: string | null): boolean {
        const s = String(state || '').trim().toLowerCase();
        return s === 'blocked' || s === 'impeded' || s === 'impedido';
    }

    private hasBlockedTag(tagsRaw: unknown): boolean {
        const tags = String(tagsRaw || '').toLowerCase();
        return tags.includes('blocked') || tags.includes('blocker') || tags.includes('imped');
    }

    private isBlockedBoardColumn(boardColumnRaw: unknown): boolean {
        const col = String(boardColumnRaw || '').trim().toLowerCase();
        return col === 'blocked' || col.includes('imped');
    }

    private parseBlockedField(value: unknown): boolean {
        if (typeof value === 'boolean') return value;
        const s = String(value || '').trim().toLowerCase();
        return s === 'true' || s === 'yes' || s === 'sim' || s === '1';
    }

    private extractRevisionChanges(value: unknown): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        return value as Record<string, unknown>;
    }

    private extractChangedFieldsFromRevisionChanges(changes: Record<string, unknown>): string[] {
        return Object.keys(changes).filter((key) => typeof key === 'string' && key.length > 0);
    }

    private async persistWorkItemRevisions(workItemId: number, revisions: AzureWorkItemRevision[]): Promise<number> {
        if (!Array.isArray(revisions) || revisions.length === 0) return 0;

        let persisted = 0;
        for (const revision of revisions) {
            if (typeof revision?.rev !== 'number') continue;

            const fields = this.extractRevisionChanges(revision.fields);
            const changedFields = this.extractChangedFieldsFromRevisionChanges(fields);
            const revisedDateRaw = (fields['System.ChangedDate'] || fields['System.RevisedDate']) as string | undefined;
            const revisedDate = revisedDateRaw ? new Date(revisedDateRaw) : new Date();
            const revisedByRaw = fields['System.ChangedBy'] as { displayName?: string; uniqueName?: string } | undefined;
            const revisedBy = revisedByRaw?.displayName || revisedByRaw?.uniqueName || revision.revisedBy?.displayName || 'Unknown';

            await prisma.workItemRevision.upsert({
                where: {
                    workItemId_rev: {
                        workItemId,
                        rev: revision.rev,
                    },
                },
                create: {
                    workItemId,
                    rev: revision.rev,
                    revisedDate,
                    revisedBy,
                    changes: fields as any,
                    changedFields,
                },
                update: {
                    revisedDate,
                    revisedBy,
                    changes: fields as any,
                    changedFields,
                },
            });
            persisted++;
        }

        return persisted;
    }
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

            for (const azureSprint of azureSprints) {
                if (!azureSprint.attributes.startDate || !azureSprint.attributes.finishDate) {
                    continue;
                }

                const startDate = new Date(azureSprint.attributes.startDate);
                const endDate = new Date(azureSprint.attributes.finishDate);
                const normalizedTimeFrame = String(azureSprint.attributes.timeFrame || '').trim().toLowerCase() || 'future';
                const sprintState = this.resolveSprintState(azureSprint.attributes.timeFrame, startDate, endDate);
                const project = this.resolveProjectForSprintPath(azureSprint.path, projects);

                await sprintRepository.upsert({
                    azureId: azureSprint.id,
                    name: azureSprint.name,
                    path: azureSprint.path,
                    startDate,
                    endDate,
                    state: sprintState,
                    timeFrame: normalizedTimeFrame,
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
        let revisionPersistedCount = 0;
        let revisionWorkItemBudget = this.revisionSyncMaxItemsPerRun;

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
                completedWork: true,
                closedDate: true,
                resolvedDate: true,
                stateChangeDate: true,
                activatedDate: true
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
                const hasField = (key: string) => Object.prototype.hasOwnProperty.call(fields, key);
                const closedRaw = fields['System.ClosedDate'] || fields['Microsoft.VSTS.Common.ClosedDate'];
                const resolvedRaw = fields['System.ResolvedDate'] || fields['Microsoft.VSTS.Common.ResolvedDate'];
                const stateChangeRaw = fields['System.StateChangeDate'];
                const activatedRaw = fields['Microsoft.VSTS.Common.ActivatedDate'];
                const hasClosedField = hasField('System.ClosedDate') || hasField('Microsoft.VSTS.Common.ClosedDate');
                const hasResolvedField = hasField('System.ResolvedDate') || hasField('Microsoft.VSTS.Common.ResolvedDate');
                const hasStateChangeField = hasField('System.StateChangeDate');
                const hasActivatedField = hasField('Microsoft.VSTS.Common.ActivatedDate');
                const closedDate = hasClosedField
                    ? (closedRaw ? new Date(closedRaw as string) : null)
                    : (existing?.closedDate ?? null);
                const resolvedDate = hasResolvedField
                    ? (resolvedRaw ? new Date(resolvedRaw as string) : null)
                    : (existing?.resolvedDate ?? null);
                const stateChangeDate = hasStateChangeField
                    ? (stateChangeRaw ? new Date(stateChangeRaw as string) : null)
                    : (existing?.stateChangeDate ?? null);
                const activatedDate = hasActivatedField
                    ? (activatedRaw ? new Date(activatedRaw as string) : null)
                    : (existing?.activatedDate ?? null);
                const state = (fields['System.State'] || '').toString();
                const isDone = state.toLowerCase() === 'done' || state.toLowerCase() === 'closed' || state.toLowerCase() === 'completed';
                const isBlocked = this.isBlockedState(state)
                    || this.isBlockedBoardColumn(fields['System.BoardColumn'])
                    || this.parseBlockedField(fields['Microsoft.VSTS.Common.Blocked'])
                    || this.hasBlockedTag(fields['System.Tags']);
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
                if (assignedIdentity) {
                    if (typeof assignedIdentity === 'object') {
                        const uniqueName = assignedIdentity.uniqueName
                            ? String(assignedIdentity.uniqueName)
                            : null;
                        const displayName = assignedIdentity.displayName
                            ? String(assignedIdentity.displayName)
                            : (uniqueName || 'Unknown');
                        const azureIdentityId = assignedIdentity.id
                            ? String(assignedIdentity.id)
                            : (uniqueName ? String(uniqueName) : null);

                        if (azureIdentityId) {
                            assignedTo = await prisma.teamMember.upsert({
                                where: {
                                    azureId_projectId: {
                                        azureId: azureIdentityId,
                                        projectId: projectForItem.id,
                                    }
                                },
                                create: {
                                    azureId: azureIdentityId,
                                    displayName,
                                    uniqueName: uniqueName || displayName,
                                    imageUrl: assignedIdentity.imageUrl || null,
                                    projectId: projectForItem.id,
                                    isActive: true,
                                },
                                update: {
                                    displayName,
                                    uniqueName: uniqueName || displayName,
                                    imageUrl: assignedIdentity.imageUrl || null,
                                    isActive: true,
                                }
                            });
                        } else if (uniqueName || displayName) {
                            assignedTo = await prisma.teamMember.findFirst({
                                where: {
                                    projectId: projectForItem.id,
                                    OR: [
                                        ...(uniqueName ? [{ uniqueName }] : []),
                                        ...(displayName ? [{ displayName }] : []),
                                    ]
                                }
                            });
                        }
                    } else {
                        const assignedText = String(assignedIdentity).trim();
                        if (assignedText) {
                            assignedTo = await prisma.teamMember.findFirst({
                                where: {
                                    projectId: projectForItem.id,
                                    OR: [
                                        { uniqueName: assignedText },
                                        { displayName: assignedText }
                                    ]
                                }
                            });
                        }
                    }
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
                    closedDate,
                    resolvedDate,
                    stateChangeDate,
                    activatedDate,
                    createdBy: fields['System.CreatedBy'].displayName,
                    changedBy: fields['System.ChangedBy'].displayName,
                    closedBy: fields['System.ClosedBy']?.displayName,
                    resolvedBy: fields['System.ResolvedBy']?.displayName,
                    tags: fields['System.Tags'] ? fields['System.Tags'].split(';').map((t: string) => t.trim()) : [],
                    isBlocked,
                    isRemoved: false,
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

                if (this.revisionPersistenceEnabled && revisionWorkItemBudget > 0 && typeof azureWI.id === 'number') {
                    try {
                        const revisions = await workItemsService.getWorkItemRevisions(azureWI.id);
                        revisionPersistedCount += await this.persistWorkItemRevisions(azureWI.id, revisions);
                        revisionWorkItemBudget--;
                    } catch (error) {
                        logger.warn(`Failed to persist revisions for work item ${azureWI.id}`, {
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }

                count++;
            } catch (error) {
                logger.error(`Failed to process work item ${azureWI.id}`, error);
            }
        }

        if (this.revisionPersistenceEnabled) {
            logger.info('Revision persistence summary', {
                workItemsProcessed: count,
                revisionsPersisted: revisionPersistedCount,
                revisionWorkItemBudgetUsed: this.revisionSyncMaxItemsPerRun - revisionWorkItemBudget,
                revisionWorkItemBudgetLimit: this.revisionSyncMaxItemsPerRun,
            });
        }

        return count;
    }
}

// Exporta instancia singleton
export const syncService = new SyncService();
