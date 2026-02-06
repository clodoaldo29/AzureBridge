import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

// Singleton pattern para Prisma Client
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        log:
            process.env.NODE_ENV === 'development'
                ? ['query', 'error', 'warn']
                : ['error'],
    });

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
    logger.info('Disconnecting Prisma Client...');
    await prisma.$disconnect();
});

// Health check helper
export async function checkDatabaseConnection(): Promise<boolean> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
    } catch (error) {
        logger.error('Database connection failed:', error);
        return false;
    }
}
