import { prisma } from '@/database/client';

export class WorkItemService {
    async findAll(filter: {
        sprintId?: string,
        projectId?: string,
        type?: string,
        state?: string,
        assignedTo?: string,
        limit?: number,
        offset?: number
    }) {
        const where: any = { isRemoved: false };

        if (filter.sprintId) where.sprintId = filter.sprintId;
        if (filter.projectId) where.projectId = filter.projectId;
        if (filter.type) where.type = filter.type;
        if (filter.state) where.state = filter.state;
        if (filter.assignedTo) where.assignedToId = filter.assignedTo;

        const [total, items] = await Promise.all([
            prisma.workItem.count({ where }),
            prisma.workItem.findMany({
                where,
                take: filter.limit || 50,
                skip: filter.offset || 0,
                orderBy: { changedDate: 'desc' },
                include: {
                    assignedTo: { select: { displayName: true, imageUrl: true } }
                }
            })
        ]);

        return { total, items };
    }

    async findById(id: number) {
        return prisma.workItem.findUnique({
            where: { id },
            include: {
                assignedTo: true,
                project: true,
                sprint: true,
                parent: true,
                children: {
                    select: { id: true, title: true, state: true, type: true }
                }
            }
        });
    }

    async getHierarchy(id: number) {
        return prisma.workItem.findUnique({
            where: { id },
            include: {
                children: {
                    include: {
                        children: true // Level 2
                    }
                }
            }
        });
    }

    async getBlockedItems() {
        return prisma.workItem.findMany({
            where: {
                isRemoved: false,
                isBlocked: true
            },
            include: { assignedTo: true, project: true }
        });
    }

    async getDelayedItems() {
        // Example logic: Items in progress but sprint ended or passed due date
        // For MVP, just returning blocked or explicitly flagged items
        return this.getBlockedItems();
    }
}

export const workItemService = new WorkItemService();
