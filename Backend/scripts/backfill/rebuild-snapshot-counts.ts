/**
 * rebuild-snapshot-counts.ts
 *
 * Reconstroi os contadores de estado (todoCount, inProgressCount, doneCount)
 * nos SprintSnapshots usando activatedDate e closedDate dos work items.
 *
 * Logica por dia da sprint:
 *   - Done:        closedDate != null AND closedDate <= dia
 *   - InProgress:  activatedDate != null AND activatedDate <= dia AND (closedDate == null OR closedDate > dia)
 *   - ToDo:        item nao esta Done nem InProgress naquele dia
 *
 * Modos:
 *   REBUILD_MODE=empty  (default) — so atualiza snapshots com todos os contadores = 0
 *   REBUILD_MODE=all    — recalcula todos os snapshots
 *
 * Filtro opcional:
 *   TARGET_SPRINTS=id1,id2  — limita a sprints especificas
 *
 * Uso: npx tsx scripts/backfill/rebuild-snapshot-counts.ts
 */
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

const REBUILD_MODE = (process.env.REBUILD_MODE || 'empty').toLowerCase();
const DRY_RUN = process.env.DRY_RUN === 'true';

function isPbiType(type?: string | null): boolean {
    const t = String(type || '').trim().toLowerCase();
    return t === 'product backlog item' || t === 'user story' || t === 'pbi';
}

function toUTCMidnight(d: Date): number {
    const dt = new Date(d);
    dt.setUTCHours(0, 0, 0, 0);
    return dt.getTime();
}

async function main() {
    console.log('REBUILD SNAPSHOT STATE COUNTS');
    console.log('='.repeat(60));
    console.log(`Mode: ${REBUILD_MODE} | DRY_RUN: ${DRY_RUN}`);
    console.log('');

    // 1. Buscar sprints com snapshots
    const targetIds = (process.env.TARGET_SPRINTS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    const sprintWhere: any = {};
    if (targetIds.length > 0) {
        sprintWhere.id = { in: targetIds };
    }

    const sprints = await prisma.sprint.findMany({
        where: sprintWhere,
        include: {
            project: { select: { name: true } },
        },
        orderBy: { startDate: 'asc' },
    });

    console.log(`Sprints encontradas: ${sprints.length}\n`);

    let totalUpdated = 0;
    let totalSkipped = 0;

    for (const sprint of sprints) {
        // 2. Buscar snapshots da sprint
        const snapshotWhere: any = { sprintId: sprint.id };
        if (REBUILD_MODE === 'empty') {
            snapshotWhere.todoCount = 0;
            snapshotWhere.inProgressCount = 0;
            snapshotWhere.doneCount = 0;
        }

        const snapshots = await prisma.sprintSnapshot.findMany({
            where: snapshotWhere,
            orderBy: { snapshotDate: 'asc' },
            select: {
                id: true,
                snapshotDate: true,
                todoCount: true,
                inProgressCount: true,
                doneCount: true,
            },
        });

        if (snapshots.length === 0) {
            console.log(`  ${sprint.project?.name} / ${sprint.name}: nenhum snapshot para atualizar`);
            totalSkipped++;
            continue;
        }

        // 3. Buscar work items da sprint com datas
        const workItems = await prisma.workItem.findMany({
            where: {
                sprintId: sprint.id,
                isRemoved: false,
            },
            select: {
                id: true,
                type: true,
                createdDate: true,
                activatedDate: true,
                closedDate: true,
                state: true,
            },
        });

        if (workItems.length === 0) {
            console.log(`  ${sprint.project?.name} / ${sprint.name}: 0 work items, pulando`);
            totalSkipped++;
            continue;
        }

        console.log(`  ${sprint.project?.name} / ${sprint.name}: ${snapshots.length} snapshots, ${workItems.length} WIs`);

        let sprintUpdated = 0;

        for (const snap of snapshots) {
            const dayTs = toUTCMidnight(snap.snapshotDate);
            // Fim do dia = proximo dia a meia-noite (itens fechados "no dia" contam como done)
            const dayEnd = dayTs + 24 * 60 * 60 * 1000;

            let todo = 0;
            let inProgress = 0;
            let done = 0;

            for (const item of workItems) {
                if (isPbiType(item.type)) continue; // Regra do CFD: desconsiderar PBI/User Story

                const closedTs = item.closedDate ? toUTCMidnight(item.closedDate) : null;
                const activatedTs = item.activatedDate ? toUTCMidnight(item.activatedDate) : null;

                if (closedTs !== null && closedTs < dayEnd) {
                    // Item foi fechado neste dia ou antes
                    done++;
                } else if (activatedTs !== null && activatedTs < dayEnd) {
                    // Item foi ativado neste dia ou antes, mas ainda nao fechado
                    inProgress++;
                } else {
                    // Item nao foi ativado ate este dia
                    todo++;
                }
            }

            if (!DRY_RUN) {
                await prisma.sprintSnapshot.update({
                    where: { id: snap.id },
                    data: { todoCount: todo, inProgressCount: inProgress, doneCount: done },
                });
            }
            sprintUpdated++;
        }

        // Mostrar primeiro e ultimo dia como amostra
        const firstSnap = snapshots[0];
        const lastSnap = snapshots[snapshots.length - 1];
        const firstDate = firstSnap.snapshotDate.toISOString().slice(0, 10);
        const lastDate = lastSnap.snapshotDate.toISOString().slice(0, 10);
        console.log(`    -> ${sprintUpdated} snapshots atualizados (${firstDate} a ${lastDate})`);

        totalUpdated += sprintUpdated;
    }

    console.log('\n' + '='.repeat(60));
    console.log(`RESULTADO:`);
    console.log(`  Snapshots atualizados: ${totalUpdated}`);
    console.log(`  Sprints puladas:       ${totalSkipped}`);
    console.log('='.repeat(60));

    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});
