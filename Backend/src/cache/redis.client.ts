import Redis from 'ioredis';
import { logger } from '@/utils/logger';

/**
 * Redis Client
 * Singleton Redis connection
 */
class RedisClient {
    private client: Redis | null = null;
    private isConnected = false;

    /**
     * Get Redis client instance
     */
    getClient(): Redis {
        if (!this.client) {
            this.client = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379'),
                password: process.env.REDIS_PASSWORD || undefined,
                db: parseInt(process.env.REDIS_DB || '0'),
                keyPrefix: process.env.REDIS_KEY_PREFIX || 'azurebridge:',
                retryStrategy: (times) => {
                    const delay = Math.min(times * 50, 2000);
                    return delay;
                },
            });

            this.client.on('connect', () => {
                this.isConnected = true;
                logger.info('Redis connected');
            });

            this.client.on('error', (error) => {
                this.isConnected = false;
                logger.error('Redis error', error);
            });

            this.client.on('close', () => {
                this.isConnected = false;
                logger.warn('Redis connection closed');
            });
        }

        return this.client;
    }

    /**
     * Check if Redis is connected
     */
    isReady(): boolean {
        return this.isConnected;
    }

    /**
     * Disconnect from Redis
     */
    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.quit();
            this.client = null;
            this.isConnected = false;
            logger.info('Redis disconnected');
        }
    }
}

// Export singleton instance
export const redisClient = new RedisClient();
