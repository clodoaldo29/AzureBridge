import { FastifyRequest, FastifyReply } from 'fastify';
import { sprintService } from '@/services/sprint.service';
import { snapshotService } from '@/services/snapshot.service';
import { prisma } from '@/database/client';
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
        let lateCompletionHours = 0;
        let lateCompletionItems = 0;
        let lateScopeAddedHours = 0;
        let lateScopeRemovedHours = 0;
        try {
            const lateSummary = await prisma.sprintItemOutcome.aggregate({
                where: { sprintId: id },
                _sum: {
                    completedAfterSprintHours: true,
                    scopeAddedAfterSprintHours: true,
                    scopeRemovedAfterSprintHours: true
                }
            });
            lateCompletionItems = await prisma.sprintItemOutcome.count({
                where: {
                    sprintId: id,
                    completedAfterSprintHours: { gt: 0 }
                }
            });
            lateCompletionHours = Math.max(0, Math.round(Number(lateSummary._sum.completedAfterSprintHours || 0)));
            lateScopeAddedHours = Math.max(0, Math.round(Number(lateSummary._sum.scopeAddedAfterSprintHours || 0)));
            lateScopeRemovedHours = Math.max(0, Math.round(Number(lateSummary._sum.scopeRemovedAfterSprintHours || 0)));
        } catch (error) {
            if (!isMissingDatabaseTableError(error)) {
                throw error;
            }
        }
        const sortedByDate = [...snapshots].sort(
            (a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime()
        );

        const firstSnapshot = sortedByDate[0];
        const firstDayNetScope = Math.round(
            Number(firstSnapshot?.addedCount || 0) - Number(firstSnapshot?.removedCount || 0)
        );
        const plannedInitialBeforeD1 = sortedByDate.length > 0
            ? Math.max(0, Math.round(Number(firstSnapshot?.totalWork || 0) - firstDayNetScope))
            : 0;
        const plannedInitialD1Date = firstSnapshot
            ? new Date(firstSnapshot.snapshotDate).toISOString().slice(0, 10)
            : null;

        const raw = sortedByDate.map((snapshot) => ({
            ...snapshot,
            totalWork: Math.max(0, Math.round(Number(snapshot.totalWork || 0))),
            remainingWork: Math.max(0, Math.round(Number(snapshot.remainingWork || 0))),
            completedWork: Math.max(0, Math.round(Number(snapshot.completedWork || 0))),
            completedInDay: Math.max(0, Number((snapshot as any).completedInDay || 0))
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
                plannedInitialD1Date,
                plannedInitialContributingItems: null,
                lateCompletionHours,
                lateCompletionItems,
                lateScopeAddedHours,
                lateScopeRemovedHours
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
