import { azureSyncQueue } from '../queue';
import { logger } from '@/utils/logger';

export const JOB_IDS = {
    INCREMENTAL_SYNC: 'incremental-sync-job',
};

/**
 * Agendar Job de Sincronizacao Incremental
 * Executa a cada 30 minutos
 */
export async function scheduleSyncJob() {
    try {
        // Remover jobs repetitivos existentes para evitar duplicatas ao reiniciar
        const repeatableJobs = await azureSyncQueue.getRepeatableJobs();
        for (const job of repeatableJobs) {
            if (job.key.includes('incremental-sync')) {
                await azureSyncQueue.removeRepeatableByKey(job.key);
            }
        }

        // Adicionar novo job com intervalo de 30 min
        await azureSyncQueue.add(
            'incremental-sync',
            {},
            {
                jobId: JOB_IDS.INCREMENTAL_SYNC,
                repeat: {
                    every: 30 * 60 * 1000, // 30 minutos em ms
                    immediately: true,     // Executar uma vez ao iniciar
                },
            }
        );

        logger.info('📅 Sync Job scheduled: Runs every 30 minutes');
    } catch (error) {
        logger.error('Failed to schedule Sync Job', error);
    }
}
