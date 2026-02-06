import 'dotenv/config';
import { prisma } from './database/client';
import { initWorkers } from './jobs/worker';
import { scheduleSyncJob } from './jobs/definitions/sync.job';
import { scheduleSnapshotJob } from './jobs/definitions/snapshot.job';
import { scheduleMetricsJob } from './jobs/definitions/metrics.job';
import { logger } from './utils/logger';

/**
 * Worker Process Entry Point
 */
async function start() {
    logger.info('🔧 Starting Worker Process...');

    // Initialize Database
    try {
        await prisma.$connect();
        logger.info('✅ Database connected');
    } catch (error) {
        logger.error('❌ Database connection failed', error);
        process.exit(1);
    }

    // Initialize Worker Listeners
    initWorkers();

    // Schedule Recurring Jobs
    await scheduleSyncJob();
    await scheduleSnapshotJob();
    await scheduleMetricsJob();

    // Handle Shutdown
    const signals = ['SIGTERM', 'SIGINT'];
    signals.forEach((signal) => {
        process.on(signal, async () => {
            logger.info(`${signal} received. Closing resources...`);
            await prisma.$disconnect();
            process.exit(0);
        });
    });
}

start();
