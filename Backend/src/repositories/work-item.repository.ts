import { prisma } from '@/database/client';
import type { WorkItem, Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';

/**
 * Work Item Repository
 * Data access layer for work items
 */
export class WorkItemRepository {
    /**
     * Create or update a work item
     */
    async upsert(data: Prisma.WorkItemCreateInput): Promise<WorkItem> {
        try {
            const workItem = await prisma.workItem.upsert({
                where: { azureId: data.azureId },
                create: data,
                update: {
                    type: data.type,
                    state: data.state,
                    reason: data.reason,
                    title: data.title,
                    description: data.description,
                    acceptanceCriteria: data.acceptanceCriteria,
                    reproSteps: data.reproSteps,
                    originalEstimate: data.originalEstimate,
                    completedWork: data.completedWork,
                    remainingWork: data.remainingWork,
                    // @ts-ignore - Field exists in DB but client might not be generated yet
                    lastRemainingWork: (data as any).lastRemainingWork,
                    // @ts-ignore - Field exists in DB but client might not be generated yet
                    doneRemainingWork: (data as any).doneRemainingWork,
                    storyPoints: data.storyPoints,
                    effort: data.effort,
                    priority: data.priority,
                    severity: data.severity,
                    changedDate: data.changedDate,
                    closedDate: data.closedDate,
                    resolvedDate: data.resolvedDate,
                    stateChangeDate: data.stateChangeDate,
                    activatedDate: data.activatedDate,
                    changedBy: data.changedBy,
                    closedBy: data.closedBy,
                    resolvedBy: data.resolvedBy,
                    isBlocked: data.isBlocked,
                    isDelayed: data.isDelayed,
                    isRemoved: data.isRemoved,
                    tags: data.tags,
                    areaPath: data.areaPath,
                    iterationPath: data.iterationPath,
                    url: data.url,
                    rev: data.rev,
                    commentCount: data.commentCount,
                    attachmentCount: data.attachmentCount,
                    relationCount: data.relationCount,
                    lastSyncAt: new Date(),
                    updatedAt: new Date(),
                },
            });

            logger.info(`Upserted work item ${workItem.azureId}`, { id: workItem.id });
            return workItem;
        } catch (error) {
            logger.error('Failed to upsert work item', { azureId: data.azureId, error });
            throw error;
        }
    }

    /**
     * Find work item by Azure ID
     */
    async findByAzureId(azureId: number): Promise<WorkItem | null> {
        return prisma.workItem.findUnique({
            where: { azureId },
        });
    }

    /**
     * Find work item by ID
     */
    async findById(id: number): Promise<WorkItem | null> {
        return prisma.workItem.findUnique({
            where: { id },
        });
    }

    /**
     * Get work items by sprint
     */
    async findBySprint(sprintId: string): Promise<WorkItem[]> {
        return prisma.workItem.findMany({
            where: { sprintId },
            orderBy: [{ type: 'asc' }, { priority: 'asc' }],
        });
    }

    /**
     * Get work items by project
     */
    async findByProject(projectId: string, limit = 100): Promise<WorkItem[]> {
        return prisma.workItem.findMany({
            where: { projectId },
            orderBy: { changedDate: 'desc' },
            take: limit,
        });
    }

    /**
     * Get work item with relations
     */
    async findByIdWithRelations(id: number) {
        return prisma.workItem.findUnique({
            where: { id },
            include: {
                project: true,
                sprint: true,
                parent: true,
                children: true,
                assignedTo: true,
                revisions: {
                    orderBy: { revisedDate: 'desc' },
                },
                comments: {
                    orderBy: { createdDate: 'desc' },
                },
            },
        });
    }

    /**
     * Get blocked work items
     */
    async findBlocked(projectId?: string): Promise<WorkItem[]> {
        return prisma.workItem.findMany({
            where: {
                isBlocked: true,
                isRemoved: false,
                ...(projectId && { projectId }),
            },
            orderBy: { changedDate: 'desc' },
        });
    }

    /**
     * Get delayed work items
     */
    async findDelayed(projectId?: string): Promise<WorkItem[]> {
        return prisma.workItem.findMany({
            where: {
                isDelayed: true,
                isRemoved: false,
                ...(projectId && { projectId }),
            },
            orderBy: { changedDate: 'desc' },
        });
    }

    /**
     * Get work items changed since date
     */
    async findChangedSince(since: Date, projectId?: string): Promise<WorkItem[]> {
        return prisma.workItem.findMany({
            where: {
                changedDate: { gte: since },
                ...(projectId && { projectId }),
            },
            orderBy: { changedDate: 'desc' },
        });
    }

    /**
     * Bulk upsert work items
     */
    async bulkUpsert(items: Prisma.WorkItemCreateInput[]): Promise<number> {
        let count = 0;

        for (const item of items) {
            try {
                await this.upsert(item);
                count++;
            } catch (error) {
                logger.error(`Failed to upsert work item ${item.azureId}`, error);
            }
        }

        logger.info(`Bulk upserted ${count}/${items.length} work items`);
        return count;
    }

    /**
     * Delete work item
     */
    async delete(id: number): Promise<void> {
        await prisma.workItem.delete({
            where: { id },
        });
        logger.info(`Deleted work item ${id}`);
    }

    /**
     * Get work items by sprint with hierarchical structure
     * Returns only parent items (PBIs, Features) with their children loaded
     */
    async findBySprintHierarchical(sprintId: string) {
        return prisma.workItem.findMany({
            where: {
                sprintId,
                parentId: null, // Only top-level items
            },
            include: {
                children: {
                    include: {
                        assignedTo: true,
                    },
                    orderBy: [{ type: 'asc' }, { priority: 'asc' }],
                },
                assignedTo: true,
                sprint: true,
                project: true,
            },
            orderBy: [{ type: 'asc' }, { priority: 'asc' }],
        });
    }

    /**
     * Get only parent work items (PBIs, Features, Epics)
     * Useful for listing without children
     */
    async findParentItems(sprintId: string) {
        return prisma.workItem.findMany({
            where: {
                sprintId,
                parentId: null,
                type: { in: ['Product Backlog Item', 'Feature', 'Epic'] },
            },
            include: {
                assignedTo: true,
            },
            orderBy: [{ type: 'asc' }, { priority: 'asc' }],
        });
    }

    /**
     * Get child work items of a parent
     */
    async findChildItems(parentId: number) {
        return prisma.workItem.findMany({
            where: { parentId },
            include: {
                assignedTo: true,
            },
            orderBy: [{ type: 'asc' }, { priority: 'asc' }],
        });
    }

    /**
     * Get work items by project with hierarchical structure
     * Returns only parent items with their children loaded
     */
    async findByProjectHierarchical(projectId: string, limit = 100) {
        return prisma.workItem.findMany({
            where: {
                projectId,
                parentId: null, // Only top-level items
            },
            include: {
                children: {
                    include: {
                        assignedTo: true,
                    },
                    orderBy: [{ type: 'asc' }, { priority: 'asc' }],
                },
                assignedTo: true,
                sprint: true,
            },
            orderBy: { changedDate: 'desc' },
            take: limit,
        });
    }
}

// Export singleton instance
export const workItemRepository = new WorkItemRepository();
