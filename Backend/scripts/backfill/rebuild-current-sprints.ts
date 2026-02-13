/**
 * Recalcula contadores de estado para snapshots das sprints atuais.
 * Uso: npx tsx scripts/backfill/rebuild-current-sprints.ts
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

const TARGET_IDS = [
    'cmlfclgzr001k1zutr3b4n3xr', // AV-NAV SP11
    'cmlfdh1hl000wbfm302uv07on', // Sprint 5
];

function toUTCMidnight(d: Date): number {
    const dt = new Date(d);
    dt.setUTCHours(0, 0, 0, 0);
    return dt.getTime();
}

async function main() {
    console.log('REBUILD CURRENT SPRINT SNAPSHOT COUNTS');
    console.log('='.repeat(60));

    for (const sprintId of TARGET_IDS) {
        const sprint = await prisma.sprint.findUnique({
            where: { id: sprintId },
            include: { project: { select: { name: true } } },
        });

        if (!sprint) {
            console.log(`Sprint ${sprintId} nao encontrada`);
            continue;
        }

        const snapshots = await prisma.sprintSnapshot.findMany({
            where: { sprintId },
            orderBy: { snapshotDate: 'asc' },
            select: { id: true, snapshotDate: true, todoCount: true, inProgressCount: true, doneCount: true },
        });

        const workItems = await prisma.workItem.findMany({
            where: { sprintId, isRemoved: false },
            select: { id: true, createdDate: true, activatedDate: true, closedDate: true },
        });

        console.log(`\n${sprint.project?.name} / ${sprint.name}: ${snapshots.length} snapshots, ${workItems.length} WIs`);

        let updated = 0;
        for (const snap of snapshots) {
            const dayTs = toUTCMidnight(snap.snapshotDate);
            const dayEnd = dayTs + 24 * 60 * 60 * 1000;

            let todo = 0, inProgress = 0, done = 0;

            for (const item of workItems) {
                const closedTs = item.closedDate ? toUTCMidnight(item.closedDate) : null;
                const activatedTs = item.activatedDate ? toUTCMidnight(item.activatedDate) : null;

                if (closedTs !== null && closedTs < dayEnd) {
                    done++;
                } else if (activatedTs !== null && activatedTs < dayEnd) {
                    inProgress++;
                } else {
                    todo++;
                }
            }

            const changed = snap.todoCount !== todo || snap.inProgressCount !== inProgress || snap.doneCount !== done;
            if (changed) {
                await prisma.sprintSnapshot.update({
                    where: { id: snap.id },
                    data: { todoCount: todo, inProgressCount: inProgress, doneCount: done },
                });
                const date = snap.snapshotDate.toISOString().slice(0, 10);
                console.log(`  ${date}: ${snap.todoCount}/${snap.inProgressCount}/${snap.doneCount} -> ${todo}/${inProgress}/${done}`);
                updated++;
            }
        }

        console.log(`  Total atualizado: ${updated} snapshots`);
    }

    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});
