import { Worker, Job } from 'bullmq';
import { logger } from '@/utils/logger';
import { QUEUE_NAMES } from './queue';
import { syncService } from '@/services/sync.service';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

const connection = {
    host: REDIS_HOST,
    port: REDIS_PORT,
};

/**
 * Sync Job Processor
 */
async function processSyncJob(job: Job) {
    logger.info(`[Job ${job.id}] Starting Sync Job: ${job.name}`);

    try {
        switch (job.name) {
            case 'incremental-sync':
                logger.info(`[Job ${job.id}] Running Incremental Sync...`);
                const result = await syncService.incrementalSync();
                logger.info(`[Job ${job.id}] Incremental Sync completed`, result);
                return result;

            default:
                logger.warn(`[Job ${job.id}] Unknown job name: ${job.name}`);
                throw new Error(`Unknown job name: ${job.name}`);
        }
    } catch (error) {
        logger.error(`[Job ${job.id}] Job failed`, error);
        throw error;
    }
}

/**
 * Initialize Workers
 */
export function initWorkers() {
    const worker = new Worker(
        QUEUE_NAMES.AZURE_SYNC,
        processSyncJob,
        {
            connection,
            concurrency: 1, // Ensure only one sync runs at a time
        }
    );

    worker.on('completed', (job) => {
        logger.info(`[Worker] Job ${job.id} has completed!`);
    });

    worker.on('failed', (job, err) => {
        logger.error(`[Worker] Job ${job?.id} has failed with ${err.message}`);
    });

    logger.info('🚀 Background Workers started');
    return worker;
}
