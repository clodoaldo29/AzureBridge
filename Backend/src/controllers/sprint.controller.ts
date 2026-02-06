import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@/database/client';
import { z } from 'zod';

export class SprintController {
    /**
     * List sprints
     */
    async listSprints(req: FastifyRequest, reply: FastifyReply) {
        const querySchema = z.object({
            projectId: z.string().optional(),
            state: z.string().optional(), // active, past, future
            limit: z.coerce.number().optional().default(20)
        });

        try {
            const { projectId, state, limit } = querySchema.parse(req.query);

            const where: any = {};
            if (projectId) where.projectId = projectId;
            if (state) where.state = state; // or timeFrame depending on usage

            const sprints = await prisma.sprint.findMany({
                where,
                orderBy: { startDate: 'desc' },
                take: limit,
                include: {
                    snapshots: {
                        orderBy: { snapshotDate: 'desc' },
                        take: 1
                    }
                }
            });

            return reply.send({
                success: true,
                data: sprints
            });
        } catch (error) {
            return reply.status(500).send({ success: false, error: 'Failed to list sprints' });
        }
    }

    /**
     * Get Sprint Details with Metrics
     */
    async getSprint(req: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({ id: z.string() });

        try {
            const { id } = paramsSchema.parse(req.params);

            const sprint = await prisma.sprint.findUnique({
                where: { id },
                include: {
                    capacities: true,
                    project: true
                }
            });

            if (!sprint) return reply.status(404).send({ success: false, error: 'Sprint not found' });

            return reply.send({ success: true, data: sprint });
        } catch (error) {
            return reply.status(500).send({ success: false, error: 'Internal Error' });
        }
    }

    /**
     * Get Burndown Data (Snapshots)
     */
    async getSprintBurndown(req: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({ id: z.string() });

        try {
            const { id } = paramsSchema.parse(req.params);

            const snapshots = await prisma.sprintSnapshot.findMany({
                where: { sprintId: id },
                orderBy: { snapshotDate: 'asc' }
            });

            // Format for frontend (dates, ideal line, actual remaining)
            const remainingSeries = snapshots.map(s => s.remainingWork);
            const dates = snapshots.map(s => s.snapshotDate);

            return reply.send({
                success: true,
                data: {
                    labels: dates,
                    series: [
                        { name: 'Remaining Work', data: remainingSeries }
                    ],
                    raw: snapshots
                }
            });
        } catch (error) {
            return reply.status(500).send({ success: false, error: 'Failed to fetch burndown' });
        }
    }
}

export const sprintController = new SprintController();
