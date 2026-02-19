import { FastifyRequest, FastifyReply } from 'fastify';
import { syncService } from '@/services/sync.service';
import { logger } from '@/utils/logger';

export class SyncController {
    /**
     * Disparar Sincronizacao Incremental
     */
    async triggerIncrementalSync(_req: FastifyRequest, reply: FastifyReply) {
        try {
            logger.info('API: Triggering Incremental Sync');

            // Executar em background (nao aguardar conclusao para a resposta)
            // Idealmente delegaria para a fila, mas chamada direta funciona para MVP

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
     * Disparar Sincronizacao Completa (Operacao pesada)
     */
    async triggerFullSync(_req: FastifyRequest, reply: FastifyReply) {
        try {
            logger.info('API: Triggering Full Sync');
            // Pode causar timeout na requisicao HTTP se aguardado.
            // Em cenario real, enviar para a fila e retornar ID do job.

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
