import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@/database/client';
import { z } from 'zod';

export class WorkItemController {
    /**
     * List Work Items with filters
     */
    async listWorkItems(req: FastifyRequest, reply: FastifyReply) {
        const querySchema = z.object({
            sprintId: z.string().optional(),
            projectId: z.string().optional(),
            type: z.string().optional(),
            state: z.string().optional(),
            assignedTo: z.string().optional(),
            limit: z.coerce.number().optional().default(50),
            offset: z.coerce.number().optional().default(0)
        });

        try {
            const filters = querySchema.parse(req.query);
            const where: any = { isRemoved: false };

            if (filters.sprintId) where.sprintId = filters.sprintId;
            if (filters.projectId) where.projectId = filters.projectId;
            if (filters.type) where.type = filters.type;
            if (filters.state) where.state = filters.state;
            if (filters.assignedTo) where.assignedToId = filters.assignedTo;

            // Pending/Blocked filters could be added here

            const [total, items] = await Promise.all([
                prisma.workItem.count({ where }),
                prisma.workItem.findMany({
                    where,
                    take: filters.limit,
                    skip: filters.offset,
                    orderBy: { changedDate: 'desc' },
                    include: {
                        assignedTo: { select: { displayName: true, imageUrl: true } }
                    }
                })
            ]);

            return reply.send({
                success: true,
                data: items,
                meta: {
                    total,
                    limit: filters.limit,
                    offset: filters.offset
                }
            });
        } catch (error) {
            return reply.status(500).send({ success: false, error: 'Failed to list work items' });
        }
    }

    /**
     * Get Work Item details
     */
    async getWorkItem(req: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({ id: z.coerce.number() });

        try {
            const { id } = paramsSchema.parse(req.params);

            const item = await prisma.workItem.findUnique({
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

            if (!item) return reply.status(404).send({ success: false, error: 'Work Item not found' });

            return reply.send({ success: true, data: item });
        } catch (error) {
            return reply.status(500).send({ success: false, error: 'Internal Error' });
        }
    }

    /**
     * Get Work Item Hierarchy (Tree)
     * Useful for Feature -> PBI -> Task views
     */
    async getWorkItemWithChildren(req: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({ id: z.coerce.number() });

        try {
            const { id } = paramsSchema.parse(req.params);

            // Fetch recursive children (up to a few levels if needed, but Prisma lacks deep recursive include easily)
            // For now, 2 levels deep: Item -> Children -> Grandchildren
            const item = await prisma.workItem.findUnique({
                where: { id },
                include: {
                    children: {
                        include: {
                            children: true // Grandchildren
                        }
                    }
                }
            });

            if (!item) return reply.status(404).send({ success: false, error: 'Work Item not found' });

            return reply.send({ success: true, data: item });

        } catch (error) {
            return reply.status(500).send({ success: false, error: 'Failed to fetch hierarchy' });
        }
    }

    /**
     * Get Blocked Items
     */
    async getBlockedWorkItems(_req: FastifyRequest, reply: FastifyReply) {
        try {
            const items = await prisma.workItem.findMany({
                where: {
                    isRemoved: false,
                    // Assuming 'isBlocked' boolean or tag exists. 
                    // Using basic state checks for now or metadata if available
                    isBlocked: true
                },
                include: { assignedTo: true }
            });

            return reply.send({ success: true, data: items });
        } catch (error) {
            return reply.status(500).send({ success: false, error: 'Failed' });
        }
    }
}

export const workItemController = new WorkItemController();
