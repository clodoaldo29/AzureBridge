import { redisClient } from './redis.client';
import { logger } from '@/utils/logger';

/**
 * Cache Service
 * Handles caching operations with Redis
 */
export class CacheService {
    private readonly DEFAULT_TTL = 3600; // 1 hour

    /**
     * Get value from cache
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
     * Set value in cache
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
     * Delete value from cache
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
     * Delete multiple keys by pattern
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
     * Check if key exists
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
     * Get or set (cache-aside pattern)
     */
    async getOrSet<T>(
        key: string,
        factory: () => Promise<T>,
        ttl: number = this.DEFAULT_TTL
    ): Promise<T> {
        // Try to get from cache
        const cached = await this.get<T>(key);
        if (cached !== null) {
            return cached;
        }

        // Not in cache, get from factory
        const value = await factory();

        // Store in cache
        await this.set(key, value, ttl);

        return value;
    }

    /**
     * Invalidate cache for work items
     */
    async invalidateWorkItems(sprintId?: string): Promise<void> {
        if (sprintId) {
            await this.deletePattern(`workitems:sprint:${sprintId}:*`);
        } else {
            await this.deletePattern('workitems:*');
        }
    }

    /**
     * Invalidate cache for sprints
     */
    async invalidateSprints(projectId?: string): Promise<void> {
        if (projectId) {
            await this.deletePattern(`sprints:project:${projectId}:*`);
        } else {
            await this.deletePattern('sprints:*');
        }
    }

    /**
     * Clear all cache
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

// Export singleton instance
export const cacheService = new CacheService();
