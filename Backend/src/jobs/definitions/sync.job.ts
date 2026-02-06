import { azureSyncQueue } from '../queue';
import { logger } from '@/utils/logger';

export const JOB_IDS = {
    INCREMENTAL_SYNC: 'incremental-sync-job',
};

/**
 * Schedule the Incremental Sync Job
 * Runs every 30 minutes
 */
export async function scheduleSyncJob() {
    try {
        // Remove existing repeatable jobs to avoid duplicates on restart
        const repeatableJobs = await azureSyncQueue.getRepeatableJobs();
        for (const job of repeatableJobs) {
            if (job.key.includes('incremental-sync')) {
                await azureSyncQueue.removeRepeatableByKey(job.key);
            }
        }

        // Add new job with 30 min interval
        await azureSyncQueue.add(
            'incremental-sync',
            {},
            {
                jobId: JOB_IDS.INCREMENTAL_SYNC,
                repeat: {
                    every: 30 * 60 * 1000, // 30 minutes in ms
                    immediately: true,     // Run once on startup
                },
            }
        );

        logger.info('📅 Sync Job scheduled: Runs every 30 minutes');
    } catch (error) {
        logger.error('Failed to schedule Sync Job', error);
    }
}
