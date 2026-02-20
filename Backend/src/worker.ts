import 'dotenv/config';
import { prisma } from './database/client';
import { initWorkers } from './jobs/worker';
import { scheduleSyncJob } from './jobs/definitions/sync.job';
import { scheduleSnapshotJob } from './jobs/definitions/snapshot.job';
import { scheduleMetricsJob } from './jobs/definitions/metrics.job';
import { logger } from './utils/logger';
import { rdaQueueService } from '@/modules/rda/services/rda-queue.service';

/**
 * Ponto de entrada do processo Worker.
 */
async function start() {
    logger.info('Starting Worker Process...');
    const isRdaEnabled = (process.env.FEATURE_RDA_MODULE ?? 'false').toLowerCase() === 'true';

    // Inicializar banco de dados.
    try {
        await prisma.$connect();
        logger.info('Database connected');
    } catch (error) {
        logger.error('Database connection failed', error);
        process.exit(1);
    }

    // Inicializar ouvintes dos workers.
    initWorkers();
    if (isRdaEnabled) {
        rdaQueueService.initWorker();
    } else {
        logger.info('[FeatureFlag] RDA queue worker disabled (FEATURE_RDA_MODULE=false)');
    }

    // Agendar jobs recorrentes.
    await scheduleSyncJob();
    await scheduleSnapshotJob();
    await scheduleMetricsJob();

    // Gerenciar encerramento.
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
