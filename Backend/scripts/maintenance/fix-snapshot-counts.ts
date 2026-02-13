/**
 * fix-snapshot-counts.ts
 *
 * Corrige snapshots que têm todoCount/inProgressCount/doneCount todos em 0
 * mas possuem totalWork > 0 (criados pelo backfill-burndown que não populava contadores).
 *
 * Lógica:
 * - Para cada sprint, encontra o primeiro snapshot com contadores reais (total > 0).
 * - Snapshots anteriores com contadores zerados recebem:
 *     todoCount = total de itens do primeiro snapshot válido
 *     inProgressCount = 0, doneCount = 0
 *   (no início da sprint, todos os itens estão em "To Do")
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function main() {
    console.log('FIX SNAPSHOT STATE COUNTS');
    console.log('='.repeat(60));

    const sprints = await prisma.sprint.findMany({
        select: { id: true, name: true },
    });

    let totalFixed = 0;

    for (const sprint of sprints) {
        const snapshots = await prisma.sprintSnapshot.findMany({
            where: { sprintId: sprint.id },
            orderBy: { snapshotDate: 'asc' },
        });

        if (snapshots.length === 0) continue;

        // Encontrar o primeiro snapshot com contadores reais
        const firstValid = snapshots.find(
            s => (s.todoCount + s.inProgressCount + s.doneCount) > 0,
        );

        if (!firstValid) {
            console.log(`  ${sprint.name}: sem snapshots com contadores validos, pulando`);
            continue;
        }

        const totalItems = firstValid.todoCount + firstValid.inProgressCount + firstValid.doneCount;

        // Corrigir snapshots anteriores ao primeiro válido que têm contadores zerados
        const toFix = snapshots.filter(s => {
            const stateTotal = s.todoCount + s.inProgressCount + s.doneCount;
            return stateTotal === 0 && s.snapshotDate < firstValid.snapshotDate;
        });

        if (toFix.length === 0) {
            console.log(`  ${sprint.name}: OK (sem snapshots para corrigir)`);
            continue;
        }

        for (const snap of toFix) {
            await prisma.sprintSnapshot.update({
                where: { id: snap.id },
                data: {
                    todoCount: totalItems,
                    inProgressCount: 0,
                    doneCount: 0,
                    blockedCount: 0,
                },
            });
        }

        const dates = toFix.map(s => s.snapshotDate.toISOString().slice(0, 10)).join(', ');
        console.log(`  ${sprint.name}: corrigidos ${toFix.length} snapshots (${dates}) -> todoCount=${totalItems}`);
        totalFixed += toFix.length;
    }

    console.log('');
    console.log(`Total corrigido: ${totalFixed} snapshots`);
    console.log('='.repeat(60));

    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});
