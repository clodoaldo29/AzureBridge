/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║           FIX CAPACITY — Re-sync forçado de capacidade       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Script one-shot para restaurar registros de TeamCapacity corrompidos.
 *
 * Problema resolvido:
 *   O código antigo (commit 4642112) sempre re-sincronizava a capacidade
 *   de sprints passados usando apenas teams[0], e deletava membros não
 *   retornados pelo Azure. Isso corrompeu sprints que tinham capacidade
 *   configurada para múltiplos sub-times.
 *
 * O que este script faz:
 *   - Consulta TODOS os times de cada projeto no Azure DevOps
 *   - Para cada sprint (past + active): faz UPSERT de todos os membros
 *     encontrados em qualquer time (aditivo — nunca deleta registros)
 *   - Recalcula teamCapacityHours de cada sprint afetado
 *   - Imprime um relatório com sprints corrigidos vs. sem alteração
 *
 * Execução:
 *   npx tsx scripts/sync/fix-capacity.ts
 *
 * Variáveis de ambiente:
 *   DRY_RUN=true  → simula sem gravar nada no banco
 */

import { PrismaClient } from '@prisma/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';
import { capacityService } from '../../src/services/capacity.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBusinessDaysCount(startDate: Date, endDate: Date): number {
    let count = 0;
    const cur = new Date(startDate);
    while (cur <= endDate) {
        const day = cur.getUTCDay();
        if (day !== 0 && day !== 6) count++;
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return count;
}

