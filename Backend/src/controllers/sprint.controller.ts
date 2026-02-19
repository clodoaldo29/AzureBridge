import { FastifyRequest, FastifyReply } from 'fastify';
import { sprintService } from '@/services/sprint.service';
import { sprintQuerySchema, sprintParamsSchema } from '@/schemas/sprint.schema';
import { logger } from '@/utils/logger';
import { isMissingDatabaseTableError } from '@/utils/prisma-errors';

export class SprintController {
    /**
     * Listar sprints
     */
    async listSprints(req: FastifyRequest, reply: FastifyReply) {
        // Validacao agora gerenciada pelo Zod; erros capturados pelo handler global
        const query = sprintQuerySchema.parse(req.query);
        try {
            const sprints = await sprintService.findAll(query);
            return reply.send({ success: true, data: sprints });
        } catch (error) {
            if (isMissingDatabaseTableError(error)) {
                logger.warn('Sprints table missing, returning empty list.');
                return reply.send({ success: true, data: [] });
            }

            throw error;
        }
    }

    /**
     * Obter Detalhes da Sprint com Metricas
     */
    async getSprint(req: FastifyRequest, reply: FastifyReply) {
        const { id } = sprintParamsSchema.parse(req.params);
        const sprint = await sprintService.findById(id);

        if (!sprint) {
            return reply.status(404).send({ success: false, error: 'Sprint not found' });
        }

        return reply.send({ success: true, data: sprint });
    }

    /**
     * Obter Dados de Burndown (Snapshots)
     */
    async getSprintBurndown(req: FastifyRequest, reply: FastifyReply) {
        const { id } = sprintParamsSchema.parse(req.params);
        const snapshots = await sprintService.getBurndown(id);

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
    }
}

export const sprintController = new SprintController();
