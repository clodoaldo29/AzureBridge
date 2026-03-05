/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║               SYNC DIÁRIO — AzureBridge                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Execução: 1x por dia (ex: 06:00 via cron ou Docker schedule)
 * Comando:  npx tsx scripts/sync-daily.ts
 *
 * O que este script faz — MODO INICIAL (banco vazio ou FULL_SYNC=true):
 *
 *   FASE 1 — Projetos & Sprints
 *     Busca todos os projetos e sprints do Azure DevOps e os upserta
 *     no banco. Define timeFrame (current/future/past) por janela de datas.
 *
 *   FASE 2 — Times & Membros
 *     Para cada projeto, busca todos os times e seus membros.
 *     Upserta TeamMember para cada membro encontrado.
 *
 *   FASE 3 — Capacidade
 *     Para cada sprint atual ou futura, busca a capacidade de cada membro
 *     (horas/dia, dias de folga) e salva em TeamCapacity.
 *
 *   FASE 4 — Carga massiva de Work Items
 *     Para cada sprint de todos os projetos: executa WiQL sem filtro de data
 *     para buscar TODOS os work items. Insere com todos os campos necessários
 *     para o gerenciamento de sprints.
 *
 *   FASE 5 — Backfill de histórico de horas
 *     Para work items com initialRemainingWork/lastRemainingWork faltando,
 *     busca revisões do Azure e reconstrói o histórico de horas.
 *
 *   FASE 6 — Backfill de datas de fechamento
 *     Para work items Done/Closed com closedDate nulo, busca revisões
 *     e extrai a data exata da primeira transição para estado Done.
 *
 *   FASE 7 — Wiki Sync
 *     Sincroniza páginas da Wiki de todos os projetos (modo full na carga inicial).
 *
 *   FASE 8 — Pipeline Central
 *     Executa sync-core.ts: Smart Sync + Reconcile + Rebuild Burndown.
 *
 * O que este script faz — MODO INCREMENTAL (execuções subsequentes):
 *
 *   FASE 1 — Atualiza Projetos & Sprints
 *     Refaz upsert de projetos e sprints para capturar novos, atualizar
 *     timeFrame e estados (ex: sprint que passou de Future para Active).
 *
 *   FASE 2 — Atualiza Times & Membros
 *     Refaz upsert de membros de todos os times.
 *
 *   FASE 3 — Atualiza Capacidade
 *     Refaz sync de capacidade apenas para sprints current/future.
 *
 *   FASE 4 — Wiki Sync
 *     Sincroniza páginas da Wiki de todos os projetos (modo incremental).
 *
 *   FASE 5 — Backfill de Sprints Passadas Novas
 *     Detecta sprints Past sem work items no banco (ex: novo projeto incorporado).
 *     Importa todos os items históricos + backfill de revisões e closedDate.
 *     Os IDs são encaminhados ao Pipeline Central para rebuild do burndown.
 *
 *   FASE 6 — Pipeline Central
 *     Executa sync-core.ts: Smart Sync + Reconcile + Rebuild Burndown.
 *
 * Detecção automática de modo:
 *   - Se o banco não tiver work items → MODO INICIAL
 *   - Se FULL_SYNC=true no .env → força MODO INICIAL
 *   - Caso contrário → MODO INCREMENTAL
 */

import { PrismaClient } from '@prisma/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';
import { runCorePipeline, CorePipelineResult } from './sync-core';

// ─── Configuração de projetos alvo ────────────────────────────────────────────
//
// Define quais projetos e sprints serão sincronizados.
// nameContains: substring do nome do projeto (case-insensitive)
// sprintNameContains: se definido, só sincroniza sprints cujo nome contenha
//                     esta substring (case-insensitive). Aplica-se a TODAS as
//                     sprints (past, current, future).
//
interface ProjectConfig {
    nameContains: string;
    sprintNameContains?: string;
}

const TARGET_PROJECT_CONFIGS: ProjectConfig[] = [
    { nameContains: 'Retrabalho' },
    { nameContains: 'Plataforma de Melhoria' },
    { nameContains: 'Tempos e Movimentos', sprintNameContains: 'AV-NAV' },
];

function isTargetProject(projectName: string): boolean {
    const lower = projectName.toLowerCase();
    return TARGET_PROJECT_CONFIGS.some(c => lower.includes(c.nameContains.toLowerCase()));
}

function getProjectConfig(projectName: string): ProjectConfig | undefined {
    const lower = projectName.toLowerCase();
    return TARGET_PROJECT_CONFIGS.find(c => lower.includes(c.nameContains.toLowerCase()));
}

