import { azureSyncQueue } from '../queue';
import { logger } from '@/utils/logger';

export const JOB_IDS = {
    DAILY_SNAPSHOT: 'daily-snapshot-job',
};

/**
 * Agendar Job de Snapshot Diario
 * Executa todos os dias as 23:55
 */
export async function scheduleSnapshotJob() {
    try {
        // Remover existentes
        const repeatableJobs = await azureSyncQueue.getRepeatableJobs();
        for (const job of repeatableJobs) {
            if (job.key.includes('daily-snapshot')) {
                await azureSyncQueue.removeRepeatableByKey(job.key);
            }
        }

        // Adicionar novo job
        await azureSyncQueue.add(
            'daily-snapshot',
            {},
            {
                jobId: JOB_IDS.DAILY_SNAPSHOT,
                repeat: {
                    pattern: '55 23 * * *', // As 23:55 todos os dias
                    // Para testes/demo, podemos executar com mais frequencia, mas PROD e diario
                },
            }
        );

        logger.info('📸 Daily Snapshot Job scheduled: Runs at 23:55');
    } catch (error) {
        logger.error('Failed to schedule Snapshot Job', error);
    }
}