function mergeDayOffRanges(memberDaysOff: any[], teamDaysOff: any[]): any[] {
    const merged = [...(memberDaysOff || []), ...(teamDaysOff || [])];
    const seen = new Set<string>();
    return merged.filter(r => {
        if (!r?.start || !r?.end) return false;
        const key = `${new Date(r.start).toISOString()}|${new Date(r.end).toISOString()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function log(msg: string) { console.log(msg); }
function ok(msg: string) { console.log(`  ✅  ${msg}`); }
function warn(msg: string) { console.log(`  ⚠️   ${msg}`); }
function step(msg: string) { console.log(`  │   ${msg}`); }

// ─── Core: re-sync de capacidade para um sprint consultando todos os times ────

async function fixCapacityForSprint(
    coreApi: any,
    workApi: any,
    prisma: PrismaClient,
    sprint: any,
    dryRun: boolean
): Promise<{ synced: number; skipped: number }> {
    const teams = await coreApi.getTeams(sprint.project.azureId);
    if (!teams?.length) return { synced: 0, skipped: 0 };

    const sprintStart = new Date(sprint.startDate!);
    const sprintEnd = new Date(sprint.endDate!);
    const totalSprintDays = getBusinessDaysCount(sprintStart, sprintEnd);

    let synced = 0;
    let skipped = 0;

    for (const team of teams) {
        const teamContext = {
            project: sprint.project.name,
            projectId: sprint.project.azureId,
            team: team.name,
            teamId: team.id
        };

        let capacityData: any;
        try {
            capacityData = await workApi.getCapacitiesWithIdentityRefAndTotals(teamContext, sprint.azureId);
        } catch { continue; }

        if (!capacityData?.teamMembers?.length) continue;

        let teamDaysOff: any[] = [];
        try {
            const teamDaysOffData = await workApi.getTeamDaysOff(teamContext, sprint.azureId);
            teamDaysOff = teamDaysOffData?.daysOff || [];
        } catch { /* ignora */ }

        let teamDaysOffCount = 0;
        for (const d of teamDaysOff) {
            const start = new Date(d.start);
            const end = new Date(d.end);
            for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                if (dt >= sprintStart && dt <= sprintEnd) {
                    const dow = dt.getUTCDay();
                    if (dow !== 0 && dow !== 6) teamDaysOffCount++;
                }
            }
        }
        const netSprintDays = Math.max(0, totalSprintDays - teamDaysOffCount);

        for (const cap of capacityData.teamMembers) {
            if (!cap.teamMember?.id) { skipped++; continue; }

            const capacityPerDay = (cap.activities || []).reduce(
                (acc: number, act: any) => acc + Number(act.capacityPerDay || 0), 0
            );

            let individualDaysOff = 0;
            for (const d of (cap.daysOff || [])) {
                const start = new Date(d.start);
                const end = new Date(d.end);
                for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                    if (dt >= sprintStart && dt <= sprintEnd) {
                        const dow = dt.getUTCDay();
                        if (dow !== 0 && dow !== 6) individualDaysOff++;
                    }
                }
            }

            const availableDays = Math.max(0, netSprintDays - individualDaysOff);
            const totalHours = capacityPerDay * netSprintDays;
            const availableHours = capacityPerDay * availableDays;
            const mergedDaysOff = mergeDayOffRanges(cap.daysOff || [], teamDaysOff);

            if (dryRun) {
                step(`      [DRY-RUN] ${cap.teamMember.displayName} — ${availableHours}h disponíveis`);
                synced++;
                continue;
            }

            const existingMember = await prisma.teamMember.findFirst({
                where: { azureId: cap.teamMember.id, projectId: sprint.projectId }
            });

            let member: any;
            if (existingMember) {
                member = await prisma.teamMember.update({
                    where: { id: existingMember.id },
                    data: { displayName: cap.teamMember.displayName, imageUrl: cap.teamMember.imageUrl }
                });
            } else {
                member = await prisma.teamMember.create({
                    data: {
                        azureId: cap.teamMember.id,
                        displayName: cap.teamMember.displayName,
                        uniqueName: cap.teamMember.uniqueName || cap.teamMember.displayName,
                        imageUrl: cap.teamMember.imageUrl,
                        projectId: sprint.projectId
                    }
                });
            }

            await prisma.teamCapacity.upsert({
                where: { memberId_sprintId: { memberId: member.id, sprintId: sprint.id } },
                create: {
                    memberId: member.id,
                    sprintId: sprint.id,
                    totalHours,
                    availableHours,
                    allocatedHours: 0,
                    completedHours: 0,
                    daysOff: mergedDaysOff,
                    activitiesPerDay: cap.activities || []
                },
                update: {
                    totalHours,
                    availableHours,
                    daysOff: mergedDaysOff,
                    activitiesPerDay: cap.activities || []
                }
            });

            synced++;
        }
    }

    if (!dryRun && synced > 0) {
        await capacityService.recalculateSprintCapacitySnapshot(sprint.id, prisma);
    }

    return { synced, skipped };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const dryRun = ['true', '1', 'yes'].includes(String(process.env.DRY_RUN || '').toLowerCase());

    log('');
    log('╔══════════════════════════════════════════════════════════════╗');
    log('║       🔧  FIX CAPACITY — Re-sync forçado de capacidade       ║');
    log('╠══════════════════════════════════════════════════════════════╣');
    log(`║  Modo: ${dryRun ? 'DRY-RUN (sem gravação)'.padEnd(55) : 'PRODUÇÃO (gravando no banco)'.padEnd(55)}║`);
    log('╚══════════════════════════════════════════════════════════════╝');
    log('');

    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL!;
    const pat = process.env.AZURE_DEVOPS_PAT!;

    if (!orgUrl || !pat) {
        console.error('❌ AZURE_DEVOPS_ORG_URL e AZURE_DEVOPS_PAT são obrigatórios');
        process.exit(1);
    }

    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const coreApi = await connection.getCoreApi();
    const workApi = await connection.getWorkApi();
    const prisma = new PrismaClient();

    try {
        const sprints = await prisma.sprint.findMany({
            where: { timeFrame: { in: ['past', 'current'] } },
            include: { project: true },
            orderBy: [{ project: { name: 'asc' } }, { startDate: 'asc' }]
        });

        log(`  ${sprints.length} sprint(s) encontrado(s) para processar\n`);

        let totalFixed = 0;
        let totalUnchanged = 0;
        let totalErrors = 0;

        const report: Array<{ sprint: string; before: number; after: number; added: number }> = [];

        for (let i = 0; i < sprints.length; i++) {
            const sprint = sprints[i];
            const label = `${sprint.project.name} / ${sprint.name}`;

            const beforeCount = await prisma.teamCapacity.count({ where: { sprintId: sprint.id } });

            step(`[${i + 1}/${sprints.length}] ${label}`);
            step(`    Antes: ${beforeCount} registro(s)`);

            try {
                const { synced } = await fixCapacityForSprint(coreApi, workApi, prisma, sprint, dryRun);

                const afterCount = dryRun
                    ? beforeCount
                    : await prisma.teamCapacity.count({ where: { sprintId: sprint.id } });

                const added = afterCount - beforeCount;

                step(`    Depois: ${afterCount} registro(s) | Azure retornou: ${synced} | adicionados: ${added}`);

                if (added > 0) {
                    totalFixed++;
                    report.push({ sprint: label, before: beforeCount, after: afterCount, added });
                } else {
                    totalUnchanged++;
                }
            } catch (err: any) {
                warn(`    ❌ Erro: ${err.message}`);
                totalErrors++;
            }

            log('');
        }

        log('╔══════════════════════════════════════════════════════════════╗');
        log('║  📊  Relatório Final                                          ║');
        log('╠══════════════════════════════════════════════════════════════╣');
        log(`║  Sprints corrigidos : ${String(totalFixed).padEnd(40)}║`);
        log(`║  Sem alteração      : ${String(totalUnchanged).padEnd(40)}║`);
        log(`║  Erros              : ${String(totalErrors).padEnd(40)}║`);
        log('╠══════════════════════════════════════════════════════════════╣');

        if (report.length > 0) {
            log('║  Sprints com membros adicionados:                             ║');
            for (const r of report) {
                const line = `  +${r.added} | ${r.sprint}`.substring(0, 61);
                log(`║  ${line.padEnd(61)}║`);
            }
        } else {
            log('║  Nenhum membro adicionado.                                    ║');
            log('║  Possíveis causas:                                            ║');
            log('║  • Azure não retorna capacidade histórica para esses sprints  ║');
            log('║  • Membros já estavam corretamente sincronizados              ║');
        }

        log('╚══════════════════════════════════════════════════════════════╝');

        if (dryRun) {
            log('\n  ⚠️  DRY-RUN: nenhuma alteração foi gravada no banco.');
            log('  Execute sem DRY_RUN=true para aplicar as correções.\n');
        } else {
            log('\n  ✅  Concluído. Execute a verificação abaixo para confirmar:');
            log('  SELECT s.name, p.name, COUNT(tc.id) FROM team_capacities tc');
            log('  JOIN sprints s ON tc."sprintId" = s.id');
            log('  JOIN projects p ON s."projectId" = p.id GROUP BY s.id, s.name, p.name;\n');
        }

    } finally {
        await prisma.$disconnect();
    }
}

main().catch(err => {
    console.error('❌ Falha fatal:', err);
    process.exit(1);
});
