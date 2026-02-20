import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@/database/client';

export class DashboardController {
    /**
     * Obter Estatisticas Gerais do Dashboard
     */
    async getOverview(_req: FastifyRequest, reply: FastifyReply) {
        try {
            // 1. Obter contagens de nivel superior
            const [activeProjects, activeSprints, totalWorkItems, warnings] = await Promise.all([
                prisma.project.count({ where: { state: { not: 'deleting' } } }),
                prisma.sprint.count({ where: { state: 'active' } }),
                prisma.workItem.count({ where: { isRemoved: false, state: { not: 'Removed' } } }),
                // Exemplo de "Avisos" - Itens bloqueados
                prisma.workItem.count({ where: { isRemoved: false, isBlocked: true } })
            ]);

            // 2. Obter velocidade recente global (media das velocidades de todos os projetos)
            const recentMetrics = await prisma.metricSnapshot.findMany({
                where: { metricType: 'velocity' },
                orderBy: { snapshotDate: 'desc' },
                take: 5
            });

            // 3. Buscar Sprints ativas com info basica de saude
            const currentSprints = await prisma.sprint.findMany({
                where: { state: 'active' },
                take: 5,
                include: {
                    project: { select: { name: true } }
                }
            });

            return reply.send({
                success: true,
                data: {
                    counts: {
                        projects: activeProjects,
                        activeSprints: activeSprints,
                        workItems: totalWorkItems,
                        warnings: warnings
                    },
                    metrics: recentMetrics, // Variavel corrigida (antes nao utilizada)
                    recentActivity: {
                        sprints: currentSprints.map(s => ({
                            id: s.id,
                            name: s.name,
                            projectName: s.project.name,
                            dates: { start: s.startDate, end: s.endDate }
                        }))
                    }
                }
            });

        } catch (error) {
            console.error('Dashboard Overview Error:', error);
            return reply.status(500).send({ success: false, error: 'Internal Server Error' });
        }
    }

    /**
     * Obter Alertas (Itens bloqueados, Sprints atrasadas)
     */
    async getAlerts(_req: FastifyRequest, reply: FastifyReply) {
        try {
            // Buscar itens bloqueados
            const blockedItems = await prisma.workItem.findMany({
                where: { isBlocked: true, isRemoved: false },
                take: 10,
                include: { assignedTo: true, project: true }
            });

            // Buscar sprints "Em Risco"
            const twoDaysFromNow = new Date();
            twoDaysFromNow.setDate(twoDaysFromNow.getDate() + 2);

            const expiringSprints = await prisma.sprint.findMany({
                where: {
                    state: 'active',
                    endDate: { lte: twoDaysFromNow }
                },
                include: { project: true }
            });

            return reply.send({
                success: true,
                data: {
                    blockedItems,
                    expiringSprints
                }
            });
        } catch (error) {
            return reply.status(500).send({ success: false, error: 'Failed to fetch alerts' });
        }
    }

    /**
     * Buscar Sprints Atuais (Helper para listagem do dashboard)
     */
    async getCurrentSprints(_req: FastifyRequest, reply: FastifyReply) {
        try {
            const sprints = await prisma.sprint.findMany({
                where: { state: 'active' },
                include: {
                    project: { select: { name: true } },
                    capacities: true
                }
            });
            return reply.send({ success: true, data: sprints });
        } catch (error) {
            return reply.status(500).send({ success: false, error: 'Failed' });
        }
    }
}

export const dashboardController = new DashboardController();
