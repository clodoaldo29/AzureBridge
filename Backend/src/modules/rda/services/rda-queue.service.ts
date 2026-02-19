import { Job, Queue, Worker } from 'bullmq';
import type { GenerationJobPayload } from '@/modules/rda/schemas/generation.schema';
import { generationOrchestrator } from '@/modules/rda/agents/orchestrator';
import { logger } from '@/utils/logger';

const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = Number(process.env.REDIS_PORT || '6379');

const connection = {
    host: REDIS_HOST,
    port: REDIS_PORT,
};

const QUEUE_NAME = 'rda-generation-queue';

class RDAQueueService {
    private readonly queue = new Queue<GenerationJobPayload>(QUEUE_NAME, {
        connection,
        defaultJobOptions: {
            attempts: 2,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: { age: 24 * 3600, count: 500 },
            removeOnFail: { age: 7 * 24 * 3600 },
        },
    });

    private worker: Worker<GenerationJobPayload> | null = null;

    async enqueue(payload: GenerationJobPayload): Promise<string> {
        const job = await this.queue.add('rda-generate', payload, {
            jobId: payload.generationId,
        });
        return String(job.id ?? payload.generationId);
    }

    initWorker(): Worker<GenerationJobPayload> {
        if (this.worker) {
            return this.worker;
        }

        this.worker = new Worker<GenerationJobPayload>(
            QUEUE_NAME,
            async (job: Job<GenerationJobPayload>) => {
                logger.info('[RDAQueue] processing generation', { generationId: job.data.generationId });
                try {
                    await generationOrchestrator.run(job.data.generationId);
                } catch (error) {
                    await generationOrchestrator.fail(job.data.generationId, error);
                    throw error;
                }
            },
            {
                connection,
                concurrency: 1,
            },
        );

        this.worker.on('completed', (job) => {
            logger.info('[RDAQueue] generation completed', { jobId: job.id });
        });

        this.worker.on('failed', (job, err) => {
            logger.error('[RDAQueue] generation failed', {
                jobId: job?.id,
                generationId: job?.data?.generationId,
                error: err.message,
            });
        });

        return this.worker;
    }
}

export const rdaQueueService = new RDAQueueService();
