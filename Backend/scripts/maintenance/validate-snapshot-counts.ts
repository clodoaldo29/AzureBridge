import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
    const sprints = await prisma.sprint.findMany({
        where: {
            workItems: { some: {} },
            snapshots: { some: {} },
        },
        include: {
            project: { select: { name: true } },
        },
        orderBy: { startDate: 'asc' },
    });

    for (const sprint of sprints) {
        const snapshots = await prisma.sprintSnapshot.findMany({
            where: { sprintId: sprint.id },
            orderBy: { snapshotDate: 'asc' },
            select: {
                snapshotDate: true,
                todoCount: true,
                inProgressCount: true,
                doneCount: true,
            },
        });

        const totalWIs = await prisma.workItem.count({
            where: { sprintId: sprint.id, isRemoved: false },
        });

        console.log(`\n${sprint.project?.name} / ${sprint.name} (${totalWIs} WIs)`);
        console.log('  Data        ToDo  InProg  Done  Total');
        console.log('  ' + '-'.repeat(45));

        for (const s of snapshots) {
            const date = s.snapshotDate.toISOString().slice(0, 10);
            const total = s.todoCount + s.inProgressCount + s.doneCount;
            const marker = total !== totalWIs ? ' !!!' : '';
            console.log(
                `  ${date}   ${String(s.todoCount).padStart(4)}  ${String(s.inProgressCount).padStart(6)}  ${String(s.doneCount).padStart(4)}  ${String(total).padStart(5)}${marker}`,
            );
        }
    }

    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
