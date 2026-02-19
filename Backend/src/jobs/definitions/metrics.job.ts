import { azureSyncQueue } from '../queue';
import { logger } from '@/utils/logger';

export const JOB_IDS = {
    DAILY_METRICS: 'daily-metrics-job',
};

/**
 * Agendar Job de Metricas Diarias
 * Executa todos os dias as 00:30 (apos snapshots)
 */
export async function scheduleMetricsJob() {
    try {
        // Remover existentes
        const repeatableJobs = await azureSyncQueue.getRepeatableJobs();
        for (const job of repeatableJobs) {
            if (job.key.includes('daily-metrics')) {
                await azureSyncQueue.removeRepeatableByKey(job.key);
            }
        }

        // Adicionar novo job
        await azureSyncQueue.add(
            'daily-metrics',
            {},
            {
                jobId: JOB_IDS.DAILY_METRICS,
                repeat: {
                    pattern: '30 0 * * *', // As 00:30 todos os dias
                },
            }
        );

        logger.info('📊 Daily Metrics Job scheduled: Runs at 00:30');
    } catch (error) {
        logger.error('Failed to schedule Metrics Job', error);
    }
}
