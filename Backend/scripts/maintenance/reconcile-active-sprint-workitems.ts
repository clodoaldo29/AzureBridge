import { prisma } from '../../src/database/client';
import { workItemsService } from '../../src/integrations/azure';

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

async function reconcileActiveSprints() {
    const activeSprints = await prisma.sprint.findMany({
        where: { state: { in: ['active', 'Active'] } },
        include: { project: { select: { name: true } } },
    });

    if (!activeSprints.length) {
        console.log('No active sprints found for reconciliation.');
        return;
    }

    let totalMarkedRemoved = 0;
    let totalReactivated = 0;

    for (const sprint of activeSprints) {
        console.log(`Reconciling: ${sprint.project.name} / ${sprint.name}`);

        const azureItems = await workItemsService.getWorkItemsForSprint(sprint.path);
        const azureIdSet = new Set(
            azureItems
                .map((wi) => wi.id)
                .filter((id): id is number => typeof id === 'number')
        );

        const localItems = await prisma.workItem.findMany({
            where: { sprintId: sprint.id },
            select: { id: true, azureId: true, isRemoved: true },
        });

        const toMarkRemoved = localItems
            .filter((w) => !w.isRemoved && !azureIdSet.has(w.azureId))
            .map((w) => w.id);

        const toReactivate = localItems
            .filter((w) => w.isRemoved && azureIdSet.has(w.azureId))
            .map((w) => w.id);

        if (toMarkRemoved.length) {
            const res = await prisma.workItem.updateMany({
                where: { id: { in: toMarkRemoved } },
                data: {
                    isRemoved: true,
                    lastSyncAt: new Date(),
                },
            });
            totalMarkedRemoved += res.count;
        }

        if (toReactivate.length) {
            const res = await prisma.workItem.updateMany({
                where: { id: { in: toReactivate } },
                data: {
                    isRemoved: false,
                    lastSyncAt: new Date(),
                },
            });
            totalReactivated += res.count;
        }

        console.log(
            `  Azure=${azureIdSet.size} | Local=${localItems.length} | markedRemoved=${toMarkRemoved.length} | reactivated=${toReactivate.length}`
        );
    }

    console.log(`Done. markedRemoved=${totalMarkedRemoved}, reactivated=${totalReactivated}`);
}

async function main() {
    for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
        try {
            await reconcileActiveSprints();
            return;
        } catch (error: any) {
            const retriable = isTransientDbError(error);
            const hasNextAttempt = attempt <= RETRY_DELAYS_MS.length;
            if (!retriable || !hasNextAttempt) throw error;

            const delay = RETRY_DELAYS_MS[attempt - 1];
            console.warn(`DB unavailable (attempt ${attempt}). Retrying in ${Math.floor(delay / 1000)}s...`);
            await sleep(delay);
        }
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
