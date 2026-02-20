import { prisma } from '../../src/database/client';
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
    const activeSprints = await prisma.sprint.findMany({
        where: { state: { in: ['active', 'Active'] } },
        select: { id: true, name: true, project: { select: { name: true } } },
    });

    if (!activeSprints.length) {
        console.log('No active sprints found for history snapshot rebuild.');
        return;
    }

    console.log(`Active sprints for safe history rebuild: ${activeSprints.length}`);

    for (const sprint of activeSprints) {
        let success = false;
        for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
            try {
                await snapshotService.rebuildSprintHistorySnapshots(sprint.id);
                console.log(`OK: ${sprint.project.name} / ${sprint.name}`);
                success = true;
                break;
            } catch (error: any) {
                const retriable = isTransientDbError(error);
                const hasNextAttempt = attempt <= RETRY_DELAYS_MS.length;
                if (!retriable || !hasNextAttempt) throw error;
                const delay = RETRY_DELAYS_MS[attempt - 1];
                console.warn(
                    `WARN: DB unavailable for ${sprint.project.name} / ${sprint.name} (attempt ${attempt}). Retrying in ${Math.floor(delay / 1000)}s...`
                );
                await sleep(delay);
            }
        }

        if (!success) {
            throw new Error(`Failed to rebuild history snapshots for sprint ${sprint.id}`);
        }
    }
}

main()
    .catch(async (err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
