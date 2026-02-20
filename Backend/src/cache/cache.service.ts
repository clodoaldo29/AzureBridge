import { redisClient } from './redis.client';
import { logger } from '@/utils/logger';

/**
 * Servico de Cache
 * Gerencia operacoes de cache com Redis
 */
export class CacheService {
    private readonly DEFAULT_TTL = 3600; // 1 hora

    /**
     * Obter valor do cache
     */
    async get<T>(key: string): Promise<T | null> {
        try {
            const client = redisClient.getClient();
            const value = await client.get(key);

            if (!value) {
                return null;
            }

            return JSON.parse(value) as T;
        } catch (error) {
            logger.error('Cache get error', { key, error });
            return null;
        }
    }

    /**
     * Definir valor no cache
     */
    async set(key: string, value: any, ttl: number = this.DEFAULT_TTL): Promise<void> {
        try {
            const client = redisClient.getClient();
            await client.setex(key, ttl, JSON.stringify(value));
        } catch (error) {
            logger.error('Cache set error', { key, error });
        }
    }

    /**
     * Remover valor do cache
     */
    async delete(key: string): Promise<void> {
        try {
            const client = redisClient.getClient();
            await client.del(key);
        } catch (error) {
            logger.error('Cache delete error', { key, error });
        }
    }

    /**
     * Remover multiplas chaves por padrao
     */
    async deletePattern(pattern: string): Promise<void> {
        try {
            const client = redisClient.getClient();
            const keys = await client.keys(pattern);

            if (keys.length > 0) {
                await client.del(...keys);
                logger.info(`Deleted ${keys.length} keys matching pattern ${pattern}`);
            }
        } catch (error) {
            logger.error('Cache delete pattern error', { pattern, error });
        }
    }

    /**
     * Verificar se a chave existe
     */
    async exists(key: string): Promise<boolean> {
        try {
            const client = redisClient.getClient();
            const result = await client.exists(key);
            return result === 1;
        } catch (error) {
            logger.error('Cache exists error', { key, error });
            return false;
        }
    }

    /**
     * Obter ou definir (padrao cache-aside)
     */
    async getOrSet<T>(
        key: string,
        factory: () => Promise<T>,
        ttl: number = this.DEFAULT_TTL
    ): Promise<T> {
        // Tentar obter do cache
        const cached = await this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        // Nao esta no cache, obter via factory
        const value = await factory();

        // Armazenar no cache
        await this.set(key, value, ttl);

        return value;
    }

    /**
     * Invalidar cache de work items
     */
    async invalidateWorkItems(sprintId?: string): Promise<void> {
        if (sprintId) {
            await this.deletePattern(`workitems:sprint:${sprintId}:*`);
        } else {
            await this.deletePattern('workitems:*');
        }
    }

    /**
     * Invalidar cache de sprints
     */
    async invalidateSprints(projectId?: string): Promise<void> {
        if (projectId) {
            await this.deletePattern(`sprints:project:${projectId}:*`);
        } else {
            await this.deletePattern('sprints:*');
        }
    }

    /**
     * Limpar todo o cache
     */
    async clear(): Promise<void> {
        try {
            const client = redisClient.getClient();
            await client.flushdb();
            logger.info('Cache cleared');
        } catch (error) {
            logger.error('Cache clear error', error);
        }
    }
}

// Exporta instancia singleton
export const cacheService = new CacheService();
