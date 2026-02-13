import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
    // 1. Contagem de campos de data preenchidos
    const total = await prisma.workItem.count();
    const withActivated = await prisma.workItem.count({ where: { activatedDate: { not: null } } });
    const withClosed = await prisma.workItem.count({ where: { closedDate: { not: null } } });
    const withResolved = await prisma.workItem.count({ where: { resolvedDate: { not: null } } });
    const withStateChange = await prisma.workItem.count({ where: { stateChangeDate: { not: null } } });

    console.log('CAMPOS DE DATA NOS WORK ITEMS');
    console.log('='.repeat(60));
    console.log(`Total WIs:        ${total}`);
    console.log(`activatedDate:    ${withActivated} (${Math.round(withActivated / total * 100)}%)`);
    console.log(`closedDate:       ${withClosed} (${Math.round(withClosed / total * 100)}%)`);
    console.log(`resolvedDate:     ${withResolved} (${Math.round(withResolved / total * 100)}%)`);
    console.log(`stateChangeDate:  ${withStateChange} (${Math.round(withStateChange / total * 100)}%)`);

    // 2. WIs em estado Done/Closed/Completed vs closedDate preenchido
    const doneItems = await prisma.workItem.count({
        where: { state: { in: ['Done', 'Closed', 'Completed'] } },
    });
    const doneWithClosed = await prisma.workItem.count({
        where: {
            state: { in: ['Done', 'Closed', 'Completed'] },
            closedDate: { not: null },
        },
    });
    const doneWithResolved = await prisma.workItem.count({
        where: {
            state: { in: ['Done', 'Closed', 'Completed'] },
            resolvedDate: { not: null },
        },
    });
    const doneWithStateChange = await prisma.workItem.count({
        where: {
            state: { in: ['Done', 'Closed', 'Completed'] },
            stateChangeDate: { not: null },
        },
    });

    console.log('');
    console.log('WIs EM ESTADO DONE/CLOSED/COMPLETED');
    console.log('='.repeat(60));
    console.log(`Total Done:              ${doneItems}`);
    console.log(`  com closedDate:        ${doneWithClosed}`);
    console.log(`  com resolvedDate:      ${doneWithResolved}`);
    console.log(`  com stateChangeDate:   ${doneWithStateChange}`);

    // 3. Amostra de WIs Done para ver quais campos estao preenchidos
    const samples = await prisma.workItem.findMany({
        where: { state: { in: ['Done', 'Closed', 'Completed'] } },
        take: 5,
        select: {
            id: true,
            title: true,
            state: true,
            type: true,
            activatedDate: true,
            closedDate: true,
            resolvedDate: true,
            stateChangeDate: true,
            changedDate: true,
            createdDate: true,
        },
    });

    console.log('');
    console.log('AMOSTRA DE WIs DONE (5 primeiros)');
    console.log('='.repeat(60));
    for (const s of samples) {
        console.log(`#${s.id} [${s.type}] "${s.title?.slice(0, 40)}"`);
        console.log(`  state:           ${s.state}`);
        console.log(`  createdDate:     ${s.createdDate?.toISOString().slice(0, 10) || 'NULL'}`);
        console.log(`  activatedDate:   ${s.activatedDate?.toISOString().slice(0, 10) || 'NULL'}`);
        console.log(`  closedDate:      ${s.closedDate?.toISOString().slice(0, 10) || 'NULL'}`);
        console.log(`  resolvedDate:    ${s.resolvedDate?.toISOString().slice(0, 10) || 'NULL'}`);
        console.log(`  stateChangeDate: ${s.stateChangeDate?.toISOString().slice(0, 10) || 'NULL'}`);
        console.log(`  changedDate:     ${s.changedDate?.toISOString().slice(0, 10) || 'NULL'}`);
        console.log('');
    }

    // 4. Distribuicao de estados
    const states = await prisma.workItem.groupBy({
        by: ['state'],
        _count: true,
        orderBy: { _count: { state: 'desc' } },
    });

    console.log('DISTRIBUICAO DE ESTADOS');
    console.log('='.repeat(60));
    for (const s of states) {
        console.log(`  ${s.state.padEnd(20)} ${s._count}`);
    }

    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
