import { prisma } from '@/database/client';
import type { Sprint, Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';

/**
 * Sprint Repository
 * Data access layer for sprints
 */
export class SprintRepository {
    /**
     * Create or update a sprint
     */
    async upsert(data: Prisma.SprintCreateInput): Promise<Sprint> {
        try {
            const sprint = await prisma.sprint.upsert({
                where: { azureId: data.azureId },
                create: data,
                update: {
                    name: data.name,
                    path: data.path,
                    startDate: data.startDate,
                    endDate: data.endDate,
                    state: data.state,
                    timeFrame: data.timeFrame,
                    updatedAt: new Date(),
                },
            });

            logger.info(`Upserted sprint ${sprint.name}`, { id: sprint.id });
            return sprint;
        } catch (error) {
            logger.error('Failed to upsert sprint', { data, error });
            throw error;
        }
    }

    /**
     * Find sprint by Azure ID
     */
    async findByAzureId(azureId: string): Promise<Sprint | null> {
        return prisma.sprint.findUnique({
            where: { azureId },
        });
    }

    /**
     * Find sprint by ID
     */
    async findById(id: string): Promise<Sprint | null> {
        return prisma.sprint.findUnique({
            where: { id },
        });
    }

    /**
     * Get sprints by project
     */
    async findByProject(projectId: string): Promise<Sprint[]> {
        return prisma.sprint.findMany({
            where: { projectId },
            orderBy: { startDate: 'desc' },
        });
    }

    /**
     * Get all sprints
     */
    async findAll(): Promise<Sprint[]> {
        return prisma.sprint.findMany({
            orderBy: { startDate: 'desc' },
        });
    }

    /**
     * Get current active sprints
     */
    async findActive(projectId?: string): Promise<Sprint[]> {
        return prisma.sprint.findMany({
            where: {
                state: 'Active',
                ...(projectId && { projectId }),
            },
            orderBy: { startDate: 'desc' },
        });
    }

    /**
     * Get sprint with relations
     */
    async findByIdWithRelations(id: string) {
        return prisma.sprint.findUnique({
            where: { id },
            include: {
                project: true,
                workItems: {
                    orderBy: { changedDate: 'desc' },
                },
                capacities: {
                    include: {
                        member: true,
                    },
                },
                snapshots: {
                    orderBy: { snapshotDate: 'asc' },
                },
                alerts: {
                    where: { status: 'active' },
                },
            },
        });
    }

    /**
     * Get sprints by timeframe
     */
    async findByTimeFrame(
        timeFrame: string,
        projectId?: string
    ): Promise<Sprint[]> {
        return prisma.sprint.findMany({
            where: {
                timeFrame,
                ...(projectId && { projectId }),
            },
            orderBy: { startDate: 'desc' },
        });
    }

    /**
     * Update sprint metrics
     */
    async updateMetrics(
        id: string,
        metrics: {
            totalPlannedHours?: number;
            totalCompletedHours?: number;
            totalRemainingHours?: number;
            totalStoryPoints?: number;
            completedStoryPoints?: number;
            teamCapacityHours?: number;
            commitmentHours?: number;
            isOnTrack?: boolean;
            riskLevel?: string;
        }
    ): Promise<Sprint> {
        return prisma.sprint.update({
            where: { id },
            data: {
                ...metrics,
                lastCalculatedAt: new Date(),
            },
        });
    }

    /**
     * Delete sprint
     */
    async delete(id: string): Promise<void> {
        await prisma.sprint.delete({
            where: { id },
        });
        logger.info(`Deleted sprint ${id}`);
    }

    /**
     * Get sprint with hierarchical work items
     */
    async findByIdWithHierarchy(id: string) {
        return prisma.sprint.findUnique({
            where: { id },
            include: {
                project: true,
                workItems: {
                    where: { parentId: null },
                    include: {
                        children: {
                            include: { assignedTo: true },
                            orderBy: [{ type: 'asc' }, { priority: 'asc' }],
                        },
                        assignedTo: true,
                    },
                    orderBy: [{ type: 'asc' }, { priority: 'asc' }],
                },
            },
        });
    }
}

// Export singleton instance
export const sprintRepository = new SprintRepository();
