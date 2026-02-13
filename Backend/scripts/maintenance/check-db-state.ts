import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
    const sprints = await prisma.sprint.findMany({
        orderBy: { startDate: 'desc' },
        select: {
            id: true,
            name: true,
            state: true,
            startDate: true,
            endDate: true,
            project: { select: { name: true } },
            _count: { select: { workItems: true, snapshots: true } },
        },
    });

    console.log('SPRINTS NO BANCO');
    console.log('='.repeat(100));
    console.log(
        'Projeto'.padEnd(22) +
        'Sprint'.padEnd(18) +
        'Estado'.padEnd(10) +
        'Inicio'.padEnd(13) +
        'Fim'.padEnd(13) +
        'WIs'.padEnd(7) +
        'Snaps',
    );
    console.log('-'.repeat(100));

    for (const s of sprints) {
        console.log(
            (s.project?.name || '?').slice(0, 21).padEnd(22) +
            s.name.slice(0, 17).padEnd(18) +
            s.state.padEnd(10) +
            s.startDate.toISOString().slice(0, 10).padEnd(13) +
            s.endDate.toISOString().slice(0, 10).padEnd(13) +
            String(s._count.workItems).padEnd(7) +
            s._count.snapshots,
        );
    }

    const totalWI = await prisma.workItem.count();
    const totalSnaps = await prisma.sprintSnapshot.count();
    console.log('');
    console.log(`TOTAIS: ${totalWI} work items | ${totalSnaps} snapshots`);

    const withActivated = await prisma.workItem.count({ where: { activatedDate: { not: null } } });
    const withClosed = await prisma.workItem.count({ where: { closedDate: { not: null } } });
    console.log(`WIs com activatedDate: ${withActivated} | com closedDate: ${withClosed}`);

    const noWIs = sprints.filter(s => s._count.workItems === 0);
    console.log('');
    console.log(`Sprints SEM work items: ${noWIs.length}`);
    for (const s of noWIs) {
        console.log(`  - ${s.project?.name} / ${s.name} (${s.state})`);
    }

    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
