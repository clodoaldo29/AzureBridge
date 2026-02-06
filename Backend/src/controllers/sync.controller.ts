import { FastifyRequest, FastifyReply } from 'fastify';
import { syncService } from '@/services/sync.service';
import { logger } from '@/utils/logger';

export class SyncController {
    /**
     * Trigger Incremental Sync
     */
    async triggerIncrementalSync(_req: FastifyRequest, reply: FastifyReply) {
        try {
            logger.info('API: Triggering Incremental Sync');

            // Run in background (don't await completion for the response, unless preferred)
            // Ideally passing off to the Queue, but direct service call works for MVP if fast enough
            // Re-using the logic:

            const result = await syncService.incrementalSync();

            return reply.send({
                success: true,
                message: 'Incremental sync completed',
                data: result
            });
        } catch (error) {
            logger.error('API: Sync failed', error);
            return reply.status(500).send({
                success: false,
                error: (error as Error).message
            });
        }
    }

    /**
     * Trigger Full Sync (Heavy operation)
     */
    async triggerFullSync(_req: FastifyRequest, reply: FastifyReply) {
        try {
            logger.info('API: Triggering Full Sync');
            // This might timeout HTTP request if awaited. 
            // In a real scenario, push to Queue and return Job ID.

            const result = await syncService.fullSync();

            return reply.send({
                success: true,
                message: 'Full sync completed',
                data: result
            });
        } catch (error) {
            logger.error('API: Full Sync failed', error);
            return reply.status(500).send({
                success: false,
                error: (error as Error).message
            });
        }
    }
}

export const syncController = new SyncController();
