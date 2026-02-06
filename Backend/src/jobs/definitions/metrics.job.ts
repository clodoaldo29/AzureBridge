import { azureSyncQueue } from '../queue';
import { logger } from '@/utils/logger';

export const JOB_IDS = {
    DAILY_METRICS: 'daily-metrics-job',
};

/**
 * Schedule the Daily Metrics Job
 * Runs every day at 00:30 (after snapshots)
 */
export async function scheduleMetricsJob() {
    try {
        // Remove existing
        const repeatableJobs = await azureSyncQueue.getRepeatableJobs();
        for (const job of repeatableJobs) {
            if (job.key.includes('daily-metrics')) {
                await azureSyncQueue.removeRepeatableByKey(job.key);
            }
        }

        // Add new job
        await azureSyncQueue.add(
            'daily-metrics',
            {},
            {
                jobId: JOB_IDS.DAILY_METRICS,
                repeat: {
                    pattern: '30 0 * * *', // At 00:30 every day
                },
            }
        );

        logger.info('📊 Daily Metrics Job scheduled: Runs at 00:30');
    } catch (error) {
        logger.error('Failed to schedule Metrics Job', error);
    }
}