function isTargetSprint(projectName: string, sprintName: string): boolean {
    const config = getProjectConfig(projectName);
    if (!config) return false;
    if (!config.sprintNameContains) return true;
    return sprintName.toLowerCase().includes(config.sprintNameContains.toLowerCase());
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface WikiSyncStats {
    projects: number;
    pagesFound: number;
    created: number;
    updated: number;
    unchanged: number;
    failed: number;
    skipped: number;
}

interface BackfillPastStats {
    sprintsFound: number;
    sprintsProcessed: number;
    itemsLoaded: number;
    sprintIds: string[];
}

interface DailyStats {
    mode: 'initial' | 'incremental';
    projects: number;
    sprints: number;
    teamMembers: number;
    capacities: number;
    workItemsSynced: number;
    backfillHistory: number;
    backfillClosedDates: number;
    wikiSync: WikiSyncStats | null;
    backfillPast: BackfillPastStats | null;
    corePipeline: CorePipelineResult | null;
    durationMs: number;
    hasErrors: boolean;
}

// ─── Utilitários de display ────────────────────────────────────────────────────

function printHeader(mode: 'initial' | 'incremental'): void {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const modeLabel = mode === 'initial'
        ? '🚀  CARGA INICIAL — Primeira sincronização completa'
        : '🔄  SYNC DIÁRIO — Atualização estrutural incremental';

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║          📅  SYNC DIÁRIO — AzureBridge Dashboard            ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  ${modeLabel.padEnd(61)}║`);
    console.log(`║  ⏰  Início: ${now.padEnd(49)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
}

function printPhaseHeader(num: number, title: string): void {
    const label = `FASE ${num}: ${title}`;
    console.log(`\n┌${'─'.repeat(62)}`);
    console.log(`│  ${label}`);
    console.log(`└${'─'.repeat(62)}`);
}

function ok(msg: string): void { console.log(`  ✅  ${msg}`); }
function warn(msg: string): void { console.log(`  ⚠️   ${msg}`); }
function info(msg: string): void { console.log(`  ℹ️   ${msg}`); }
function step(msg: string): void { console.log(`  │   ${msg}`); }

function printFooter(stats: DailyStats): void {
    const durationSec = Math.floor(stats.durationMs / 1000);
    const min = Math.floor(durationSec / 60);
    const sec = durationSec % 60;
    const durationLabel = min > 0 ? `${min}min ${sec}s` : `${sec}s`;
    const status = stats.hasErrors ? '⚠️  CONCLUÍDO COM AVISOS' : '✅  CONCLUÍDO COM SUCESSO';

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log(`║  ${status.padEnd(61)}║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  ⏱  Duração total: ${durationLabel.padEnd(43)}║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  📊  Resumo:                                                  ║');
    console.log(`║      Modo             : ${stats.mode === 'initial' ? 'Carga Inicial' : 'Incremental'}`.padEnd(64) + '║');
    console.log(`║      Projetos         : ${stats.projects}`.padEnd(64) + '║');
    console.log(`║      Sprints          : ${stats.sprints}`.padEnd(64) + '║');
    console.log(`║      Membros de time  : ${stats.teamMembers}`.padEnd(64) + '║');
    console.log(`║      Capacidades      : ${stats.capacities}`.padEnd(64) + '║');

    if (stats.mode === 'initial') {
        console.log(`║      Work Items        : ${stats.workItemsSynced}`.padEnd(64) + '║');
        console.log(`║      Backfill histórico: ${stats.backfillHistory}`.padEnd(64) + '║');
        console.log(`║      Backfill closedDate: ${stats.backfillClosedDates}`.padEnd(64) + '║');
    }

    if (stats.wikiSync) {
        const w = stats.wikiSync;
        console.log('╠══════════════════════════════════════════════════════════════╣');
        console.log('║  📄  Wiki Sync:                                               ║');
        console.log(`║      Projetos sincronizados: ${w.projects - w.skipped}/${w.projects}`.padEnd(64) + '║');
        console.log(`║      Páginas encontradas   : ${w.pagesFound}`.padEnd(64) + '║');
        console.log(`║      Criadas               : ${w.created}`.padEnd(64) + '║');
        console.log(`║      Atualizadas           : ${w.updated}`.padEnd(64) + '║');
        console.log(`║      Sem alteração         : ${w.unchanged}`.padEnd(64) + '║');
        if (w.failed > 0) {
            console.log(`║      ⚠️  Falhas              : ${w.failed}`.padEnd(64) + '║');
        }
    }

    if (stats.backfillPast && stats.backfillPast.sprintsFound > 0) {
        const b = stats.backfillPast;
        console.log('╠══════════════════════════════════════════════════════════════╣');
        console.log('║  📦  Backfill Sprints Passadas:                               ║');
        console.log(`║      Sprints detectadas    : ${b.sprintsFound}`.padEnd(64) + '║');
        console.log(`║      Sprints processadas   : ${b.sprintsProcessed}`.padEnd(64) + '║');
        console.log(`║      Work items carregados : ${b.itemsLoaded}`.padEnd(64) + '║');
    }

    if (stats.corePipeline) {
        const cp = stats.corePipeline;
        console.log('╠══════════════════════════════════════════════════════════════╣');
        console.log('║  🔄  Pipeline Central (Smart Sync + Reconcile + Burndown):   ║');
        console.log(`║      WI avaliados           : ${cp.phase1.evaluated}`.padEnd(64) + '║');
        console.log(`║      WI atualizados         : ${cp.phase1.basicUpdated}`.padEnd(64) + '║');
        console.log(`║      Sprints (reconcile)    : ${cp.phase2.sprintsProcessed}`.padEnd(64) + '║');
        console.log(`║      Sprints (burndown)     : ${cp.phase3.sprintsRebuilt}`.padEnd(64) + '║');
        console.log(`║      Snapshots criados      : ${cp.phase3.snapshotsCreated}`.padEnd(64) + '║');
        console.log(`║      Outcomes criados       : ${cp.phase3.outcomesCreated}`.padEnd(64) + '║');
    }

    if (stats.hasErrors) {
        console.log('╠══════════════════════════════════════════════════════════════╣');
        console.log('║  ⚠️   Alguns passos tiveram erros — verifique os logs acima   ║');
    }

    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
}

// ─── Helpers de data (reutilizados do sync-all-projects.js) ──────────────────

function toDate(value: any): Date | null {
    if (!value) return null;
    const dt = new Date(value);
    return isNaN(dt.getTime()) ? null : dt;
}

function toUtcStartOfDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function toUtcEndOfDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function mapTimeFrameByDateWindow(startDate: Date, endDate: Date, now = new Date()): string {
    const start = toUtcStartOfDay(startDate);
    const end = toUtcEndOfDay(endDate);
    if (now >= start && now <= end) return 'current';
    if (now < start) return 'future';
    return 'past';
}

function resolveSprintState(timeFrame: string): string {
    if (timeFrame === 'current') return 'Active';
    if (timeFrame === 'future') return 'Future';
    return 'Past';
}

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

// ─── FASE 1: Sync Projetos & Sprints ─────────────────────────────────────────

async function syncProjectsAndSprints(
    coreApi: any,
    witApi: any,
    prisma: PrismaClient
): Promise<{ projects: number; sprints: number }> {
    const azureProjects = await coreApi.getProjects();
    if (!azureProjects || azureProjects.length === 0) {
        warn('Nenhum projeto encontrado no Azure DevOps');
        return { projects: 0, sprints: 0 };
    }

    const targetAzProjects = azureProjects.filter(p => isTargetProject(p.name));
    step(`${azureProjects.length} projeto(s) no Azure DevOps | ${targetAzProjects.length} alvo(s) conforme filtro`);

    if (targetAzProjects.length === 0) {
        warn('Nenhum projeto corresponde ao filtro TARGET_PROJECT_CONFIGS');
        return { projects: 0, sprints: 0 };
    }

    let totalProjects = 0;
    let totalSprints = 0;
    const now = new Date();

    for (const azProject of targetAzProjects) {
        step(`Sincronizando: ${azProject.name}`);

        // Upserta o projeto
        const dbProject = await prisma.project.upsert({
            where: { azureId: azProject.id },
            create: {
                azureId: azProject.id,
                name: azProject.name,
                description: azProject.description || null,
                state: azProject.state || 'wellFormed',
                visibility: azProject.visibility === 'private' ? 0 : 1
            },
            update: {
                name: azProject.name,
                description: azProject.description || null,
                state: azProject.state || 'wellFormed',
                visibility: azProject.visibility === 'private' ? 0 : 1
            }
        });

        totalProjects++;

        // Busca árvore de iterações (sprints) com profundidade 4
        let iterationNode: any;
        try {
            iterationNode = await witApi.getClassificationNode(azProject.name, 1, undefined, 4);
        } catch {
            continue;
        }

        if (!iterationNode?.children?.length) continue;

        // Extrai todas as iterações recursivamente
        const sprints: any[] = [];

        const extractIterations = (node: any, parentPath = azProject.name): void => {
            if (!node) return;
            const nodePath = `${parentPath}\\${node.name}`;

            if (node.attributes) {
                const startDate = toDate(node.attributes.startDate);
                const endDate = toDate(node.attributes.finishDate);
                if (startDate && endDate && isTargetSprint(azProject.name, node.name)) {
                    const timeFrame = mapTimeFrameByDateWindow(startDate, endDate, now);
                    const state = resolveSprintState(timeFrame);
                    sprints.push({
                        id: node.identifier || node.id?.toString(),
                        name: node.name,
                        path: nodePath,
                        startDate,
                        endDate,
                        timeFrame,
                        state
                    });
                }
            }

            if (node.children?.length > 0) {
                node.children.forEach((child: any) => extractIterations(child, nodePath));
            }
        };

        iterationNode.children.forEach((child: any) => extractIterations(child, azProject.name));

        // Upserta cada sprint
        for (const sprint of sprints) {
            await prisma.sprint.upsert({
                where: { azureId: sprint.id },
                create: {
                    azureId: sprint.id,
                    name: sprint.name,
                    path: sprint.path,
                    startDate: sprint.startDate,
                    endDate: sprint.endDate,
                    state: sprint.state,
                    timeFrame: sprint.timeFrame,
                    projectId: dbProject.id
                },
                update: {
                    name: sprint.name,
                    path: sprint.path,
                    startDate: sprint.startDate,
                    endDate: sprint.endDate,
                    state: sprint.state,
                    timeFrame: sprint.timeFrame,
                    projectId: dbProject.id
                }
            });
        }

        step(`  ✅ ${azProject.name} — ${sprints.length} sprint(s) upsertadas`);
        totalSprints += sprints.length;
    }

    return { projects: totalProjects, sprints: totalSprints };
}

// ─── FASE 2: Sync Times & Membros ─────────────────────────────────────────────

async function syncTeamMembers(
    coreApi: any,
    prisma: PrismaClient
): Promise<number> {
    const azureProjects = await coreApi.getProjects();
    let totalMembers = 0;

    for (const azProject of azureProjects) {
        if (!isTargetProject(azProject.name)) continue;

        const dbProject = await prisma.project.findFirst({
            where: { azureId: azProject.id }
        });
        if (!dbProject) continue;

        let teams: any[];
        try {
            teams = await coreApi.getTeams(azProject.id);
        } catch { continue; }

        if (!teams?.length) continue;

        const seen = new Set<string>();

        for (const team of teams) {
            let members: any[];
            try {
                members = await coreApi.getTeamMembersWithExtendedProperties(azProject.id, team.id);
            } catch { continue; }

            for (const m of (members || [])) {
                const azureId = m.identity?.id || m.identity?.uniqueName;
                if (!azureId || seen.has(azureId)) continue;
                seen.add(azureId);

                await prisma.teamMember.upsert({
                    where: { azureId_projectId: { azureId, projectId: dbProject.id } },
                    create: {
                        azureId,
                        displayName: m.identity?.displayName || m.identity?.uniqueName || 'Unknown',
                        uniqueName: m.identity?.uniqueName || m.identity?.displayName || 'Unknown',
                        imageUrl: m.identity?.imageUrl || null,
                        projectId: dbProject.id
                    },
                    update: {
                        displayName: m.identity?.displayName || m.identity?.uniqueName || 'Unknown',
                        imageUrl: m.identity?.imageUrl || null
                    }
                });
                totalMembers++;
            }
        }

        step(`  ✅ ${azProject.name} — ${seen.size} membro(s) únicos`);
    }

    return totalMembers;
}

// ─── FASE 3: Sync Capacidade ──────────────────────────────────────────────────

async function syncCapacity(
    coreApi: any,
    workApi: any,
    prisma: PrismaClient,
    onlyCurrentFuture = true
): Promise<number> {
    // Busca sprints alvo
    let targetSprints = await prisma.sprint.findMany({
        where: onlyCurrentFuture
            ? { timeFrame: { in: ['current', 'future'] } }
            : {},
        include: { project: true }
    });

    if (targetSprints.length === 0) {
        // Fallback: 5 sprints mais recentes
        targetSprints = await prisma.sprint.findMany({
            take: 5,
            orderBy: { endDate: 'desc' },
            include: { project: true }
        });
    }

    if (targetSprints.length === 0) {
        info('Nenhuma sprint encontrada para sync de capacidade');
        return 0;
    }

    step(`${targetSprints.length} sprint(s) para sync de capacidade`);

    let totalSynced = 0;

    let sprintCapIdx = 0;
    for (const sprint of targetSprints) {
        sprintCapIdx++;
        step(`[${sprintCapIdx}/${targetSprints.length}] ${(sprint as any).project.name} / ${sprint.name}`);
        const synced = await syncCapacityForSprint(coreApi, workApi, prisma, sprint);
        if (synced > 0) {
            step(`  ✅ ${synced} membro(s) sincronizados`);
        } else {
            step(`  ─ sem dados de capacidade retornados`);
        }
        totalSynced += synced;
    }

    return totalSynced;
}

// ─── Helper: Sync de capacidade para uma sprint específica ────────────────────

async function syncCapacityForSprint(
    coreApi: any,
    workApi: any,
    prisma: PrismaClient,
    sprint: any
): Promise<number> {
    try {
        const teams = await coreApi.getTeams(sprint.project.azureId);
        if (!teams?.length) return 0;

        const team = teams[0];
        const teamContext = {
            project: sprint.project.name,
            projectId: sprint.project.azureId,
            team: team.name,
            teamId: team.id
        };

        let capacityData: any;
        try {
            capacityData = await workApi.getCapacitiesWithIdentityRefAndTotals(teamContext, sprint.azureId);
        } catch { return 0; }

        let teamDaysOff: any[] = [];
        try {
            const teamDaysOffData = await workApi.getTeamDaysOff(teamContext, sprint.azureId);
            teamDaysOff = teamDaysOffData?.daysOff || [];
        } catch { /* ignora */ }

        if (!capacityData?.teamMembers) return 0;

        const sprintStart = new Date(sprint.startDate!);
        const sprintEnd = new Date(sprint.endDate!);
        const totalSprintDays = getBusinessDaysCount(sprintStart, sprintEnd);

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

        let totalSynced = 0;
        for (const cap of capacityData.teamMembers) {
            if (!cap.teamMember?.id) continue;

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

            const capacityPerDay = (cap.activities || []).reduce(
                (acc: number, act: any) => acc + (act.capacityPerDay || 0), 0
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

            await prisma.teamCapacity.upsert({
                where: { memberId_sprintId: { memberId: member.id, sprintId: sprint.id } },
                create: {
                    memberId: member.id,
                    sprintId: sprint.id,
                    totalHours,
                    availableHours,
                    allocatedHours: 0,
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

            totalSynced++;
        }

        return totalSynced;
    } catch {
        return 0;
    }
}

// ─── FASE 4: Carga massiva de Work Items (só no modo inicial) ─────────────────

/**
 * Resolve o ID interno do membro atribuído a um work item.
 * Cria o membro no banco se não existir (upsert seguro).
 */
async function resolveAssignedTo(assignedRaw: any, projectId: string, prisma: PrismaClient): Promise<string | null> {
    if (!assignedRaw) return null;
    if (typeof assignedRaw !== 'object') return null;

    const uniqueName = assignedRaw.uniqueName ? String(assignedRaw.uniqueName) : null;
    const displayName = assignedRaw.displayName ? String(assignedRaw.displayName) : (uniqueName || 'Unknown');
    const azureIdentityId = assignedRaw.id ? String(assignedRaw.id) : (uniqueName || null);

    if (!azureIdentityId) return null;

    const member = await prisma.teamMember.upsert({
        where: { azureId_projectId: { azureId: azureIdentityId, projectId } },
        create: {
            azureId: azureIdentityId,
            displayName,
            uniqueName: uniqueName || displayName,
            imageUrl: assignedRaw.imageUrl || null,
            projectId
        },
        update: {
            displayName,
            uniqueName: uniqueName || displayName,
            imageUrl: assignedRaw.imageUrl || null
        }
    });

    return member.id;
}

async function massiveWorkItemsSync(witApi: any, prisma: PrismaClient): Promise<number> {
    // Busca todos os projetos e sprints do banco
    const sprints = await prisma.sprint.findMany({
        include: { project: true }
    });

    if (!sprints.length) {
        warn('Nenhuma sprint no banco para carga massiva. Execute a Fase 1 primeiro.');
        return 0;
    }

    step(`${sprints.length} sprint(s) para carga massiva de work items`);

    let totalSynced = 0;
    let sprintCount = 0;

    for (const sprint of sprints) {
        sprintCount++;
        step(`[${sprintCount}/${sprints.length}] ${(sprint as any).project.name} / ${sprint.name}`);

        try {
            // WiQL sem filtro de data = busca TODOS os itens da sprint
            const wiql = {
                query: `
                    SELECT [System.Id]
                    FROM WorkItems
                    WHERE [System.IterationPath] UNDER '${sprint.path}'
                    AND [System.WorkItemType] IN ('Product Backlog Item', 'Bug', 'Task', 'Feature', 'User Story', 'Epic')
                    ORDER BY [System.Id]
                `
            };

            const result = await witApi.queryByWiql(wiql, { project: (sprint as any).project.name });
            const ids = result.workItems
                ?.map((wi: any) => wi.id)
                .filter((id: any): id is number => typeof id === 'number') || [];

            if (!ids.length) {
                step(`  ─ nenhum item encontrado no Azure`);
                continue;
            }

            step(`  ↳ ${ids.length} item(s) encontrado(s) — importando em lotes de 100...`);
            const totalBatchesMassive = Math.ceil(ids.length / 100);
            let sprintSynced = 0;

            // Processa em lotes de 100
            for (let i = 0; i < ids.length; i += 100) {
                const batchNum = Math.floor(i / 100) + 1;
                const batchIds = ids.slice(i, i + 100);
                const batchStart = i + 1;
                const batchEnd = Math.min(i + batchIds.length, ids.length);
                step(`    [lote ${batchNum}/${totalBatchesMassive}] buscando items ${batchStart}–${batchEnd}...`);

                const items = await witApi.getWorkItems(batchIds);
                let batchSaved = 0;

                for (const item of (items || [])) {
                    if (!item?.id) continue;
                    const f = item.fields;
                    const d = (v: any) => v ? new Date(v) : null;

                    const assignedToId = await resolveAssignedTo(
                        f['System.AssignedTo'],
                        (sprint as any).projectId,
                        prisma
                    );

                    const stateLower = String(f['System.State'] || '').trim().toLowerCase();
                    const isDone = stateLower === 'done' || stateLower === 'closed' || stateLower === 'completed';

                    const tagsRaw = String(f['System.Tags'] || '').toLowerCase();
                    const boardColumn = String(f['System.BoardColumn'] || '').trim().toLowerCase();
                    const blockedFieldRaw = f['Microsoft.VSTS.Common.Blocked'];
                    const blockedField = ['true', 'yes', 'sim', '1'].includes(
                        String(blockedFieldRaw || '').trim().toLowerCase()
                    );
                    const isBlocked = blockedField ||
                        ['blocked', 'impeded', 'impedido'].includes(stateLower) ||
                        boardColumn === 'blocked' || boardColumn.includes('imped') ||
                        tagsRaw.includes('blocked') || tagsRaw.includes('blocker') || tagsRaw.includes('imped');

                    try {
                        await prisma.workItem.upsert({
                            where: { id: item.id },
                            create: {
                                id: item.id,
                                azureId: item.id,
                                type: f['System.WorkItemType'] || 'Unknown',
                                state: f['System.State'] || 'Unknown',
                                reason: f['System.Reason'] || null,
                                title: f['System.Title'] || '(sem título)',
                                description: f['System.Description'] || null,
                                acceptanceCriteria: f['System.AcceptanceCriteria'] || null,
                                reproSteps: f['Microsoft.VSTS.TCM.ReproSteps'] || null,
                                originalEstimate: f['Microsoft.VSTS.Scheduling.OriginalEstimate'] || null,
                                completedWork: Number(f['Microsoft.VSTS.Scheduling.CompletedWork'] || 0),
                                remainingWork: Number(f['Microsoft.VSTS.Scheduling.RemainingWork'] || 0),
                                storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
                                priority: f['Microsoft.VSTS.Common.Priority'] || 3,
                                severity: f['Microsoft.VSTS.Common.Severity'] || null,
                                createdDate: d(f['System.CreatedDate']) || new Date(),
                                changedDate: d(f['System.ChangedDate']) || new Date(),
                                closedDate: d(f['System.ClosedDate']),
                                resolvedDate: d(f['System.ResolvedDate']),
                                stateChangeDate: d(f['System.StateChangeDate']),
                                activatedDate: d(f['Microsoft.VSTS.Common.ActivatedDate']),
                                createdBy: f['System.CreatedBy']?.displayName || 'Unknown',
                                changedBy: f['System.ChangedBy']?.displayName || 'Unknown',
                                isBlocked,
                                tags: f['System.Tags']
                                    ? f['System.Tags'].split(';').map((t: string) => t.trim())
                                    : [],
                                areaPath: f['System.AreaPath'] || '',
                                iterationPath: f['System.IterationPath'] || sprint.path,
                                url: item.url || '',
                                rev: item.rev || 0,
                                projectId: sprint.projectId,
                                sprintId: sprint.id,
                                assignedToId
                            },
                            update: {
                                state: f['System.State'] || 'Unknown',
                                title: f['System.Title'] || '(sem título)',
                                changedDate: d(f['System.ChangedDate']) || new Date(),
                                changedBy: f['System.ChangedBy']?.displayName || 'Unknown',
                                completedWork: Number(f['Microsoft.VSTS.Scheduling.CompletedWork'] || 0),
                                remainingWork: Number(f['Microsoft.VSTS.Scheduling.RemainingWork'] || 0),
                                storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
                                isBlocked,
                                assignedToId,
                                rev: item.rev || 0
                            }
                        });
                        totalSynced++;
                        sprintSynced++;
                        batchSaved++;
                    } catch { /* item individual com erro não para o lote */ }
                }

                step(`    [lote ${batchNum}/${totalBatchesMassive}] ${batchSaved} items salvos`);
            }

            step(`  ✅ ${sprintSynced} items carregados`);
        } catch (err: any) {
            step(`  ⚠️  Erro ao processar sprint: ${err.message}`);
        }
    }

    return totalSynced;
}

// ─── FASE 5: Backfill de histórico de horas (só no modo inicial) ──────────────

async function backfillHistory(witApi: any, prisma: PrismaClient): Promise<number> {
    // Busca work items com campos de histórico faltando
    const itemsNeedingHistory = await (prisma as any).workItem.findMany({
        where: {
            OR: [
                { initialRemainingWork: null },
                { initialRemainingWork: 0 },
                { lastRemainingWork: null },
                { lastRemainingWork: 0 }
            ]
        },
        select: { id: true, azureId: true, state: true },
        take: 500 // Limita para não demorar demais na primeira execução
    });

    if (!itemsNeedingHistory.length) {
        ok('Todos os work items já têm histórico de horas');
        return 0;
    }

    step(`${itemsNeedingHistory.length} item(s) precisam de backfill de histórico`);

    let recovered = 0;
    let i = 0;

    for (const item of itemsNeedingHistory) {
        i++;

        try {
            const revisions = await witApi.getRevisions(item.azureId);
            if (!revisions?.length) continue;

            let initialRemainingWork = 0;
            let lastRemainingWork = 0;
            let doneRemainingWork = 0;
            let foundInitial = false;
            let lastNonZeroRemaining = 0;
            let closedDate: Date | null = null;
            let previousState = '';

            for (const rev of revisions) {
                const remaining = rev.fields?.['Microsoft.VSTS.Scheduling.RemainingWork'];
                const state = (rev.fields?.['System.State'] || '').toString().toLowerCase();
                const changedDate = rev.fields?.['System.ChangedDate'];

                if (remaining !== undefined) {
                    lastRemainingWork = remaining;
                    if (remaining > 0) lastNonZeroRemaining = remaining;
                }

                if (!foundInitial && remaining !== undefined && remaining > 0) {
                    initialRemainingWork = remaining;
                    foundInitial = true;
                }

                const isDone = state === 'done' || state === 'closed' || state === 'completed';
                if (isDone && !closedDate && previousState !== state && changedDate) {
                    closedDate = new Date(changedDate);
                }

                if (isDone && doneRemainingWork === 0 && lastNonZeroRemaining > 0) {
                    doneRemainingWork = lastNonZeroRemaining;
                }

                previousState = state;
            }

            const updateData: any = {
                initialRemainingWork: initialRemainingWork || lastNonZeroRemaining,
                lastRemainingWork: lastRemainingWork || lastNonZeroRemaining
            };

            if (doneRemainingWork > 0) updateData.doneRemainingWork = doneRemainingWork;
            if (closedDate) updateData.closedDate = closedDate;

            await prisma.workItem.update({
                where: { id: item.id },
                data: updateData
            });

            recovered++;
        } catch { /* item individual com erro não para */ }

        if (i % 10 === 0 || i === itemsNeedingHistory.length) {
            step(`  ${i}/${itemsNeedingHistory.length} items processados`);
        }
    }

    return recovered;
}

// ─── FASE 6: Backfill de datas de fechamento (só no modo inicial) ─────────────

async function backfillClosedDates(witApi: any, prisma: PrismaClient): Promise<number> {
    // Busca itens Done/Closed sem closedDate
    const DONE_STATES = ['done', 'closed', 'completed', 'Done', 'Closed', 'Completed'];

    const itemsWithoutClosedDate = await prisma.workItem.findMany({
        where: {
            state: { in: DONE_STATES },
            closedDate: null
        },
        select: { id: true, azureId: true, changedDate: true },
        take: 500 // Limita para não demorar demais
    });

    if (!itemsWithoutClosedDate.length) {
        ok('Todos os itens Done já têm closedDate preenchida');
        return 0;
    }

    step(`${itemsWithoutClosedDate.length} item(s) Done sem closedDate para backfill`);

    let fixed = 0;
    let i = 0;

    for (const item of itemsWithoutClosedDate) {
        i++;

        try {
            const revisions = await witApi.getRevisions(item.azureId);
            if (!revisions?.length) {
                if (i % 10 === 0 || i === itemsWithoutClosedDate.length) step(`  ${i}/${itemsWithoutClosedDate.length} items processados`);
                continue;
            }

            let closedDate: Date | null = null;
            let prevState = '';

            for (const rev of revisions) {
                const state = (rev.fields?.['System.State'] || '').toString().toLowerCase();
                const changedDate = rev.fields?.['System.ChangedDate'];

                const isDone = state === 'done' || state === 'closed' || state === 'completed';
                if (isDone && !closedDate && prevState !== state && changedDate) {
                    closedDate = new Date(changedDate);
                    break; // Encontrou a primeira transição para Done
                }

                prevState = state;
            }

            // Fallback: usa changedDate do item se não encontrou transição
            if (!closedDate && item.changedDate) {
                closedDate = new Date(item.changedDate);
            }

            if (closedDate) {
                await prisma.workItem.update({
                    where: { id: item.id },
                    data: { closedDate }
                });
                fixed++;
            }
        } catch { /* item individual com erro não para */ }

        if (i % 10 === 0 || i === itemsWithoutClosedDate.length) {
            step(`  ${i}/${itemsWithoutClosedDate.length} items processados`);
        }
    }

    return fixed;
}

// ─── FASE Wiki: Sync de páginas da Wiki ───────────────────────────────────────

async function syncWiki(
    wikiApi: any,
    prisma: PrismaClient,
    mode: 'incremental' | 'full'
): Promise<WikiSyncStats> {
    const stats: WikiSyncStats = { projects: 0, pagesFound: 0, created: 0, updated: 0, unchanged: 0, failed: 0, skipped: 0 };

    // Busca projetos alvo no banco (aplica filtro TARGET_PROJECT_CONFIGS)
    const allDbProjects = await prisma.project.findMany({ select: { id: true, name: true } });
    const dbProjects = allDbProjects.filter(p => isTargetProject(p.name));
    if (!dbProjects.length) {
        warn('Nenhum projeto alvo no banco para Wiki Sync');
        return stats;
    }

    stats.projects = dbProjects.length;
    step(`Modo: ${mode} | ${dbProjects.length} projeto(s) alvo (de ${allDbProjects.length} no banco)`);

    const removeMissing = mode === 'full';
    const contentConcurrency = 4;

    for (let i = 0; i < dbProjects.length; i++) {
        const proj = dbProjects[i];
        const counter = `[${i + 1}/${dbProjects.length}]`;
        step(`⏳ ${counter} ${proj.name}`);

        let wikis: any[];
        try {
            wikis = await wikiApi.getAllWikis(proj.name);
        } catch {
            stats.skipped++;
            step(`  ⚠️  ${counter} ${proj.name} — Wiki API indisponível (pulado)`);
            continue;
        }

        if (!wikis?.length) {
            stats.skipped++;
            step(`  ─  ${counter} ${proj.name} — sem wikis no Azure DevOps`);
            continue;
        }

        // Coleta todas as páginas remotas via paginação
        const remotePagesMap = new Map<string, { id: number | null; path: string; wikiId: string }>();
        for (const wiki of wikis) {
            if (!wiki.id) continue;
            let continuationToken: string | undefined;
            do {
                const batch: any = await wikiApi.getPagesBatch(
                    { top: 100, continuationToken, pageViewsForDays: 0 },
                    proj.name,
                    wiki.id
                );
                if (Array.isArray(batch) && batch.length > 0) {
                    for (const page of batch) {
                        if (page.path) remotePagesMap.set(page.path, { id: page.id ?? null, path: page.path, wikiId: wiki.id });
                    }
                }
                continuationToken = batch?.continuationToken;
            } while (continuationToken);
        }

        const remotePages = Array.from(remotePagesMap.values());
        stats.pagesFound += remotePages.length;

        const existingPages = await prisma.wikiPage.findMany({
            where: { projectId: proj.id },
            select: { id: true, path: true, title: true, parentPath: true, azureId: true, content: true }
        });
        const existingByPath = new Map(existingPages.map(p => [p.path, p]));

        let projCreated = 0, projUpdated = 0, projUnchanged = 0, projFailed = 0;

        for (const remotePage of remotePages) {
            try {
                const title = remotePage.path.split('/').filter(Boolean).pop()?.replace(/-/g, ' ') || remotePage.path;
                const parts = remotePage.path.split('/').filter(Boolean);
                const parentPath = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : null;

                let content = '';
                try {
                    const stream = await wikiApi.getPageText(proj.name, remotePage.wikiId, remotePage.path, undefined, undefined, true);
                    content = await new Promise<string>((res, rej) => {
                        const chunks: Buffer[] = [];
                        stream.on('data', (c: Buffer) => chunks.push(c));
                        stream.on('end', () => res(Buffer.concat(chunks).toString('utf-8')));
                        stream.on('error', rej);
                    });
                } catch { /* mantém content vazio, não interrompe */ }

                const existing = existingByPath.get(remotePage.path);
                if (!existing) {
                    await prisma.wikiPage.create({
                        data: { projectId: proj.id, azureId: remotePage.id, path: remotePage.path, title, content, parentPath, order: 0, lastSyncAt: new Date() }
                    });
                    projCreated++;
                } else {
                    const changed = existing.azureId !== remotePage.id || existing.title !== title || existing.parentPath !== parentPath || existing.content !== content;
                    if (changed) {
                        await prisma.wikiPage.update({
                            where: { id: existing.id },
                            data: { azureId: remotePage.id, title, parentPath, content, lastSyncAt: new Date() }
                        });
                        projUpdated++;
                    } else {
                        projUnchanged++;
                    }
                }
            } catch {
                projFailed++;
            }
        }

        // Remove páginas que não existem mais no Azure (apenas no modo full)
        if (removeMissing) {
            const remotePaths = new Set(remotePages.map(p => p.path));
            const toDelete = existingPages.filter(p => !remotePaths.has(p.path));
            if (toDelete.length > 0) {
                await prisma.wikiPage.deleteMany({ where: { id: { in: toDelete.map(p => p.id) } } });
            }
        }

        stats.created += projCreated;
        stats.updated += projUpdated;
        stats.unchanged += projUnchanged;
        stats.failed += projFailed;

        const statusIcon = projFailed > 0 ? '⚠️ ' : '✅';
        step(
            `  ${statusIcon} ${counter} ${proj.name.padEnd(30)} — ${remotePages.length} págs | ` +
            `+${projCreated} criadas | ~${projUpdated} atualizadas | =${projUnchanged} sem alteração` +
            (projFailed > 0 ? ` | ❌ ${projFailed} falhas` : '')
        );
    }

    return stats;
}

// ─── FASE Backfill Past: Sprints passadas sem dados históricos ─────────────────

async function backfillNewPastSprints(
    witApi: any,
    coreApi: any,
    workApi: any,
    prisma: PrismaClient
): Promise<BackfillPastStats> {
    const stats: BackfillPastStats = { sprintsFound: 0, sprintsProcessed: 0, itemsLoaded: 0, sprintIds: [] };

    // Busca TODAS as sprints Past dos projetos alvo (não apenas as vazias)
    const allPastSprints = await prisma.sprint.findMany({
        where: { state: { in: ['Past', 'past'] } },
        include: { project: true },
        orderBy: [{ project: { name: 'asc' } }, { startDate: 'asc' }]
    });

    const targetSprints = allPastSprints.filter(s =>
        isTargetProject(s.project.name) && isTargetSprint(s.project.name, s.name)
    );

    if (!targetSprints.length) {
        ok('Nenhuma sprint passada detectada para os projetos alvo');
        return stats;
    }

    stats.sprintsFound = targetSprints.length;
    step(`${targetSprints.length} sprint(s) passada(s) para verificação de delta`);

    for (let i = 0; i < targetSprints.length; i++) {
        const sprint = targetSprints[i];
        const counter = `[${i + 1}/${targetSprints.length}]`;
        const startLabel = sprint.startDate ? new Date(sprint.startDate).toLocaleDateString('pt-BR') : '?';
        const endLabel = sprint.endDate ? new Date(sprint.endDate).toLocaleDateString('pt-BR') : '?';
        const label = `${sprint.project.name} / ${sprint.name} (${startLabel} – ${endLabel})`;

        step(`  ${counter} ${label}`);

        try {
            // ── Work Items: upsert inteligente por rev ──────────────

            // 1. IDs do Azure via WiQL
            const wiql = {
                query: `SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] UNDER '${sprint.path}' AND [System.WorkItemType] IN ('Product Backlog Item', 'Bug', 'Task', 'Feature', 'User Story', 'Epic') ORDER BY [System.Id]`
            };
            const result = await witApi.queryByWiql(wiql, { project: sprint.project.name });
            const azureIds: number[] = result?.workItems?.map((wi: any) => wi.id).filter((id: any): id is number => typeof id === 'number') || [];

            // 2. Items existentes no banco com seus revs
            const dbItems = await prisma.workItem.findMany({
                where: { sprintId: sprint.id },
                select: { id: true, azureId: true, rev: true }
            });
            const dbRevMap = new Map<number, number>(dbItems.map(item => [item.id, item.rev ?? 0]));

            step(`      ↳ Azure: ${azureIds.length} item(s) | Banco: ${dbItems.length} item(s)`);

            let newCount = 0, updatedCount = 0, skippedCount = 0;
            const newAzureIds: number[] = []; // apenas itens novos precisam de backfill de histórico

            if (azureIds.length > 0) {
                const totalBatches = Math.ceil(azureIds.length / 100);

                // 3. Processa em lotes de 100, comparando rev
                for (let j = 0; j < azureIds.length; j += 100) {
                    const batchNum = Math.floor(j / 100) + 1;
                    const batchIds = azureIds.slice(j, j + 100);
                    const batchStart = j + 1;
                    const batchEnd = Math.min(j + batchIds.length, azureIds.length);
                    step(`        [lote ${batchNum}/${totalBatches}] verificando items ${batchStart}–${batchEnd}...`);

                    const azureItems = await witApi.getWorkItems(batchIds);
                    let batchNew = 0, batchUpdated = 0, batchSkipped = 0;

                    for (const item of (azureItems || [])) {
                        if (!item?.id) continue;

                        const dbRev = dbRevMap.get(item.id);
                        const azureRev = item.rev ?? 0;
                        const isNew = dbRev === undefined;
                        const needsUpdate = !isNew && azureRev > dbRev;

                        if (!isNew && !needsUpdate) {
                            batchSkipped++;
                            continue;
                        }

                        const f = item.fields;
                        const d = (v: any) => v ? new Date(v) : null;

                        const assignedRaw = f['System.AssignedTo'];
                        let assignedToId: string | null = null;
                        if (assignedRaw && typeof assignedRaw === 'object') {
                            const azureIdentityId = assignedRaw.id ? String(assignedRaw.id) : (assignedRaw.uniqueName || null);
                            if (azureIdentityId) {
                                const member = await prisma.teamMember.upsert({
                                    where: { azureId_projectId: { azureId: azureIdentityId, projectId: sprint.projectId } },
                                    create: {
                                        azureId: azureIdentityId,
                                        displayName: assignedRaw.displayName || assignedRaw.uniqueName || 'Unknown',
                                        uniqueName: assignedRaw.uniqueName || assignedRaw.displayName || 'Unknown',
                                        imageUrl: assignedRaw.imageUrl || null,
                                        projectId: sprint.projectId
                                    },
                                    update: { displayName: assignedRaw.displayName || assignedRaw.uniqueName || 'Unknown' }
                                });
                                assignedToId = member.id;
                            }
                        }

                        const stateLower = String(f['System.State'] || '').trim().toLowerCase();
                        const tagsRaw = String(f['System.Tags'] || '').toLowerCase();
                        const boardColumn = String(f['System.BoardColumn'] || '').trim().toLowerCase();
                        const blockedField = ['true', 'yes', 'sim', '1'].includes(String(f['Microsoft.VSTS.Common.Blocked'] || '').trim().toLowerCase());
                        const isBlocked = blockedField || ['blocked', 'impeded', 'impedido'].includes(stateLower) || boardColumn === 'blocked' || tagsRaw.includes('blocked') || tagsRaw.includes('imped');

                        try {
                            await prisma.workItem.upsert({
                                where: { id: item.id },
                                create: {
                                    id: item.id, azureId: item.id,
                                    type: f['System.WorkItemType'] || 'Unknown',
                                    state: f['System.State'] || 'Unknown',
                                    reason: f['System.Reason'] || null,
                                    title: f['System.Title'] || '(sem título)',
                                    description: f['System.Description'] || null,
                                    acceptanceCriteria: f['System.AcceptanceCriteria'] || null,
                                    reproSteps: f['Microsoft.VSTS.TCM.ReproSteps'] || null,
                                    originalEstimate: f['Microsoft.VSTS.Scheduling.OriginalEstimate'] || null,
                                    completedWork: Number(f['Microsoft.VSTS.Scheduling.CompletedWork'] || 0),
                                    remainingWork: Number(f['Microsoft.VSTS.Scheduling.RemainingWork'] || 0),
                                    storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
                                    priority: f['Microsoft.VSTS.Common.Priority'] || 3,
                                    severity: f['Microsoft.VSTS.Common.Severity'] || null,
                                    createdDate: d(f['System.CreatedDate']) || new Date(),
                                    changedDate: d(f['System.ChangedDate']) || new Date(),
                                    closedDate: d(f['System.ClosedDate']),
                                    resolvedDate: d(f['System.ResolvedDate']),
                                    stateChangeDate: d(f['System.StateChangeDate']),
                                    activatedDate: d(f['Microsoft.VSTS.Common.ActivatedDate']),
                                    createdBy: f['System.CreatedBy']?.displayName || 'Unknown',
                                    changedBy: f['System.ChangedBy']?.displayName || 'Unknown',
                                    isBlocked,
                                    tags: f['System.Tags'] ? f['System.Tags'].split(';').map((t: string) => t.trim()) : [],
                                    areaPath: f['System.AreaPath'] || '',
                                    iterationPath: f['System.IterationPath'] || sprint.path,
                                    url: item.url || '',
                                    rev: azureRev,
                                    projectId: sprint.projectId,
                                    sprintId: sprint.id,
                                    assignedToId
                                },
                                update: {
                                    state: f['System.State'] || 'Unknown',
                                    title: f['System.Title'] || '(sem título)',
                                    changedDate: d(f['System.ChangedDate']) || new Date(),
                                    completedWork: Number(f['Microsoft.VSTS.Scheduling.CompletedWork'] || 0),
                                    remainingWork: Number(f['Microsoft.VSTS.Scheduling.RemainingWork'] || 0),
                                    storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
                                    closedDate: d(f['System.ClosedDate']),
                                    isBlocked,
                                    assignedToId,
                                    rev: azureRev
                                }
                            });
                            if (isNew) { batchNew++; newAzureIds.push(item.id); }
                            else { batchUpdated++; }
                        } catch { /* item individual com erro não para o lote */ }
                    }

                    newCount += batchNew;
                    updatedCount += batchUpdated;
                    skippedCount += batchSkipped;
                    step(`        [lote ${batchNum}/${totalBatches}] +${batchNew} novos | ~${batchUpdated} atualizados | =${batchSkipped} sem mudança`);
                }
            }

            // 4. Backfill de histórico apenas para itens NOVOS (sem initialRemainingWork)
            if (newAzureIds.length > 0) {
                step(`      ↳ Backfill histórico: ${newAzureIds.length} item(s) novo(s)...`);
                let historyDone = 0;

                for (const azureId of newAzureIds) {
                    try {
                        const revisions = await witApi.getRevisions(azureId);
                        if (!revisions?.length) { historyDone++; continue; }

                        let initialRemainingWork = 0, lastRemainingWork = 0, lastNonZero = 0;
                        let closedDate: Date | null = null;
                        let prevState = '';

                        for (const rev of revisions) {
                            const remaining = rev.fields?.['Microsoft.VSTS.Scheduling.RemainingWork'];
                            const state = String(rev.fields?.['System.State'] || '').toLowerCase();
                            const changedDate = rev.fields?.['System.ChangedDate'];
                            if (remaining !== undefined) {
                                lastRemainingWork = remaining;
                                if (remaining > 0) lastNonZero = remaining;
                            }
                            if (!initialRemainingWork && remaining > 0) initialRemainingWork = remaining;
                            const isDone = state === 'done' || state === 'closed' || state === 'completed';
                            if (isDone && !closedDate && prevState !== state && changedDate) closedDate = new Date(changedDate);
                            prevState = state;
                        }

                        const updateData: any = {
                            initialRemainingWork: initialRemainingWork || lastNonZero,
                            lastRemainingWork: lastRemainingWork || lastNonZero
                        };
                        if (closedDate) updateData.closedDate = closedDate;
                        await prisma.workItem.update({ where: { id: azureId }, data: updateData });
                        historyDone++;

                        if (historyDone % 10 === 0 || historyDone === newAzureIds.length) {
                            step(`        histórico: ${historyDone}/${newAzureIds.length} items processados`);
                        }
                    } catch { historyDone++; }
                }
            }

            // 5. Capacidade — sincroniza se não existir nenhum registro
            const hasCapacity = await prisma.teamCapacity.count({ where: { sprintId: sprint.id } });
            if (hasCapacity === 0) {
                step(`      ↳ Capacidade ausente — sincronizando via Azure...`);
                const capSynced = await syncCapacityForSprint(coreApi, workApi, prisma, sprint);
                step(`        ${capSynced > 0 ? `${capSynced} membro(s) sincronizados` : 'sem dados de capacidade retornados pelo Azure'}`);
            } else {
                step(`      ↳ Capacidade: ${hasCapacity} registro(s) já existente(s) — mantendo`);
            }

            stats.itemsLoaded += newCount;
            stats.sprintsProcessed++;
            if (newCount > 0 || updatedCount > 0) stats.sprintIds.push(sprint.id);

            step(`      ↳ ✅ +${newCount} novos | ~${updatedCount} atualizados | =${skippedCount} sem mudança`);
        } catch (err: any) {
            warn(`      ↳ ❌ Erro ao processar sprint: ${err.message}`);
        }
    }

    return stats;
}

// ─── Detecção de modo ─────────────────────────────────────────────────────────

async function detectMode(prisma: PrismaClient): Promise<'initial' | 'incremental'> {
    // FULL_SYNC=true força a carga inicial
    const forceFullSync = ['true', '1', 'yes', 'sim'].includes(
        String(process.env.FULL_SYNC || '').trim().toLowerCase()
    );

    if (forceFullSync) {
        info('FULL_SYNC=true detectado → forçando modo de Carga Inicial');
        return 'initial';
    }

    // Verifica se o banco tem work items
    const wiCount = await prisma.workItem.count();
    if (wiCount === 0) {
        info(`Banco vazio (0 work items) → modo Carga Inicial ativado automaticamente`);
        return 'initial';
    }

    step(`${wiCount.toLocaleString('pt-BR')} work items no banco → modo Incremental`);
    return 'incremental';
}

// ─── Função principal ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const startMs = Date.now();

    // Valida credenciais
    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    const azureProject = process.env.AZURE_DEVOPS_PROJECT;

    if (!orgUrl || !pat) {
        console.error('\n  ❌  ERRO: AZURE_DEVOPS_ORG_URL e AZURE_DEVOPS_PAT devem estar definidos no .env');
        process.exit(1);
    }

    // Inicializa conexões
    console.log('\n  🔌  Inicializando conexões...');

    let coreApi: any, witApi: any, workApi: any, wikiApi: any;
    let prisma: PrismaClient;

    try {
        const authHandler = azdev.getPersonalAccessTokenHandler(pat);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        [coreApi, witApi, workApi, wikiApi] = await Promise.all([
            connection.getCoreApi(),
            connection.getWorkItemTrackingApi(),
            connection.getWorkApi(),
            connection.getWikiApi()
        ]);
        console.log('  ✅  Azure DevOps conectado (Core + WIT + Work + Wiki)');

        prisma = new PrismaClient();
        await prisma.$connect();
        console.log('  ✅  Banco de dados conectado');
    } catch (err: any) {
        console.error(`\n  ❌  Falha na conexão: ${err.message}`);
        process.exit(1);
    }

    // Detecta modo de operação
    console.log('\n  🔍  Detectando modo de operação...');
    const mode = await detectMode(prisma);

    // Inicializa estatísticas
    const stats: DailyStats = {
        mode,
        projects: 0,
        sprints: 0,
        teamMembers: 0,
        capacities: 0,
        workItemsSynced: 0,
        backfillHistory: 0,
        backfillClosedDates: 0,
        wikiSync: null,
        backfillPast: null,
        corePipeline: null,
        durationMs: 0,
        hasErrors: false
    };

    printHeader(mode);

    if (mode === 'initial') {
        // ══════════════════════════════════════════════════════════
        // MODO INICIAL — Carga completa desde zero
        // ══════════════════════════════════════════════════════════

        // ── Fase 1: Projetos & Sprints ────────────────────────────
        printPhaseHeader(1, 'PROJETOS & SPRINTS — Importando estrutura do Azure DevOps');
        try {
            const r = await syncProjectsAndSprints(coreApi, witApi, prisma);
            stats.projects = r.projects;
            stats.sprints = r.sprints;
            ok(`${r.projects} projeto(s) e ${r.sprints} sprint(s) sincronizados`);
        } catch (err: any) {
            warn(`Fase 1 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 2: Times & Membros ───────────────────────────────
        printPhaseHeader(2, 'TIMES & MEMBROS — Importando membros de todos os times');
        try {
            stats.teamMembers = await syncTeamMembers(coreApi, prisma);
            ok(`${stats.teamMembers} membro(s) de time sincronizados`);
        } catch (err: any) {
            warn(`Fase 2 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 3: Capacidade ────────────────────────────────────
        printPhaseHeader(3, 'CAPACIDADE — Sincronizando capacidade das sprints atuais/futuras');
        try {
            stats.capacities = await syncCapacity(coreApi, workApi, prisma, true);
            ok(`${stats.capacities} registro(s) de capacidade sincronizados`);
        } catch (err: any) {
            warn(`Fase 3 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 4: Carga massiva de Work Items ───────────────────
        printPhaseHeader(4, 'CARGA MASSIVA — Importando todos os work items de todas as sprints');
        try {
            stats.workItemsSynced = await massiveWorkItemsSync(witApi, prisma);
            ok(`${stats.workItemsSynced} work item(s) sincronizados`);
        } catch (err: any) {
            warn(`Fase 4 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 5: Backfill histórico de horas ───────────────────
        printPhaseHeader(5, 'BACKFILL HISTÓRICO — Recuperando horas iniciais via revisões do Azure');
        try {
            stats.backfillHistory = await backfillHistory(witApi, prisma);
            ok(`${stats.backfillHistory} item(s) com histórico recuperado`);
        } catch (err: any) {
            warn(`Fase 5 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 6: Backfill closedDate ───────────────────────────
        printPhaseHeader(6, 'BACKFILL CLOSED DATE — Preenchendo datas de fechamento faltantes');
        try {
            stats.backfillClosedDates = await backfillClosedDates(witApi, prisma);
            ok(`${stats.backfillClosedDates} item(s) com closedDate recuperada`);
        } catch (err: any) {
            warn(`Fase 6 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 7: Wiki Sync (full na carga inicial) ─────────────
        printPhaseHeader(7, 'WIKI SYNC — Importando documentação completa dos projetos');
        try {
            stats.wikiSync = await syncWiki(wikiApi, prisma, 'full');
            const w = stats.wikiSync;
            ok(`Wiki sync: ${w.pagesFound} páginas | +${w.created} criadas | ~${w.updated} atualizadas | ${w.skipped} projeto(s) pulados`);
        } catch (err: any) {
            warn(`Fase 7 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 8: Pipeline Central ──────────────────────────────
        printPhaseHeader(8, 'PIPELINE CENTRAL — Smart Sync + Reconcile + Rebuild Burndown');
        try {
            stats.corePipeline = await runCorePipeline({ prisma, witApi, orgUrl, pat, azureProject, rebuildAllSprints: true });
            if (stats.corePipeline.hasErrors) stats.hasErrors = true;
            ok('Pipeline central concluído');
        } catch (err: any) {
            warn(`Fase 8 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

    } else {
        // ══════════════════════════════════════════════════════════
        // MODO INCREMENTAL — Atualização estrutural + core pipeline
        // ══════════════════════════════════════════════════════════

        // ── Fase 1: Atualiza Projetos & Sprints ───────────────────
        printPhaseHeader(1, 'PROJETOS & SPRINTS — Atualizando estrutura e timeFrames');
        try {
            const r = await syncProjectsAndSprints(coreApi, witApi, prisma);
            stats.projects = r.projects;
            stats.sprints = r.sprints;
            ok(`${r.projects} projeto(s) e ${r.sprints} sprint(s) atualizados`);
        } catch (err: any) {
            warn(`Fase 1 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 2: Atualiza Membros ──────────────────────────────
        printPhaseHeader(2, 'TIMES & MEMBROS — Atualizando membros de todos os times');
        try {
            stats.teamMembers = await syncTeamMembers(coreApi, prisma);
            ok(`${stats.teamMembers} membro(s) sincronizados`);
        } catch (err: any) {
            warn(`Fase 2 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 3: Atualiza Capacidade ───────────────────────────
        printPhaseHeader(3, 'CAPACIDADE — Atualizando capacidade das sprints current/future');
        try {
            stats.capacities = await syncCapacity(coreApi, workApi, prisma, true);
            ok(`${stats.capacities} registro(s) de capacidade atualizados`);
        } catch (err: any) {
            warn(`Fase 3 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 4: Wiki Sync (incremental) ───────────────────────
        printPhaseHeader(4, 'WIKI SYNC — Sincronizando documentação dos projetos');
        try {
            stats.wikiSync = await syncWiki(wikiApi, prisma, 'incremental');
            const w = stats.wikiSync;
            ok(`Wiki sync: ${w.pagesFound} páginas | +${w.created} criadas | ~${w.updated} atualizadas | ${w.skipped} projeto(s) pulados`);
        } catch (err: any) {
            warn(`Fase 4 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 5: Backfill Sprints Passadas Novas ───────────────
        printPhaseHeader(5, 'BACKFILL SPRINTS PASSADAS — Detectando novos históricos');
        let extraAffectedSprintIds: string[] = [];
        try {
            stats.backfillPast = await backfillNewPastSprints(witApi, coreApi, workApi, prisma);
            extraAffectedSprintIds = stats.backfillPast.sprintIds;
            if (stats.backfillPast.sprintsFound > 0) {
                ok(`Backfill: ${stats.backfillPast.sprintsProcessed} sprint(s) | ${stats.backfillPast.itemsLoaded} items | encaminhados ao burndown rebuild`);
            }
        } catch (err: any) {
            warn(`Fase 5 falhou: ${err.message}`);
            stats.hasErrors = true;
        }

        // ── Fase 6: Pipeline Central ──────────────────────────────
        printPhaseHeader(6, 'PIPELINE CENTRAL — Smart Sync + Reconcile + Rebuild Burndown');
        try {
            stats.corePipeline = await runCorePipeline({ prisma, witApi, orgUrl, pat, azureProject, rebuildAllSprints: true, extraAffectedSprintIds });
            if (stats.corePipeline.hasErrors) stats.hasErrors = true;
            ok('Pipeline central concluído');
        } catch (err: any) {
            warn(`Fase 6 falhou: ${err.message}`);
            stats.hasErrors = true;
        }
    }

    // Finaliza
    await prisma.$disconnect();
    stats.durationMs = Date.now() - startMs;
    printFooter(stats);

    if (stats.hasErrors) process.exit(1);
}

// ─── Retry em erros transitórios de banco ─────────────────────────────────────

const DB_RETRY_DELAYS_MS = [5000, 15000, 30000];

function isTransientDbError(error: any): boolean {
    const msg = String(error?.message || error || '');
    return (
        msg.includes('PrismaClientInitializationError') ||
        msg.includes("Can't reach database server") ||
        msg.includes('Connection terminated unexpectedly') ||
        msg.includes('Timed out fetching a new connection')
    );
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
    for (let attempt = 1; attempt <= DB_RETRY_DELAYS_MS.length + 1; attempt++) {
        try {
            await main();
            break;
        } catch (error: any) {
            const retriable = isTransientDbError(error);
            const hasNext = attempt <= DB_RETRY_DELAYS_MS.length;

            if (!retriable || !hasNext) {
                console.error('\n  ❌  Sync diário falhou definitivamente:', error.message);
                process.exit(1);
            }

            const delay = DB_RETRY_DELAYS_MS[attempt - 1];
            console.warn(`\n  ⚠️  Banco indisponível (tentativa ${attempt}). Retentando em ${Math.floor(delay / 1000)}s...`);
            await sleep(delay);
        }
    }
})();
