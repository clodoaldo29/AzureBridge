import { prisma } from '@/database/client';

export class SprintService {
    async findAll(filter: { projectId?: string, state?: string, limit?: number }) {
        const where: any = {};
        if (filter.projectId) where.projectId = filter.projectId;
        if (filter.state) where.state = filter.state;

        return prisma.sprint.findMany({
            where,
            orderBy: { startDate: 'desc' },
            take: filter.limit || 20,
            include: {
                snapshots: {
                    orderBy: { snapshotDate: 'desc' },
                    take: 1
                }
            }
        });
    }

    async findById(id: string) {
        return prisma.sprint.findUnique({
            where: { id },
            include: {
                capacities: true,
                project: true
            }
        });
    }

    async getBurndown(sprintId: string) {
        return prisma.sprintSnapshot.findMany({
            where: { sprintId },
            orderBy: { snapshotDate: 'asc' }
        });
    }
}

export const sprintService = new SprintService();
