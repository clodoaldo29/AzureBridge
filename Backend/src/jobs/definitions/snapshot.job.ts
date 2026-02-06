import { azureSyncQueue } from '../queue';
import { logger } from '@/utils/logger';

export const JOB_IDS = {
    DAILY_SNAPSHOT: 'daily-snapshot-job',
};

/**
 * Schedule the Daily Snapshot Job
 * Runs every day at 23:55
 */
export async function scheduleSnapshotJob() {
    try {
        // Remove existing
        const repeatableJobs = await azureSyncQueue.getRepeatableJobs();
        for (const job of repeatableJobs) {
            if (job.key.includes('daily-snapshot')) {
                await azureSyncQueue.removeRepeatableByKey(job.key);
            }
        }

        // Add new job
        await azureSyncQueue.add(
            'daily-snapshot',
            {},
            {
                jobId: JOB_IDS.DAILY_SNAPSHOT,
                repeat: {
                    pattern: '55 23 * * *', // At 23:55 every day
                    // For testing/demo purposes, we could run it more often, but PROD is daily
                },
            }
        );

        logger.info('📸 Daily Snapshot Job scheduled: Runs at 23:55');
    } catch (error) {
        logger.error('Failed to schedule Snapshot Job', error);
    }
}
