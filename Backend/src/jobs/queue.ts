import { Queue, QueueEvents } from 'bullmq';
import { logger } from '@/utils/logger';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

const connection = {
    host: REDIS_HOST,
    port: REDIS_PORT,
};

// Queue Names
export const QUEUE_NAMES = {
    AZURE_SYNC: 'azure-sync-queue',
};

// Queue Instances
export const azureSyncQueue = new Queue(QUEUE_NAMES.AZURE_SYNC, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: {
            age: 24 * 3600, // Keep for 24 hours
            count: 1000,
        },
        removeOnFail: {
            age: 7 * 24 * 3600, // Keep for 7 days
        },
    },
});

// Setup Queue Events (optional, for global monitoring)
export const azureSyncEvents = new QueueEvents(QUEUE_NAMES.AZURE_SYNC, { connection });

logger.info(`BullMQ Queues initialized on ${REDIS_HOST}:${REDIS_PORT}`);
