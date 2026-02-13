import { snapshotService } from '../../src/services/snapshot.service';

const RETRY_DELAYS_MS = [5000, 15000, 30000];

function isTransientDbError(error: any): boolean {
    const msg = String(error?.message || error || '');
    return (
        msg.includes('PrismaClientInitializationError') ||
        msg.includes('Can\'t reach database server') ||
        msg.includes('Connection terminated unexpectedly') ||
        msg.includes('Timed out fetching a new connection')
    );
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
        try {
            await snapshotService.captureDailySnapshots();
            return;
        } catch (error: any) {
            const retriable = isTransientDbError(error);
            const hasNextAttempt = attempt <= RETRY_DELAYS_MS.length;
            if (!retriable || !hasNextAttempt) throw error;

            const delay = RETRY_DELAYS_MS[attempt - 1];
            console.warn(`⚠️ Snapshot DB unavailable (attempt ${attempt}). Retrying in ${Math.floor(delay / 1000)}s...`);
            await sleep(delay);
        }
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
