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

// Encerramento gracioso
process.on('beforeExit', async () => {
    logger.info('Disconnecting Prisma Client...');
    await prisma.$disconnect();
});

const DB_HEALTH_CACHE_TTL_MS = 15_000;

type DatabaseHealthState = {
    connected: boolean | null;
    checkedAt: number;
    inFlight: Promise<boolean> | null;
};

const databaseHealthState: DatabaseHealthState = {
    connected: null,
    checkedAt: 0,
    inFlight: null
};

async function runDatabaseHealthCheck(): Promise<boolean> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
    } catch (error) {
        logger.error('Database connection failed:', error);
        return false;
    }
}

async function refreshDatabaseHealth(): Promise<boolean> {
    if (databaseHealthState.inFlight) {
        return databaseHealthState.inFlight;
    }

    databaseHealthState.inFlight = runDatabaseHealthCheck()
        .then((connected) => {
            databaseHealthState.connected = connected;
            databaseHealthState.checkedAt = Date.now();
            return connected;
        })
        .finally(() => {
            databaseHealthState.inFlight = null;
        });

    return databaseHealthState.inFlight;
}

export async function checkDatabaseConnection(): Promise<boolean> {
    return refreshDatabaseHealth();
}

export async function getDatabaseHealthSnapshot(options?: {
    maxAgeMs?: number;
    waitForFresh?: boolean;
}) {
    const maxAgeMs = options?.maxAgeMs ?? DB_HEALTH_CACHE_TTL_MS;
    const waitForFresh = options?.waitForFresh ?? false;
    const hasRecentValue = databaseHealthState.connected !== null
        && (Date.now() - databaseHealthState.checkedAt) <= maxAgeMs;

    if (hasRecentValue) {
        return {
            connected: databaseHealthState.connected,
            checkedAt: databaseHealthState.checkedAt > 0 ? new Date(databaseHealthState.checkedAt) : null,
            stale: false
        };
    }

    if (waitForFresh) {
        const connected = await refreshDatabaseHealth();
        return {
            connected,
            checkedAt: databaseHealthState.checkedAt > 0 ? new Date(databaseHealthState.checkedAt) : null,
            stale: false
        };
    }

    void refreshDatabaseHealth();

    return {
        connected: databaseHealthState.connected,
        checkedAt: databaseHealthState.checkedAt > 0 ? new Date(databaseHealthState.checkedAt) : null,
        stale: true
    };
}
