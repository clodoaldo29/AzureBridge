import { FastifyRequest, FastifyReply } from 'fastify';
import { capacityService } from '@/services/capacity.service';
import { z } from 'zod';

export class CapacityController {
    /**
     * Get capacity vs planned comparison for a sprint
     */
    async getComparison(req: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({
            sprintId: z.string()
        });

        try {
            const { sprintId } = paramsSchema.parse(req.params);

            const data = await capacityService.getCapacityVsPlanned(sprintId);

            return reply.send({
                success: true,
                data
            });
        } catch (error) {
            console.error('Error fetching capacity comparison:', error);
            if (error instanceof z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request parameters',
                    details: error.errors
                });
            }
            return reply.status(500).send({
                success: false,
                error: (error as Error).message || 'Internal Server Error'
            });
        }
    }
}

export const capacityController = new CapacityController();
