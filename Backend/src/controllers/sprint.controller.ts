import { FastifyRequest, FastifyReply } from 'fastify';
import { sprintService } from '@/services/sprint.service';
import { snapshotService } from '@/services/snapshot.service';
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
        const baselineMode = String(process.env.BURNDOWN_BASELINE_MODE || 'historical').trim().toLowerCase();
        const shouldUseHistoricalBaseline = baselineMode !== 'legacy';
        const [snapshots, baseline] = await Promise.all([
            sprintService.getBurndown(id),
            shouldUseHistoricalBaseline
                ? snapshotService.getPlannedInitialBeforeD1(id)
                : Promise.resolve({ plannedInitialBeforeD1: null, d1Date: null, contributingItems: 0 })
        ]);

        const snapshotsWithLiveScope = await Promise.all(
            snapshots.map(async (snapshot) => {
                const day = new Date(snapshot.snapshotDate).toISOString().slice(0, 10);
                const totals = await snapshotService.getScopeTotalsForDay(id, day);
                return {
                    ...snapshot,
                    addedCount: totals.addedCount,
                    removedCount: totals.removedCount
                };
            })
        );

        const sortedByDate = [...snapshotsWithLiveScope].sort(
            (a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime()
        );

        const fallbackBaseline = sortedByDate.length > 0
            ? Math.max(
                0,
                Math.round(
                    Number(sortedByDate[0].totalWork || 0) -
                    Math.round(Number(sortedByDate[0].addedCount || 0) - Number(sortedByDate[0].removedCount || 0))
                )
            )
            : 0;

        const plannedInitialBeforeD1 = Math.max(
            0,
            Math.round(
                Number(
                    (baseline.plannedInitialBeforeD1 !== null && baseline.plannedInitialBeforeD1 !== undefined)
                        ? baseline.plannedInitialBeforeD1
                        : fallbackBaseline
                )
            )
        );

        const raw = sortedByDate.map((snapshot) => ({
            ...snapshot,
            totalWork: Math.max(0, Math.round(Number(snapshot.totalWork || 0))),
            remainingWork: Math.max(0, Math.round(Number(snapshot.remainingWork || 0))),
            completedWork: Math.max(0, Math.round(Number(snapshot.completedWork || 0)))
        }));

        const remainingSeries = raw.map(s => s.remainingWork);
        const dates = raw.map(s => s.snapshotDate);

        return reply.send({
            success: true,
            data: {
                labels: dates,
                series: [
                    { name: 'Remaining Work', data: remainingSeries }
                ],
                raw,
                plannedInitialBeforeD1,
                plannedInitialD1Date: baseline.d1Date,
                plannedInitialContributingItems: baseline.contributingItems
            }
        });
    }
    /**
     * Listar work items com mudanca de escopo em um dia especifico
     */
    async getSprintScopeChanges(req: FastifyRequest, reply: FastifyReply) {
        const { id } = sprintParamsSchema.parse(req.params);
        const { date } = req.query as { date?: string };

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return reply.status(400).send({ success: false, error: 'Parametro date obrigatorio no formato YYYY-MM-DD' });
        }

        const result = await snapshotService.getScopeChangesForDay(id, date);
        return reply.send({ success: true, data: result });
    }
}

export const sprintController = new SprintController();
