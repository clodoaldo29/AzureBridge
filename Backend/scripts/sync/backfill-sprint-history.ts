import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { snapshotService } from '../../src/services/snapshot.service';
import { sprintHistoryService } from '../../src/services/sprint-history.service';

function printHeader(): void {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log('');
    console.log('==============================================');
    console.log('  BACKFILL HISTORICO DE SPRINTS');
    console.log(`  Inicio: ${now}`);
    console.log('==============================================');
}

function printFooter(durationMs: number, sprintsProcessed: number, historySummaries: number): void {
    const durationSec = Math.floor(durationMs / 1000);
    const min = Math.floor(durationSec / 60);
    const sec = durationSec % 60;
    const durationLabel = min > 0 ? `${min}min ${sec}s` : `${sec}s`;

    console.log('');
    console.log('==============================================');
    console.log('  BACKFILL CONCLUIDO');
    console.log(`  Duracao: ${durationLabel}`);
    console.log(`  Sprints processadas: ${sprintsProcessed}`);
    console.log(`  Resumos atualizados: ${historySummaries}`);
    console.log('==============================================');
    console.log('');
}

async function main(): Promise<void> {
    const startMs = Date.now();
    printHeader();
    const summaryOnly = ['true', '1', 'yes', 'sim'].includes(String(process.env.BACKFILL_SUMMARY_ONLY || '').trim().toLowerCase());
    const projectNameContains = String(process.env.BACKFILL_PROJECT_NAME_CONTAINS || '').trim();
    const sprintNameContains = String(process.env.BACKFILL_SPRINT_NAME_CONTAINS || '').trim();

    const prisma = new PrismaClient();
    await prisma.$connect();

    try {
        const sprints = await prisma.sprint.findMany({
            where: {
                ...(projectNameContains ? {
                    project: {
                        name: {
                            contains: projectNameContains,
                            mode: 'insensitive',
                        },
                    },
                } : {}),
                ...(sprintNameContains ? {
                    name: {
                        contains: sprintNameContains,
                        mode: 'insensitive',
                    },
                } : {}),
                OR: [
                    { state: { in: ['Past', 'Active'] } },
                    { timeFrame: { in: ['past', 'current'] } },
                ],
            },
            orderBy: [
                { projectId: 'asc' },
                { startDate: 'asc' },
            ],
            select: {
                id: true,
                name: true,
            },
        });

        console.log(`  ${sprints.length} sprint(s) encontradas para backfill`);

        let processed = 0;
        let summaries = 0;

        for (const sprint of sprints) {
            processed++;
            console.log(`  [${processed}/${sprints.length}] ${sprint.name}`);
            if (!summaryOnly) {
                await snapshotService.rebuildSprintHistorySnapshots(sprint.id);
            }
            const summary = await sprintHistoryService.refreshSprintSummary(sprint.id, prisma);
            if (summary) summaries++;
        }

        printFooter(Date.now() - startMs, processed, summaries);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: any) => {
    console.error(`\nBackfill falhou: ${error?.message || error}`);
    process.exit(1);
});
