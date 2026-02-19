import { PrismaClient } from '@prisma/client';
import { logger } from '@/utils/logger';

function resolveDatabaseUrlSource(): void {
    const source = (process.env.DATABASE_URL_SOURCE ?? 'primary').trim().toLowerCase();
    const primaryUrl = process.env.DATABASE_URL?.trim();
    const fallbackUrl = process.env.DATABASE_URL_FALLBACK?.trim();

    if (source === 'fallback') {
        if (!fallbackUrl) {
            logger.warn('[Database] DATABASE_URL_SOURCE=fallback, mas DATABASE_URL_FALLBACK não está configurada. Usando DATABASE_URL.');
            return;
        }

        process.env.DATABASE_URL = fallbackUrl;
        logger.warn('[Database] Usando DATABASE_URL_FALLBACK por configuração manual.');
        return;
    }

    if (!primaryUrl && fallbackUrl) {
        process.env.DATABASE_URL = fallbackUrl;
        logger.warn('[Database] DATABASE_URL ausente. Fallback aplicado automaticamente.');
    }
}

resolveDatabaseUrlSource();

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

// Encerramento gracioso
process.on('beforeExit', async () => {
    logger.info('Disconnecting Prisma Client...');
    await prisma.$disconnect();
});

// Helper de verificacao de saude do banco
export async function checkDatabaseConnection(): Promise<boolean> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
    } catch (error) {
        logger.error('Database connection failed:', error);
        return false;
    }
}
