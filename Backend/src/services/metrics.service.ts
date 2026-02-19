import { prisma } from '@/database/client';
import { logger } from '@/utils/logger';
import { differenceInDays, subDays } from 'date-fns';

type MetricType = 'velocity' | 'cycle_time' | 'lead_time' | 'throughput';

export class MetricsService {

    /**
     * Calcular e salvar todas as metricas para projetos ativos
     */
    async calculateAllMetrics(): Promise<void> {
        logger.info('📊 Starting Metrics Calculation...');

        const projects = await prisma.project.findMany({
            where: { state: { not: 'deleting' } }
        });

        for (const project of projects) {
            await this.calculateVelocity(project.id);
            await this.calculateCycleTime(project.id);
            await this.calculateLeadTime(project.id);
        }

        logger.info('✅ Metrics Calculation completed.');
    }

    /**
     * Calcular Velocidade (Media de Pontos Completados nas ultimas 5 sprints)
     */
    async calculateVelocity(projectId: string): Promise<void> {
        try {
            // Buscar ultimas 5 sprints concluidas
            const sprints = await prisma.sprint.findMany({
                where: {
                    projectId,
                    state: 'past',
                    timeFrame: 'past'
                },
                orderBy: { endDate: 'desc' },
                take: 5
            });

            if (sprints.length === 0) return;

            // Calcular media
            const totalPoints = sprints.reduce((acc, s) => acc + (s.completedStoryPoints || 0), 0);
            const averageVelocity = totalPoints / sprints.length;

            // Salvar snapshot
            await this.saveMetricSnapshot(projectId, 'velocity', averageVelocity, {
                sprintsRaw: sprints.map(s => ({ name: s.name, points: s.completedStoryPoints })),
                sprintsCount: sprints.length
            });

            logger.info(`Velocity calculated for project ${projectId}: ${averageVelocity.toFixed(1)}`);
        } catch (error) {
            logger.error(`Failed to calculate velocity for project ${projectId}`, error);
        }
    }

    /**
     * Calcular Cycle Time (Mediana de dias de In Progress -> Done)
     * Considera itens fechados nos ultimos 30 dias
     */
    async calculateCycleTime(projectId: string): Promise<void> {
        try {
            const thirtyDaysAgo = subDays(new Date(), 30);

            const completedItems = await prisma.workItem.findMany({
                where: {
                    projectId,
                    state: { in: ['Done', 'Closed', 'Completed'] }, // Ajustar conforme o processo
                    closedDate: { gte: thirtyDaysAgo },
                    activatedDate: { not: null } // Deve ter sido iniciado
                },
                select: {
                    id: true,
                    closedDate: true,
                    activatedDate: true
                }
            });

            if (completedItems.length === 0) return;

            const durations = completedItems
                .map(item => {
                    if (!item.closedDate || !item.activatedDate) return 0;
                    return differenceInDays(item.closedDate, item.activatedDate);
                })
                .sort((a, b) => a - b);

            const median = this.calculateMedian(durations);

            await this.saveMetricSnapshot(projectId, 'cycle_time', median, {
                itemCount: completedItems.length,
                period: 'last_30_days',
                p90: this.calculatePercentile(durations, 90)
            });

            logger.info(`Cycle Time calculated for project ${projectId}: ${median} days`);
        } catch (error) {
            logger.error(`Failed to calculate cycle time for project ${projectId}`, error);
        }
    }

    /**
     * Calcular Lead Time (Mediana de dias de Created -> Done)
     */
    async calculateLeadTime(projectId: string): Promise<void> {
        try {
            const thirtyDaysAgo = subDays(new Date(), 30);

            const completedItems = await prisma.workItem.findMany({
                where: {
                    projectId,
                    state: { in: ['Done', 'Closed', 'Completed'] },
                    closedDate: { gte: thirtyDaysAgo }
                },
                select: {
                    id: true,
                    closedDate: true,
                    createdDate: true
                }
            });

            if (completedItems.length === 0) return;

            const durations = completedItems
                .map(item => {
                    if (!item.closedDate) return 0;
                    return differenceInDays(item.closedDate, item.createdDate);
                })
                .sort((a, b) => a - b);

            const median = this.calculateMedian(durations);

            await this.saveMetricSnapshot(projectId, 'lead_time', median, {
                itemCount: completedItems.length,
                period: 'last_30_days'
            });

            logger.info(`Lead Time calculated for project ${projectId}: ${median} days`);
        } catch (error) {
            logger.error(`Failed to calculate lead time for project ${projectId}`, error);
        }
    }

    private async saveMetricSnapshot(projectId: string, type: MetricType, value: number, metadata: any) {
        // Buscar existente para hoje ou criar novo
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Abordagem simples: criar novo snapshot toda vez (historico)
        await prisma.metricSnapshot.create({
            data: {
                projectId,
                metricType: type,
                value,
                metadata,
                period: 'daily',
                periodStart: today,
                periodEnd: today,
                snapshotDate: new Date()
            }
        });
    }

    private calculateMedian(numbers: number[]): number {
        if (numbers.length === 0) return 0;
        const middle = Math.floor(numbers.length / 2);
        if (numbers.length % 2 === 0) {
            return (numbers[middle - 1] + numbers[middle]) / 2;
        }
        return numbers[middle];
    }

    private calculatePercentile(numbers: number[], percentile: number): number {
        if (numbers.length === 0) return 0;
        const index = Math.ceil((percentile / 100) * numbers.length) - 1;
        return numbers[index];
    }
}

export const metricsService = new MetricsService();
