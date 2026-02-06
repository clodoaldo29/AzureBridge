import { FastifyInstance } from 'fastify';
import { capacityController } from '@/controllers/capacity.controller';

export async function apiRoutes(fastify: FastifyInstance) {
    // Capacity Routes
    fastify.get('/sprints/:sprintId/capacity/comparison', capacityController.getComparison);

    // Health Check
    fastify.get('/health', async () => {
        return { status: 'ok', timestamp: new Date() };
    });
}
