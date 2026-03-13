/**
 * ============================================================
 * SYNC-CORE.TS — Pipeline Central de Sincronização
 * ============================================================
 *
 * Este módulo contém a lógica compartilhada entre o sync horário
 * e o sync diário. Exporta a função principal `runCorePipeline()`.
 *
 * O pipeline executa 3 fases em sequência:
 *
 *   FASE 1 — SMART SYNC
 *     Busca no Azure todos os work items alterados desde o último
 *     sync bem-sucedido. Para cada item: atualiza dados básicos,
 *     hierarquia (pai/filho) e recupera histórico de horas se estiver
 *     faltando (initialRemainingWork, lastRemainingWork, etc.).
 *
 *   FASE 2 — RECONCILE SPRINTS ATIVAS
 *     Para cada sprint ativa, compara o que está no Azure com o que
 *     está no banco de dados. Marca itens removidos da sprint como
 *     isRemoved=true, reativa itens que voltaram, e corrige
 *     atribuições (assignedToId) que mudaram desde o último sync.
 *
 *   FASE 3 — REBUILD BURNDOWN (EVENT MODEL)
 *     Para cada sprint ativa, deleta todos os snapshots antigos e
 *     reconstrói do zero a partir do histórico de revisões do Azure.
 *     Este é o método mais preciso: usa eventos reais (mudanças de
 *     remaining work, entrada/saída de itens na sprint) para calcular
 *     o burndown dia a dia.
 *
 * ============================================================
 */

/// <reference types="node" />
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { capacityService } from '../../src/services/capacity.service';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CorePipelineOptions {
    prisma: PrismaClient;
    witApi: any;
    coreApi?: any;
    orgUrl: string;
    pat: string;
    /** Projeto Azure para o contexto do WiQL (opcional, usa env var se omitido) */
    azureProject?: string;
    /**
     * Se true, reconstrói burndown de TODAS as sprints ativas (independente de mudanças).
     * Use no sync diário. No sync horário, só as sprints com itens alterados são reconstruídas.
     * Default: false
     */
    rebuildAllSprints?: boolean;
    /**
     * IDs adicionais de sprints Past a incluir no rebuild (ex: sprints recém-backfilladas).
     * Passados pelo sync-daily após backfillNewPastSprints().
     */
    extraAffectedSprintIds?: string[];
}

export interface CorePipelineResult {
    phase1: SmartSyncStats;
    phase2: ReconcileStats;
    phase3: BurndownStats;
    durationMs: number;
    hasErrors: boolean;
}

interface SmartSyncStats {
    evaluated: number;
    basicUpdated: number;
    hierarchyUpdated: number;
    historyRecovered: number;
    errors: number;
    skipped: boolean;  // true se nenhuma mudança foi encontrada
    affectedSprintIds: string[];  // IDs das sprints que tiveram itens alterados
}

interface ReconcileStats {
    sprintsProcessed: number;
    markedRemoved: number;
    reactivated: number;
    reassigned: number;
    errors: number;
}

interface BurndownStats {
    sprintsRebuilt: number;
    snapshotsCreated: number;
    outcomesCreated: number;
    errors: number;
}

interface ReconcileItemLog {
    azureId: number;
    title: string;
    type: string;
    state: string;
    iterationPath: string;
    remainingHours: number;
    changedBy?: string;
    fromAssignee?: string | null;
    toAssignee?: string | null;
}

interface SprintOutcomeLogRow {
    azureId: number;
    title: string;
    type: string;
    scopeAddedHours: number;
    scopeRemovedHours: number;
    completedInSprintHours: number;
    enteredAfterD0: boolean;
    leftDuringSprint: boolean;
    removedByStateInSprint: boolean;
    inSprintAtEnd: boolean;
    lastScopeEventDate: Date | null;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const SPRINT_TIMEZONE = process.env.SPRINT_TIMEZONE || 'America/Sao_Paulo';
const ALLOWED_BURNDOWN_TYPES = new Set(['task', 'bug', 'test case']);
const COUNTABLE_CHART_TYPES = new Set(['task', 'bug']);
const DONE_LIKE_STATES = new Set(['done', 'closed', 'completed']);

// ─── Utilitários gerais ───────────────────────────────────────────────────────

function phase(num: number, title: string): void {
    console.log(`\n┌─ FASE ${num}: ${title}`);
}

function ok(msg: string): void {
    console.log(`  ✅  ${msg}`);
}

function warn(msg: string): void {
    console.log(`  ⚠️   ${msg}`);
}

function info(msg: string): void {
    console.log(`  ℹ️   ${msg}`);
}

function step(msg: string): void {
    console.log(`  │   ${msg}`);
}

function done(msg: string): void {
    console.log(`  └── ${msg}`);
}

function formatHours(value: number | null | undefined): string {
    const hours = Math.round(Number(value || 0) * 10) / 10;
    return `${hours}h`;
}

function truncateText(value: string, max = 72): string {
    const text = String(value || '').trim();
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - 3))}...`;
}

function formatAssigneeLabel(value?: string | null): string {
    return value ? truncateText(value, 28) : 'Sem responsável';
}

function formatReconcileLog(kind: string, item: ReconcileItemLog): string {
    const parts = [
        `${kind} #${item.azureId}`,
        `${truncateText(item.title)}`,
        `${item.type || 'Work Item'}`,
        `state=${item.state || 'n/a'}`,
        `remaining=${formatHours(item.remainingHours)}`,
    ];
    if (item.iterationPath) parts.push(`iteration=${truncateText(item.iterationPath, 48)}`);
    if (item.changedBy) parts.push(`changedBy=${truncateText(item.changedBy, 24)}`);
    if (item.fromAssignee !== undefined || item.toAssignee !== undefined) {
        parts.push(`${formatAssigneeLabel(item.fromAssignee)} -> ${formatAssigneeLabel(item.toAssignee)}`);
    }
    return parts.join(' | ');
}

function logIndentedList(lines: string[]): void {
    for (const line of lines) {
        step(`  ${line}`);
    }
}

// ─── Helpers de data ──────────────────────────────────────────────────────────

function toUTCDateOnly(d: Date): Date {
    const dt = new Date(d);
    dt.setUTCHours(0, 0, 0, 0);
    return dt;
}

function toUTCDateOnlyFromDate(d: Date): Date {
    const [y, m, day] = d.toISOString().split('T')[0].split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day));
}

function toBusinessDateOnlyFromDate(d: Date): Date {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: SPRINT_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(d);
    const y = Number(parts.find(p => p.type === 'year')?.value || 0);
    const m = Number(parts.find(p => p.type === 'month')?.value || 0);
    const day = Number(parts.find(p => p.type === 'day')?.value || 0);
    return new Date(Date.UTC(y, m - 1, day));
}

function getBusinessDays(start: Date, end: Date, excludeDates: Set<number>): Date[] {
    const days: Date[] = [];
    const cur = toUTCDateOnly(start);
    const endDate = toUTCDateOnly(end);
    while (cur <= endDate) {
        const day = cur.getUTCDay();
        const key = cur.getTime();
        if (day !== 0 && day !== 6 && !excludeDates.has(key)) {
            days.push(new Date(cur));
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return days;
}

function indexForDay(dayMs: number, businessDays: Date[]): number {
    if (businessDays.length === 0) return 0;
    if (dayMs <= businessDays[0].getTime()) return 0;
    if (dayMs >= businessDays[businessDays.length - 1].getTime()) return businessDays.length - 1;
    for (let i = businessDays.length - 1; i >= 0; i--) {
        if (businessDays[i].getTime() <= dayMs) return i;
    }
    return 0;
}

function parseRemaining(value: any): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function parseChangedDate(value: any): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function parseIteration(value: any): string | null {
    if (value === null || value === undefined) return null;
    return String(value).trim().toLowerCase();
}

function parseState(value: any): string | null {
    if (value === null || value === undefined) return null;
    return String(value).trim().toLowerCase();
}

function isInSprintPath(iteration: string | null | undefined, sprintPath: string): boolean {
    const it = String(iteration || '').trim().toLowerCase();
    if (!it) return false;
    const sp = String(sprintPath || '').trim().toLowerCase();
    return it === sp || it.startsWith(`${sp}\\`);
}

function isDoneLike(state?: string | null): boolean {
    return DONE_LIKE_STATES.has(String(state || '').trim().toLowerCase());
}

function isRemovedLike(state?: string | null): boolean {
    return String(state || '').trim().toLowerCase() === 'removed';
}

function isCountedInSprint(
    iteration: string | null | undefined,
    state: string | null | undefined,
    sprintPath: string
): boolean {
    return isInSprintPath(iteration, sprintPath) && !isRemovedLike(state);
}

// ─── Helpers de member lookup ─────────────────────────────────────────────────

/**
 * Resolve o ID interno de um membro a partir do objeto assignedTo do Azure.
 * Cria o membro no banco se ainda não existir (upsert seguro).
 */
async function resolveAssignedToMemberId(
    assignedRaw: any,
    projectId: string,
    prisma: PrismaClient
): Promise<string | null> {
    if (!assignedRaw) return null;

    if (typeof assignedRaw === 'object') {
        const uniqueName = assignedRaw.uniqueName ? String(assignedRaw.uniqueName) : null;
        const displayName = assignedRaw.displayName
            ? String(assignedRaw.displayName)
            : (uniqueName || 'Unknown');
        const azureIdentityId = assignedRaw.id
            ? String(assignedRaw.id)
            : (uniqueName ? String(uniqueName) : null);

        if (azureIdentityId) {
            const member = await prisma.teamMember.upsert({
                where: { azureId_projectId: { azureId: azureIdentityId, projectId } },
                create: {
                    azureId: azureIdentityId,
                    displayName,
                    uniqueName: uniqueName || displayName,
                    imageUrl: assignedRaw.imageUrl || null,
                    projectId,
                    isActive: true
                },
                update: {
                    displayName,
                    uniqueName: uniqueName || displayName,
                    imageUrl: assignedRaw.imageUrl || null,
                    isActive: true
                }
            });
            return member.id;
        }

        if (uniqueName || displayName) {
            const byIdentity = await prisma.teamMember.findFirst({
                where: {
                    projectId,
                    OR: [
                        ...(uniqueName ? [{ uniqueName }] : []),
                        ...(displayName ? [{ displayName }] : [])
                    ]
                },
                select: { id: true }
            });
            return byIdentity?.id || null;
        }

        return null;
    }

    const assignedText = String(assignedRaw).trim();
    if (!assignedText) return null;

    const byText = await prisma.teamMember.findFirst({
        where: {
            projectId,
            OR: [{ uniqueName: assignedText }, { displayName: assignedText }]
        },
        select: { id: true }
    });
    return byText?.id || null;
}

// ─── FASE 1: Smart Sync ───────────────────────────────────────────────────────

/**
 * Atualiza os dados básicos de um work item no banco de dados.
 * Preserva lastRemainingWork e doneRemainingWork para não perder histórico.
 */
async function syncBasicData(azItem: any, prisma: PrismaClient): Promise<boolean> {
    const f = azItem.fields;
    const id = azItem.id;

    const projectName = f['System.TeamProject'];
    const project = await prisma.project.findFirst({ where: { name: projectName } });
    if (!project) return false;

    const iterationPath = f['System.IterationPath'];
    const sprint = await prisma.sprint.findFirst({ where: { path: iterationPath } });

    const d = (val: any) => val ? new Date(val) : null;
    const state = (f['System.State'] || '').toString();
    const tagsRaw = String(f['System.Tags'] || '').toLowerCase();

    // Detecção de bloqueio: campo, estado, coluna do board ou tag
    const blockedFieldRaw = f['Microsoft.VSTS.Common.Blocked'];
    const blockedField = typeof blockedFieldRaw === 'boolean'
        ? blockedFieldRaw
        : ['true', 'yes', 'sim', '1'].includes(String(blockedFieldRaw || '').trim().toLowerCase());
    const blockedByState = ['blocked', 'impeded', 'impedido'].includes(state.trim().toLowerCase());
    const boardColumn = String(f['System.BoardColumn'] || '').trim().toLowerCase();
    const blockedByBoardColumn = boardColumn === 'blocked' || boardColumn.includes('imped');
    const blockedByTag = tagsRaw.includes('blocked') || tagsRaw.includes('blocker') || tagsRaw.includes('imped');
    const isBlocked = blockedField || blockedByState || blockedByBoardColumn || blockedByTag;

    const hasField = (fieldName: string) => Object.prototype.hasOwnProperty.call(f, fieldName);
    const stateLower = state.trim().toLowerCase();
    const isDoneState = stateLower === 'done' || stateLower === 'closed' || stateLower === 'completed';

    // Busca valores anteriores para preservar histórico de horas
    const existing = await prisma.workItem.findUnique({
        where: { id },
        // @ts-ignore
        select: { remainingWork: true, completedWork: true, lastRemainingWork: true, doneRemainingWork: true }
    });

    const incomingRemaining = f['Microsoft.VSTS.Scheduling.RemainingWork'];
    const incomingCompleted = f['Microsoft.VSTS.Scheduling.CompletedWork'];

    // Ausência do campo no payload não deve virar redução de escopo
    const remainingWork = hasField('Microsoft.VSTS.Scheduling.RemainingWork')
        ? Number(incomingRemaining || 0)
        : Number(existing?.remainingWork || 0);
    const completedWork = hasField('Microsoft.VSTS.Scheduling.CompletedWork')
        ? Number(incomingCompleted || 0)
        : Number(existing?.completedWork || 0);

    const previousLastRemaining = Number((existing as any)?.lastRemainingWork || 0);
    const previousDoneRemaining = Number((existing as any)?.doneRemainingWork || 0);
    const candidateRemainingForHistory = hasField('Microsoft.VSTS.Scheduling.RemainingWork')
        ? Number(incomingRemaining || 0)
        : null;
    const lastRemainingWork = candidateRemainingForHistory !== null
        ? (candidateRemainingForHistory > 0 ? candidateRemainingForHistory : previousLastRemaining)
        : previousLastRemaining;
    const doneRemainingWork = isDoneState
        ? (lastRemainingWork > 0 ? lastRemainingWork : (previousDoneRemaining || null))
        : (previousDoneRemaining || null);

    const assignedToId = await resolveAssignedToMemberId(f['System.AssignedTo'], project.id, prisma);

    await prisma.workItem.upsert({
        where: { id },
        create: {
            id,
            azureId: id,
            type: f['System.WorkItemType'],
            state,
            reason: f['System.Reason'] || null,
            title: f['System.Title'],
            description: f['System.Description'] || null,
            acceptanceCriteria: f['System.AcceptanceCriteria'] || null,
            reproSteps: f['Microsoft.VSTS.TCM.ReproSteps'] || null,
            originalEstimate: f['Microsoft.VSTS.Scheduling.OriginalEstimate'] || null,
            completedWork,
            remainingWork,
            // @ts-ignore
            lastRemainingWork,
            // @ts-ignore
            doneRemainingWork,
            storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
            priority: f['Microsoft.VSTS.Common.Priority'] || 3,
            severity: f['Microsoft.VSTS.Common.Severity'] || null,
            createdDate: d(f['System.CreatedDate'])!,
            changedDate: d(f['System.ChangedDate'])!,
            closedDate: d(f['System.ClosedDate']),
            resolvedDate: d(f['System.ResolvedDate']),
            stateChangeDate: d(f['System.StateChangeDate']),
            activatedDate: d(f['Microsoft.VSTS.Common.ActivatedDate']),
            createdBy: f['System.CreatedBy']?.displayName || 'Unknown',
            changedBy: f['System.ChangedBy']?.displayName || 'Unknown',
            isBlocked,
            tags: f['System.Tags'] ? f['System.Tags'].split(';').map((t: string) => t.trim()) : [],
            areaPath: f['System.AreaPath'],
            iterationPath: f['System.IterationPath'],
            url: azItem.url,
            rev: azItem.rev,
            projectId: project.id,
            sprintId: sprint?.id,
            assignedToId
        },
        update: {
            state,
            title: f['System.Title'],
            description: f['System.Description'] || null,
            changedDate: d(f['System.ChangedDate'])!,
            changedBy: f['System.ChangedBy']?.displayName || 'Unknown',
            completedWork,
            remainingWork,
            isBlocked,
            // @ts-ignore
            lastRemainingWork,
            // @ts-ignore
            doneRemainingWork,
            storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
            sprintId: sprint?.id,
            assignedToId,
            rev: azItem.rev
        }
    });

    return true;
}

/**
 * Atualiza o parentId de um work item com base nas relações do Azure.
 */
async function syncHierarchy(azItem: any, prisma: PrismaClient): Promise<boolean> {
    if (!azItem.relations) return false;

    const parentRel = azItem.relations.find((r: any) => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
    if (!parentRel) return false;

    const match = parentRel.url.match(/workItems\/(\d+)/);
    if (!match) return false;
    const parentAzureId = parseInt(match[1]);

    const parent = await prisma.workItem.findUnique({ where: { azureId: parentAzureId } });
    if (!parent) return false;

    await prisma.workItem.update({
        where: { id: azItem.id },
        data: { parentId: parent.id }
    });

    return true;
}

/**
 * Verifica se um work item precisa de recuperação de histórico.
 * Retorna true se initialRemainingWork ou lastRemainingWork estiverem zerados/nulos.
 */
async function checkHistoryNeeded(id: number, prisma: PrismaClient): Promise<boolean> {
    const item = await prisma.workItem.findUnique({
        where: { id },
        // @ts-ignore
        select: { initialRemainingWork: true, lastRemainingWork: true, doneRemainingWork: true, state: true }
    });

    const initial = (item as any)?.initialRemainingWork;
    const last = (item as any)?.lastRemainingWork;
    const done = (item as any)?.doneRemainingWork;
    const state = ((item as any)?.state || '').toLowerCase();
    const isDone = state === 'done' || state === 'closed' || state === 'completed';

    return (
        initial === null || initial === 0 ||
        last === null || last === 0 ||
        (isDone && (done === null || done === 0))
    );
}

/**
 * Recupera o histórico de horas de um work item buscando as revisões no Azure.
 * Reconstrói: initialRemainingWork, lastRemainingWork, doneRemainingWork, closedDate.
 *
 * @param currentFields - campos do item já carregados (evita chamada extra ao Azure)
 */
async function recoverHistory(
    id: number,
    witApi: any,
    prisma: PrismaClient,
    currentFields?: Record<string, any>
): Promise<boolean> {
    try {
        const revisions = await witApi.getRevisions(id);
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

            // Captura a data de fechamento: primeira transição para estado done
            if (isDone && !closedDate && previousState !== state && changedDate) {
                closedDate = new Date(changedDate);
            }

            if (isDone && doneRemainingWork === 0) {
                if (remaining !== undefined && remaining > 0) {
                    doneRemainingWork = remaining;
                } else if (lastNonZeroRemaining > 0) {
                    doneRemainingWork = lastNonZeroRemaining;
                }
            }

            previousState = state;
        }

        // Fallback: usa os campos já carregados do item (evita chamada extra ao Azure)
        const f = currentFields || {};
        const currentRemaining = Number(f['Microsoft.VSTS.Scheduling.RemainingWork'] || 0);
        const currentCompleted = Number(f['Microsoft.VSTS.Scheduling.CompletedWork'] || 0);
        const currentState = (f['System.State'] || '').toString().toLowerCase();

        if (!foundInitial) {
            initialRemainingWork = currentRemaining + currentCompleted;
        }

        if (!lastRemainingWork) {
            lastRemainingWork = lastNonZeroRemaining || currentRemaining;
        }

        if (!doneRemainingWork) {
            const isDone = currentState === 'done' || currentState === 'closed' || currentState === 'completed';
            if (isDone) {
                doneRemainingWork = currentRemaining > 0
                    ? currentRemaining
                    : (lastNonZeroRemaining > 0 ? lastNonZeroRemaining : currentCompleted);
            }
        }

        const updateData: any = { initialRemainingWork, lastRemainingWork, doneRemainingWork };
        if (closedDate) updateData.closedDate = closedDate;

        await prisma.workItem.update({ where: { id }, data: updateData });
        return true;
    } catch (e) {
        // silencioso: item pode não existir mais ou sem acesso
    }
    return false;
}

/**
 * FASE 1: Smart Sync
 * Busca itens alterados no Azure desde o último sync e os atualiza no banco.
 */
async function runSmartSync(
    witApi: any,
    prisma: PrismaClient,
    azureProject: string | undefined,
    startTime: number
): Promise<SmartSyncStats> {
    const stats: SmartSyncStats = {
        evaluated: 0,
        basicUpdated: 0,
        hierarchyUpdated: 0,
        historyRecovered: 0,
        errors: 0,
        skipped: false,
        affectedSprintIds: []
    };

    // Cache de sprint por iterationPath para evitar queries repetidas por item
    const sprintPathCache = new Map<string, string | null>();
    const affectedSprintIds = new Set<string>();

    // Determina o ponto de partida: início (startedAt) do último sync bem-sucedido.
    // Usamos startedAt — não completedAt — para evitar gaps:
    // itens que mudam DURANTE a execução do sync anterior não são capturados pelo
    // WiQL daquele sync (que já rodou). Ao reutilizar o startedAt, o próximo sync
    // os captura. O pequeno reprocessamento de sobreposição é seguro (upserts).
    const lastSync = await prisma.syncLog.findFirst({
        where: {
            status: 'completed',
            OR: [
                { syncType: 'incremental_sync' },
                { syncType: 'smart_sync' },
                { syncType: 'core_pipeline' }
            ]
        },
        orderBy: { startedAt: 'desc' }
    });

    // Padrão: 25h atrás se nunca houve sync (primeira execução)
    const since = lastSync?.startedAt || new Date(Date.now() - 25 * 60 * 60 * 1000);
    const sinceLabel = since.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    step(`Buscando itens alterados desde: ${sinceLabel}`);

    // WiQL: busca IDs de todos os itens alterados desde a data/hora de corte.
    // Formato ISO completo (ex: '2026-02-27T21:10:13.000Z') garante que o filtro
    // use data E hora — sem isso, '2026-02-27' seria '2026-02-27 00:00:00' e
    // todos os itens do dia voltariam a cada execução.
    const formattedDate = since.toISOString(); // '2026-02-27T21:10:13.000Z'
    const wiql = {
        query: `
            SELECT [System.Id]
            FROM WorkItems
            WHERE [System.ChangedDate] >= '${formattedDate}'
            ORDER BY [System.ChangedDate] DESC
        `
    };

    const teamContext = azureProject ? { project: azureProject } : undefined;

    let result: any;
    try {
        result = await witApi.queryByWiql(wiql, teamContext);
    } catch (wiqlErr: any) {
        // Alguns tenants rejeitam datetime com horário no WiQL — cai de volta para data-only
        if (wiqlErr.message?.includes('time') || wiqlErr.message?.includes('date')) {
            const dateFallback = since.toISOString().slice(0, 10);
            warn(`WiQL com horário rejeitado — usando fallback data-only: ${dateFallback}`);
            result = await witApi.queryByWiql(
                { query: `SELECT [System.Id] FROM WorkItems WHERE [System.ChangedDate] >= '${dateFallback}' ORDER BY [System.ChangedDate] DESC` },
                teamContext
            );
        } else {
            throw wiqlErr;
        }
    }

    const changedIds = result.workItems
        ?.map((wi: any) => wi.id)
        .filter((id: any): id is number => typeof id === 'number') || [];

    if (changedIds.length === 0) {
        ok('Nenhuma alteração encontrada no Azure DevOps');
        stats.skipped = true;
        return stats;
    }

    step(`${changedIds.length} work items retornados pelo WiQL — filtrando por data+hora e processando:`);

    // Busca em lotes de 50 (1 chamada API por lote), processa e exibe item a item
    const BATCH = 50;
    const totalBatches = Math.ceil(changedIds.length / BATCH);
    let itemIndex = 0;

    for (let i = 0; i < changedIds.length; i += BATCH) {
        const batchIds = changedIds.slice(i, i + BATCH);
        const batchNum = Math.floor(i / BATCH) + 1;

        step(`--- Lote ${batchNum}/${totalBatches} ---`);

        // Busca detalhes do lote com relações (para hierarquia pai/filho)
        const azureItems = await witApi.getWorkItems(batchIds, undefined, undefined, 1);

        for (const azItem of azureItems) {
            if (!azItem.id) continue;

            // Filtro fino por data+hora: o WiQL só filtra por data (sem hora),
            // então itens que mudaram antes de `since` no mesmo dia são excluídos aqui.
            const itemChangedDate = azItem.fields?.['System.ChangedDate'];
            if (itemChangedDate && new Date(itemChangedDate) < since) {
                continue; // mudou antes do corte — já foi processado na execução anterior
            }

            itemIndex++;
            stats.evaluated++;

            const tipo   = String(azItem.fields?.['System.WorkItemType'] || '').padEnd(5).slice(0, 5);
            const estado = String(azItem.fields?.['System.State'] || '').slice(0, 14);
            const titulo = String(azItem.fields?.['System.Title'] || '').slice(0, 45);
            const prefixo = `  │   [${String(itemIndex).padStart(3)}/?] #${azItem.id}`;
            const tags: string[] = [];

            try {
                const basicOk = await syncBasicData(azItem, prisma);
                if (basicOk) {
                    stats.basicUpdated++;
                    tags.push('dados');

                    // Rastreia nova sprint do item (iterationPath atualizado)
                    const iterPath = String(azItem.fields?.['System.IterationPath'] || '');
                    if (iterPath) {
                        if (!sprintPathCache.has(iterPath)) {
                            const sp = await prisma.sprint.findFirst({ where: { path: iterPath }, select: { id: true } });
                            sprintPathCache.set(iterPath, sp?.id ?? null);
                        }
                        const sprintId = sprintPathCache.get(iterPath);
                        if (sprintId) affectedSprintIds.add(sprintId);
                    }
                }

                const hierOk = await syncHierarchy(azItem, prisma);
                if (hierOk) { stats.hierarchyUpdated++; tags.push('hierarquia'); }

                // Recupera histórico somente se campos estiverem faltando
                // (item já veio do WiQL de alterados — a checagem é sempre legítima)
                const needsHistory = await checkHistoryNeeded(azItem.id, prisma);
                if (needsHistory) {
                    // Avisa que está buscando revisões (pode demorar)
                    console.log(`${prefixo} — buscando histórico de revisões...`);
                    // Passa os campos já carregados para evitar chamada extra ao Azure
                    const histOk = await recoverHistory(azItem.id, witApi, prisma, azItem.fields);
                    if (histOk) { stats.historyRecovered++; tags.push('histórico'); }
                    console.log(`${prefixo} ✅ ${tipo} | ${estado} | ${titulo} [${tags.join(' + ')}]`);
                } else {
                    console.log(`${prefixo} ✅ ${tipo} | ${estado} | ${titulo} [${tags.join(' + ')}]`);
                }
            } catch (err: any) {
                stats.errors++;
                console.log(`${prefixo} ❌ erro: ${String(err.message || err).slice(0, 60)}`);
            }
        }
    }

    const skippedByFilter = changedIds.length - stats.evaluated;
    if (skippedByFilter > 0) {
        step(`${skippedByFilter} item(s) ignorados (mudaram antes de ${sinceLabel} — filtro data+hora)`);
    }

    stats.affectedSprintIds = Array.from(affectedSprintIds);
    if (affectedSprintIds.size > 0) {
        step(`${affectedSprintIds.size} sprint(s) afetada(s) — serão reconstruídas na Fase 3`);
    }

    // Registra o sync no log para referência futura
    try {
        const duration = Math.floor((Date.now() - startTime) / 1000);
        await prisma.syncLog.create({
            data: {
                syncType: 'core_pipeline',
                status: 'completed',
                startedAt: new Date(startTime),
                completedAt: new Date(),
                duration,
                itemsProcessed: stats.evaluated,
                itemsUpdated: stats.basicUpdated + stats.hierarchyUpdated + stats.historyRecovered,
                metadata: stats as any,
            }
        });
    } catch {
        // Falha no log não deve parar o sync
    }

    return stats;
}

// ─── FASE 2: Reconcile Sprints Ativas ────────────────────────────────────────

/**
 * Busca IDs de work items de uma sprint via WiQL direto (sem depender do service layer).
 */
async function getSprintWorkItemIds(sprintPath: string, witApi: any): Promise<Set<number>> {
    const wiql = `
        SELECT [System.Id]
        FROM WorkItems
        WHERE [System.IterationPath] = '${sprintPath}'
        AND [System.WorkItemType] IN ('Product Backlog Item', 'Bug', 'Task', 'Feature', 'User Story')
        ORDER BY [System.Id]
    `;

    try {
        const result = await witApi.queryByWiql({ query: wiql });
        const ids = result.workItems
            ?.map((wi: any) => wi.id)
            .filter((id: any): id is number => typeof id === 'number') || [];
        return new Set(ids);
    } catch {
        return new Set();
    }
}

/**
 * FASE 2: Reconcile Sprints Ativas
 * Para cada sprint ativa: detecta itens removidos, reativados e reatribuídos.
 */
async function runReconcile(witApi: any, prisma: PrismaClient): Promise<ReconcileStats> {
    const stats: ReconcileStats = {
        sprintsProcessed: 0,
        markedRemoved: 0,
        reactivated: 0,
        reassigned: 0,
        errors: 0
    };

    const activeSprints = await prisma.sprint.findMany({
        where: { state: { in: ['active', 'Active'] } },
        include: { project: { select: { id: true, name: true } } },
    });

    if (!activeSprints.length) {
        info('Nenhuma sprint ativa encontrada para reconciliar');
        return stats;
    }

    step(`${activeSprints.length} sprint(s) ativa(s) para reconciliar`);

    for (const sprint of activeSprints) {
        try {
            // Busca IDs atuais no Azure para esta sprint
            const azureIdSet = await getSprintWorkItemIds(sprint.path, witApi);

            // Busca itens locais desta sprint
            const localItems = await prisma.workItem.findMany({
                where: { sprintId: sprint.id },
                select: {
                    id: true,
                    azureId: true,
                    title: true,
                    type: true,
                    state: true,
                    iterationPath: true,
                    isRemoved: true,
                    assignedToId: true,
                    remainingWork: true,
                    lastRemainingWork: true,
                    changedBy: true,
                    assignedTo: { select: { displayName: true, uniqueName: true } },
                },
            });
            const localByAzureId = new Map(localItems.map((item: any) => [item.azureId, item]));
            const removedLogs: ReconcileItemLog[] = [];
            const reactivatedLogs: ReconcileItemLog[] = [];
            const reassignedLogs: ReconcileItemLog[] = [];

            // Identifica remoções e reativações
            const removedItems = localItems
                .filter((w: any) => !w.isRemoved && !azureIdSet.has(w.azureId))
            const toMarkRemoved = removedItems.map((w: any) => w.id);

            const reactivatedItems = localItems
                .filter((w: any) => w.isRemoved && azureIdSet.has(w.azureId))
            const toReactivate = reactivatedItems.map((w: any) => w.id);

            if (toMarkRemoved.length) {
                await prisma.workItem.updateMany({
                    where: { id: { in: toMarkRemoved } },
                    data: { isRemoved: true, lastSyncAt: new Date() },
                });
                stats.markedRemoved += toMarkRemoved.length;
                removedLogs.push(
                    ...removedItems.map((item: any) => ({
                        azureId: item.azureId,
                        title: item.title || `#${item.azureId}`,
                        type: item.type || '',
                        state: item.state || '',
                        iterationPath: item.iterationPath || '',
                        remainingHours: Math.max(0, Number(item.remainingWork ?? item.lastRemainingWork ?? 0)),
                        changedBy: item.changedBy || undefined,
                    }))
                );
            }

            if (toReactivate.length) {
                await prisma.workItem.updateMany({
                    where: { id: { in: toReactivate } },
                    data: { isRemoved: false, lastSyncAt: new Date() },
                });
                stats.reactivated += toReactivate.length;
                reactivatedLogs.push(
                    ...reactivatedItems.map((item: any) => ({
                        azureId: item.azureId,
                        title: item.title || `#${item.azureId}`,
                        type: item.type || '',
                        state: item.state || '',
                        iterationPath: item.iterationPath || '',
                        remainingHours: Math.max(0, Number(item.remainingWork ?? item.lastRemainingWork ?? 0)),
                        changedBy: item.changedBy || undefined,
                    }))
                );
            }

            // Verifica reatribuições: busca detalhes dos itens presentes no Azure
            if (azureIdSet.size > 0) {
                const azureIdsArr = Array.from(azureIdSet).slice(0, 200); // limite seguro
                const azureItems = await witApi.getWorkItems(azureIdsArr, [
                    'System.Id', 'System.AssignedTo'
                ]);

                for (const azItem of (azureItems || [])) {
                    if (!azItem?.id) continue;
                    const local = localByAzureId.get(azItem.id);
                    if (!local) continue;

                    const assignedToId = await resolveAssignedToMemberId(
                        azItem.fields?.['System.AssignedTo'],
                        sprint.project.id,
                        prisma
                    );

                    if (local.assignedToId !== assignedToId) {
                        const previousAssignee = local.assignedTo?.displayName || local.assignedTo?.uniqueName || null;
                        const nextAssignee = azItem.fields?.['System.AssignedTo']?.displayName
                            || azItem.fields?.['System.AssignedTo']?.uniqueName
                            || null;
                        await prisma.workItem.update({
                            where: { id: local.id },
                            data: { assignedToId, lastSyncAt: new Date() }
                        });
                        stats.reassigned++;
                        reassignedLogs.push({
                            azureId: local.azureId,
                            title: local.title || `#${local.azureId}`,
                            type: local.type || '',
                            state: local.state || '',
                            iterationPath: local.iterationPath || '',
                            remainingHours: Math.max(0, Number(local.remainingWork ?? local.lastRemainingWork ?? 0)),
                            changedBy: local.changedBy || undefined,
                            fromAssignee: previousAssignee,
                            toAssignee: nextAssignee,
                        });
                    }
                }
            }

            stats.sprintsProcessed++;

            step(
                `${sprint.project.name} / ${sprint.name}: ` +
                `Azure=${azureIdSet.size} | Local=${localItems.length} | ` +
                `-${toMarkRemoved.length} removidos | +${toReactivate.length} reativados`
            );
            if (removedLogs.length) {
                logIndentedList(removedLogs.map((item) => formatReconcileLog('REMOVED', item)));
            }
            if (reactivatedLogs.length) {
                logIndentedList(reactivatedLogs.map((item) => formatReconcileLog('REACTIVATED', item)));
            }
            if (reassignedLogs.length) {
                logIndentedList(reassignedLogs.map((item) => formatReconcileLog('REASSIGNED', item)));
            }

        } catch (err: any) {
            warn(`Erro ao reconciliar sprint ${sprint.name}: ${err.message}`);
            stats.errors++;
        }
    }

    return stats;
}

// ─── FASE 3: Rebuild Burndown (Event Model) ───────────────────────────────────

/**
 * FASE 3: Rebuild Burndown (Event Model)
 * Reconstrói snapshots a partir do histórico de revisões do Azure para:
 *   - Sprints ativas: todas (rebuildAll) ou apenas as afetadas (incremental)
 *   - Sprints passadas (Past): apenas as que tiveram itens alterados no sync atual
 *
 * Para sprints passadas, aplica o loop after-sprint: itens concluídos ou com
 * horas alteradas após o encerramento são acumulados no último dia (D_last).
 */
async function runRebuildBurndown(
    witApi: any,
    prisma: PrismaClient,
    affectedSprintIds: Set<string>,
    rebuildAll: boolean
): Promise<BurndownStats> {
    const stats: BurndownStats = {
        sprintsRebuilt: 0,
        snapshotsCreated: 0,
        outcomesCreated: 0,
        errors: 0
    };

    // Sprints ativas
    const activeSprints = await prisma.sprint.findMany({
        where: { state: { in: ['Active', 'active'] } },
        include: {
            project: true,
            capacities: { select: { daysOff: true } },
        },
        orderBy: [{ project: { name: 'asc' } }, { startDate: 'asc' }],
    });

    // Sprints passadas (Past) que tiveram itens alterados — sem limite de dias
    const pastSprints = affectedSprintIds.size > 0
        ? await prisma.sprint.findMany({
            where: {
                state: { in: ['Past', 'past'] },
                id: { in: Array.from(affectedSprintIds) },
            },
            include: {
                project: true,
                capacities: { select: { daysOff: true } },
            },
            orderBy: [{ project: { name: 'asc' } }, { startDate: 'asc' }],
        })
        : [];

    if (!activeSprints.length && !pastSprints.length) {
        info('Nenhuma sprint encontrada para rebuild de burndown');
        return stats;
    }

    // Filtro incremental para sprints ativas; Past sempre vêm de affectedSprintIds
    const activeToRebuild = rebuildAll
        ? activeSprints
        : activeSprints.filter(s => affectedSprintIds.has(s.id));

    const sprintsToRebuild = [...activeToRebuild, ...pastSprints];

    if (!sprintsToRebuild.length) {
        info('Nenhuma sprint afetada — rebuild pulado');
        return stats;
    }

    step(`${sprintsToRebuild.length} sprint(s) para rebuild (${activeToRebuild.length} ativa(s) + ${pastSprints.length} passada(s))`);

    let sprintIdx = 0;
    for (const sprint of sprintsToRebuild) {
        if (!sprint.startDate || !sprint.endDate) continue;

        sprintIdx++;
        const sprintCounter = `[${sprintIdx}/${sprintsToRebuild.length}]`;
        const sprintTag = String((sprint as any).state || '').toLowerCase() === 'past' ? '[PAST] ' : '';
        const sprintProgressLabel = `${sprintCounter} ${sprintTag}${sprint.project.name} / ${sprint.name}`;
        const sprintStartMs = Date.now();

        try {
            step(`⏳ ${sprintProgressLabel}...`);

            // Remove snapshots e outcomes antigos desta sprint
            await prisma.sprintSnapshot.deleteMany({ where: { sprintId: sprint.id } });
            await prisma.sprintItemOutcome.deleteMany({ where: { sprintId: sprint.id } });

            // Calcula dias de folga do time (interseção de todos os membros)
            const memberDaySets: Array<Set<number>> = sprint.capacities.map((cap: any) => {
                const memberSet = new Set<number>();
                const ranges = (cap.daysOff as any[]) || [];
                for (const d of ranges) {
                    if (!d?.start || !d?.end) continue;
                    const start = toUTCDateOnlyFromDate(new Date(d.start));
                    const end = toUTCDateOnlyFromDate(new Date(d.end));
                    for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                        const day = dt.getUTCDay();
                        if (day !== 0 && day !== 6) {
                            memberSet.add(dt.getTime());
                        }
                    }
                }
                return memberSet;
            });

            // Dias excluídos = interseção (folga de TODOS os membros = folga do time)
            let excludeDates = new Set<number>();
            if (memberDaySets.length > 0) {
                excludeDates = new Set<number>(memberDaySets[0]);
                for (let i = 1; i < memberDaySets.length; i++) {
                    excludeDates = new Set(
                        Array.from(excludeDates).filter((dayMs) => memberDaySets[i].has(dayMs))
                    );
                }
            }

            const isSprintPast = String((sprint as any).state || '').toLowerCase() === 'past';

            const sprintStart = toUTCDateOnlyFromDate(new Date(sprint.startDate));
            const sprintEnd = toUTCDateOnlyFromDate(new Date(sprint.endDate));
            const today = toUTCDateOnlyFromDate(new Date());
            // Sprint passada: usa o endDate real; ativa: limita ao dia atual
            const effectiveEnd = isSprintPast ? sprintEnd : (sprintEnd.getTime() > today.getTime() ? today : sprintEnd);

            // Limite exclusivo para separar eventos "durante a sprint" dos "após"
            const sprintEndExclusive = new Date(sprintEnd);
            sprintEndExclusive.setUTCDate(sprintEndExclusive.getUTCDate() + 1);
            const sprintEndExclusiveMs = sprintEndExclusive.getTime();

            if (effectiveEnd.getTime() < sprintStart.getTime()) continue;

            const businessDays = getBusinessDays(sprintStart, effectiveEnd, excludeDates);
            if (!businessDays.length) continue;

            const firstDayMs = businessDays[0].getTime();

            // Busca work items da sprint (incluindo removidos para capturar retiradas de escopo)
            const workItems = await prisma.workItem.findMany({
                where: { sprintId: sprint.id },
                select: {
                    id: true, azureId: true, title: true, type: true, state: true, isBlocked: true,
                    isRemoved: true, createdDate: true, changedDate: true, activatedDate: true,
                    closedDate: true, iterationPath: true, remainingWork: true, completedWork: true,
                    initialRemainingWork: true, lastRemainingWork: true, doneRemainingWork: true,
                    originalEstimate: true,
                },
            }) as any[];

            const scopedItems = workItems.filter((w: any) =>
                ALLOWED_BURNDOWN_TYPES.has(String(w.type || '').toLowerCase())
            );

            // Acumuladores por dia útil
            let baselineInitial = 0;
            let baselineContributors = 0;
            const scopeDeltaByDay = new Array<number>(businessDays.length).fill(0);
            const scopeAddedByDay = new Array<number>(businessDays.length).fill(0);
            const scopeRemovedByDay = new Array<number>(businessDays.length).fill(0);
            const completedByDay = new Array<number>(businessDays.length).fill(0);
            const outcomeRows: Array<Record<string, any>> = [];
            const outcomeLogRows: SprintOutcomeLogRow[] = [];

            // Processa cada item buscando revisões do Azure
            for (const item of scopedItems) {
                const revisions = await witApi.getRevisions(item.azureId) as any[];
                if (!revisions?.length) continue;

                const sorted = [...revisions].sort((a, b) => {
                    const ad = parseChangedDate(a.fields?.['System.ChangedDate'])?.getTime() || 0;
                    const bd = parseChangedDate(b.fields?.['System.ChangedDate'])?.getTime() || 0;
                    return ad - bd;
                });

                // Estado do item antes do D1 (para calcular baseline D0)
                let prevRemaining: number | null = null;
                let prevState: string | null = null;
                let prevIteration: string | null = null;
                let itemCompleted = 0;
                let hadRemainingBeforeD1 = false;
                let hadIterationBeforeD1 = false;

                for (const rev of sorted) {
                    const changed = parseChangedDate(rev.fields?.['System.ChangedDate']);
                    if (!changed) continue;
                    const dayMs = toBusinessDateOnlyFromDate(changed).getTime();
                    if (dayMs >= firstDayMs) break;

                    const rem = parseRemaining(rev.fields?.['Microsoft.VSTS.Scheduling.RemainingWork']);
                    const st = parseState(rev.fields?.['System.State']);
                    const it = parseIteration(rev.fields?.['System.IterationPath']);

                    if (rem !== null) { prevRemaining = rem; hadRemainingBeforeD1 = true; }
                    if (st) prevState = st;
                    if (it) { prevIteration = it; hadIterationBeforeD1 = true; }
                }

                if (prevRemaining === null) prevRemaining = 0;
                if (!prevState) prevState = parseState(item.state) || '';
                if (!prevIteration) prevIteration = parseIteration(item.iterationPath) || sprint.path.toLowerCase();

                const createdBeforeD1 = item.createdDate
                    ? toUTCDateOnlyFromDate(new Date(item.createdDate)).getTime() < firstDayMs
                    : false;
                const wasInSprintBeforeD1 = createdBeforeD1 && hadIterationBeforeD1 && isCountedInSprint(prevIteration, prevState, sprint.path);

                const plannedInitialHours = wasInSprintBeforeD1 && hadRemainingBeforeD1
                    ? Math.max(0, Number(prevRemaining || 0))
                    : 0;

                if (wasInSprintBeforeD1 && hadRemainingBeforeD1 && (prevRemaining || 0) > 0) {
                    baselineInitial += Number(prevRemaining || 0);
                    baselineContributors++;
                }

                // Variáveis de outcome por item
                let itemScopeAdded = 0;
                let itemScopeRemoved = 0;
                let itemCompletedInSprint = 0;
                let itemEnteredAfterD0 = false;
                let itemLeftDuringSprint = false;
                let itemRemovedByStateInSprint = false;
                let itemLastScopeEventDate: Date | null = null;

                // Processa revisões a partir do D1 até o fim da sprint (exclusive para sprints Past)
                for (const rev of sorted) {
                    const changed = parseChangedDate(rev.fields?.['System.ChangedDate']);
                    if (!changed) continue;
                    // Para sprints passadas: ignora revisões após o encerramento (tratadas no loop after-sprint)
                    if (isSprintPast && changed.getTime() >= sprintEndExclusiveMs) continue;
                    const dayMs = toBusinessDateOnlyFromDate(changed).getTime();
                    if (dayMs < firstDayMs) continue;

                    const idx = indexForDay(dayMs, businessDays);
                    const currentState: string = parseState(rev.fields?.['System.State']) || prevState || '';
                    const currentIteration: string = parseIteration(rev.fields?.['System.IterationPath']) || prevIteration || '';
                    const remField = parseRemaining(rev.fields?.['Microsoft.VSTS.Scheduling.RemainingWork']);
                    let currentRemaining: number = remField !== null ? remField : (prevRemaining || 0);

                    // Em estados done, remaining ausente = 0
                    if (remField === null && isDoneLike(currentState)) currentRemaining = 0;

                    const previousRemaining = prevRemaining || 0;
                    const prevInSprint = isCountedInSprint(prevIteration, prevState, sprint.path);
                    const currentInSprint = isCountedInSprint(currentIteration, currentState, sprint.path);
                    const crossedIntoSprint = !prevInSprint && currentInSprint;
                    const crossedOutOfSprint = prevInSprint && !currentInSprint;
                    const removedInsideSprint = isInSprintPath(currentIteration, sprint.path)
                        && !isRemovedLike(prevState)
                        && isRemovedLike(currentState);

                    if (crossedIntoSprint) {
                        if (createdBeforeD1 && !hadIterationBeforeD1) {
                            prevRemaining = currentRemaining;
                            prevState = currentState;
                            prevIteration = currentIteration;
                            continue;
                        }
                        const enteringTotal = Math.max(0, currentRemaining + itemCompleted);
                        if (enteringTotal > 0) {
                            scopeDeltaByDay[idx] += enteringTotal;
                            scopeAddedByDay[idx] += enteringTotal;
                            itemScopeAdded += enteringTotal;
                            itemLastScopeEventDate = changed;
                        }
                        itemEnteredAfterD0 = true;
                        if (itemCompleted > 0) completedByDay[idx] += itemCompleted;

                    } else if (crossedOutOfSprint) {
                        const leavingTotal = Math.max(0, currentRemaining + itemCompleted);
                        if (leavingTotal > 0) {
                            scopeDeltaByDay[idx] -= leavingTotal;
                            scopeRemovedByDay[idx] += leavingTotal;
                            itemScopeRemoved += leavingTotal;
                            itemLastScopeEventDate = changed;
                        }
                        itemLeftDuringSprint = true;
                        if (removedInsideSprint) itemRemovedByStateInSprint = true;
                        if (itemCompleted > 0) completedByDay[idx] -= itemCompleted;

                    } else if (currentInSprint || prevInSprint) {
                        const completionEvent = previousRemaining > 0 && currentRemaining === 0;
                        if (completionEvent) {
                            completedByDay[idx] += previousRemaining;
                            itemCompleted += previousRemaining;
                            itemCompletedInSprint += previousRemaining;
                        } else if (previousRemaining === 0 && currentRemaining > 0 && itemCompleted > 0) {
                            const debit = Math.min(itemCompleted, currentRemaining);
                            if (debit > 0) {
                                completedByDay[idx] -= debit;
                                itemCompleted -= debit;
                                itemCompletedInSprint = Math.max(0, itemCompletedInSprint - debit);
                            }
                        }

                        if (remField !== null) {
                            const delta = currentRemaining - previousRemaining;
                            if (!(completionEvent && delta < 0)) {
                                scopeDeltaByDay[idx] += delta;
                                if (delta > 0) {
                                    scopeAddedByDay[idx] += delta;
                                    itemScopeAdded += delta;
                                    itemLastScopeEventDate = changed;
                                } else if (delta < 0) {
                                    scopeRemovedByDay[idx] += Math.abs(delta);
                                    itemScopeRemoved += Math.abs(delta);
                                    itemLastScopeEventDate = changed;
                                }
                            }
                        }
                    }

                    prevRemaining = currentRemaining;
                    prevState = currentState;
                    prevIteration = currentIteration;
                }

                // Calcula estado final do item na sprint e registra outcome
                const inSprintAtEnd = isCountedInSprint(prevIteration, prevState, sprint.path);
                const remainingAtSprintEndHours = inSprintAtEnd ? Math.max(0, Number(prevRemaining || 0)) : 0;

                // ── After-sprint tracking (apenas sprints encerradas) ──────────────
                // Itens que ficaram na sprint com horas restantes e foram concluídos
                // ou alterados após o encerramento acumulam no último dia (D_last).
                let completedAfterSprintHours = 0;
                let scopeAddedAfterSprintHours = 0;
                let scopeRemovedAfterSprintHours = 0;
                let doneAfterSprintDate: Date | null = null;

                if (isSprintPast && inSprintAtEnd && remainingAtSprintEndHours > 0) {
                    let aPrevRemaining = prevRemaining;
                    let aPrevState = prevState;
                    let aPrevIteration = prevIteration;

                    for (const rev of sorted) {
                        const changed = parseChangedDate(rev.fields?.['System.ChangedDate']);
                        if (!changed || changed.getTime() < sprintEndExclusiveMs) continue;

                        const currentState: string = parseState(rev.fields?.['System.State']) || aPrevState || '';
                        const currentIteration: string = parseIteration(rev.fields?.['System.IterationPath']) || aPrevIteration || '';
                        const remField = parseRemaining(rev.fields?.['Microsoft.VSTS.Scheduling.RemainingWork']);
                        let currentRemaining: number = remField !== null ? remField : (aPrevRemaining || 0);
                        if (remField === null && isDoneLike(currentState)) currentRemaining = 0;

                        const previousRemaining = aPrevRemaining || 0;
                        const prevInSprintA = isCountedInSprint(aPrevIteration, aPrevState, sprint.path);
                        const currentInSprint = isCountedInSprint(currentIteration, currentState, sprint.path);
                        const completionEvent = previousRemaining > 0 && currentRemaining === 0 && currentInSprint;

                        if (completionEvent) {
                            completedAfterSprintHours += previousRemaining;
                            if (!doneAfterSprintDate && isDoneLike(currentState)) {
                                doneAfterSprintDate = changed;
                            }
                        } else if (previousRemaining === 0 && currentRemaining > 0 && completedAfterSprintHours > 0 && currentInSprint) {
                            // Reabertura: debita do total concluído após sprint
                            const debit = Math.min(completedAfterSprintHours, currentRemaining);
                            completedAfterSprintHours = Math.max(0, completedAfterSprintHours - debit);
                        }

                        if (currentInSprint && remField !== null) {
                            const delta = currentRemaining - previousRemaining;
                            if (!(completionEvent && delta < 0)) {
                                if (delta > 0) scopeAddedAfterSprintHours += delta;
                                else if (delta < 0) scopeRemovedAfterSprintHours += Math.abs(delta);
                            }
                        }

                        aPrevRemaining = currentRemaining;
                        aPrevState = currentState;
                        aPrevIteration = currentIteration;

                        // Para quando o item sai da sprint (movido para outra)
                        if (prevInSprintA && !currentInSprint) break;
                    }

                    // Acumula no último dia útil da sprint (D_last)
                    if (businessDays.length > 0) {
                        const lastIdx = businessDays.length - 1;
                        if (scopeAddedAfterSprintHours > 0 || scopeRemovedAfterSprintHours > 0) {
                            scopeDeltaByDay[lastIdx] += scopeAddedAfterSprintHours - scopeRemovedAfterSprintHours;
                            scopeAddedByDay[lastIdx] += scopeAddedAfterSprintHours;
                            scopeRemovedByDay[lastIdx] += scopeRemovedAfterSprintHours;
                            itemScopeAdded += scopeAddedAfterSprintHours;
                            itemScopeRemoved += scopeRemovedAfterSprintHours;
                        }
                        if (completedAfterSprintHours > 0) {
                            completedByDay[lastIdx] += completedAfterSprintHours;
                        }
                    }
                }

                outcomeRows.push({
                    sprintId: sprint.id,
                    workItemId: item.id,
                    plannedInitialHours: Math.round(plannedInitialHours * 10) / 10,
                    scopeAddedHours: Math.round(itemScopeAdded * 10) / 10,
                    scopeRemovedHours: Math.round(itemScopeRemoved * 10) / 10,
                    scopeAddedAfterSprintHours: Math.round(scopeAddedAfterSprintHours * 10) / 10,
                    scopeRemovedAfterSprintHours: Math.round(scopeRemovedAfterSprintHours * 10) / 10,
                    completedInSprintHours: Math.round(itemCompletedInSprint * 10) / 10,
                    completedAfterSprintHours: Math.round(completedAfterSprintHours * 10) / 10,
                    remainingAtSprintEndHours: Math.round(remainingAtSprintEndHours * 10) / 10,
                    wasInSprintAtD0: wasInSprintBeforeD1,
                    enteredAfterD0: itemEnteredAfterD0,
                    leftDuringSprint: itemLeftDuringSprint,
                    inSprintAtEnd,
                    doneAfterSprint: completedAfterSprintHours > 0,
                    doneAfterSprintDate,
                    lastScopeEventDate: itemLastScopeEventDate,
                });
                outcomeLogRows.push({
                    azureId: item.azureId,
                    title: item.title || `#${item.azureId}`,
                    type: item.type || '',
                    scopeAddedHours: Math.round(itemScopeAdded * 10) / 10,
                    scopeRemovedHours: Math.round(itemScopeRemoved * 10) / 10,
                    completedInSprintHours: Math.round(itemCompletedInSprint * 10) / 10,
                    enteredAfterD0: itemEnteredAfterD0,
                    leftDuringSprint: itemLeftDuringSprint,
                    removedByStateInSprint: itemRemovedByStateInSprint,
                    inSprintAtEnd,
                    lastScopeEventDate: itemLastScopeEventDate,
                });
            }

            // Fallback: usa totalPlannedHours se não houver dados históricos suficientes
            if (baselineInitial <= 0) {
                const sprintPlanned = Number((sprint as any).totalPlannedHours || 0);
                if (Number.isFinite(sprintPlanned) && sprintPlanned > 0) {
                    baselineInitial = sprintPlanned;
                }
            }
            baselineInitial = Math.max(0, Math.round(baselineInitial));

            // Calcula remaining real e ideal por dia
            const realRemainingByDay = new Array<number>(businessDays.length).fill(0);
            const totalWorkByDay = new Array<number>(businessDays.length).fill(0);
            let scopeAccum = baselineInitial;
            let realCursor = baselineInitial;

            for (let i = 0; i < businessDays.length; i++) {
                scopeAccum += scopeDeltaByDay[i];
                scopeAccum = Math.max(0, scopeAccum);
                realCursor = Math.max(0, realCursor + scopeDeltaByDay[i] - completedByDay[i]);
                totalWorkByDay[i] = Math.round(scopeAccum);
                realRemainingByDay[i] = Math.round(realCursor);
            }

            // Linha ideal piecewise (ajusta conforme scope muda)
            const idealByDay = new Array<number>(businessDays.length).fill(0);
            let idealCursor = baselineInitial;
            if (businessDays.length > 0) idealByDay[0] = Math.round(Math.max(0, idealCursor));
            for (let i = 1; i < businessDays.length; i++) {
                idealCursor = Math.max(0, idealCursor + scopeDeltaByDay[i]);
                const stepsRemaining = businessDays.length - i;
                const burnStep = stepsRemaining > 0 ? idealCursor / stepsRemaining : idealCursor;
                idealCursor = Math.max(0, idealCursor - burnStep);
                idealByDay[i] = Math.round(idealCursor);
            }

            // Monta as linhas de snapshot
            const rows = [];
            for (let i = 0; i < businessDays.length; i++) {
                const day = businessDays[i];
                const dayEnd = day.getTime() + 24 * 60 * 60 * 1000;

                let todoCount = 0, inProgressCount = 0, doneCount = 0, blockedCount = 0;

                for (const item of scopedItems) {
                    const itemType = String(item.type || '').trim().toLowerCase();
                    if (!COUNTABLE_CHART_TYPES.has(itemType)) continue;
                    const createdTs = item.createdDate ? toUTCDateOnly(new Date(item.createdDate)).getTime() : null;
                    if (createdTs === null || createdTs >= dayEnd) continue;

                    const closedTs = item.closedDate ? toUTCDateOnly(new Date(item.closedDate)).getTime() : null;
                    const activatedTs = item.activatedDate ? toUTCDateOnly(new Date(item.activatedDate)).getTime() : null;
                    const changedTs = item.changedDate ? toUTCDateOnly(new Date(item.changedDate)).getTime() : null;
                    const currentState = parseState(item.state) || '';
                    const removedByDate = isRemovedLike(currentState) && changedTs !== null && changedTs < dayEnd;
                    if (removedByDate) continue;

                    if (item.isBlocked) blockedCount++;

                    const doneByDate = closedTs !== null
                        ? closedTs < dayEnd
                        : (isDoneLike(currentState) && changedTs !== null && changedTs < dayEnd);

                    if (doneByDate) { doneCount++; continue; }

                    const inProgressByDate = activatedTs !== null
                        ? activatedTs < dayEnd
                        : (currentState.includes('progress') && changedTs !== null && changedTs < dayEnd);

                    if (inProgressByDate) inProgressCount++;
                    else todoCount++;
                }

                const sf = (v: number) => (isNaN(v) || !isFinite(v)) ? 0 : v;
                const si = (v: number) => Math.max(0, isNaN(v) || !isFinite(v) ? 0 : Math.round(v));

                const totalWork = sf(totalWorkByDay[i]);
                const remaining = sf(realRemainingByDay[i]);
                const completed = Math.max(0, totalWork - remaining);

                rows.push({
                    sprintId: sprint.id,
                    snapshotDate: day,
                    remainingWork: remaining,
                    completedWork: completed,
                    completedInDay: sf(completedByDay[i]),
                    totalWork,
                    remainingPoints: 0,
                    completedPoints: 0,
                    totalPoints: 0,
                    todoCount,
                    inProgressCount,
                    doneCount,
                    blockedCount,
                    addedCount: si(scopeAddedByDay[i]),
                    removedCount: si(scopeRemovedByDay[i]),
                    idealRemaining: sf(idealByDay[i]),
                });
            }

            if (rows.length) {
                await prisma.sprintSnapshot.createMany({ data: rows, skipDuplicates: true });
                stats.snapshotsCreated += rows.length;
            }

            if (outcomeRows.length) {
                await prisma.sprintItemOutcome.createMany({ data: outcomeRows as any });
                stats.outcomesCreated += outcomeRows.length;
            }

            await capacityService.recalculateSprintCapacitySnapshot(sprint.id, prisma);

            stats.sprintsRebuilt++;

            const latest = rows[rows.length - 1];
            const lateCompletedTotal = outcomeRows.reduce((s: number, o: any) => s + (o.completedAfterSprintHours || 0), 0);
            const elapsedSec = ((Date.now() - sprintStartMs) / 1000).toFixed(1);
            step(
                `  ✅ ${sprintProgressLabel} — ` +
                `${rows.length} snapshots | ${outcomeRows.length} outcomes | baseline=${baselineInitial}h | rem=${latest?.remainingWork ?? 0}h` +
                (lateCompletedTotal > 0 ? ` | lateDone=${Math.round(lateCompletedTotal)}h` : '') +
                ` (${elapsedSec}s)`
            );
            const addedItems = outcomeLogRows
                .filter((item) => item.scopeAddedHours > 0)
                .sort((a, b) => b.scopeAddedHours - a.scopeAddedHours);
            const removedItems = outcomeLogRows
                .filter((item) => item.scopeRemovedHours > 0)
                .sort((a, b) => b.scopeRemovedHours - a.scopeRemovedHours);
            const completedItems = outcomeLogRows
                .filter((item) => item.completedInSprintHours > 0)
                .sort((a, b) => b.completedInSprintHours - a.completedInSprintHours);

            if (addedItems.length) {
                const addedSummary = addedItems.reduce((sum, item) => sum + item.scopeAddedHours, 0);
                step(`    scope+ ${addedItems.length} item(ns) | total=${formatHours(addedSummary)}`);
                logIndentedList(addedItems.map((item) => {
                    const reason = item.enteredAfterD0 ? 'iteration_in' : 'hours_increased';
                    return `ADD #${item.azureId} | ${formatHours(item.scopeAddedHours)} | ${reason} | ${truncateText(item.title)}`;
                }));
            }
            if (removedItems.length) {
                const removedSummary = removedItems.reduce((sum, item) => sum + item.scopeRemovedHours, 0);
                step(`    scope- ${removedItems.length} item(ns) | total=${formatHours(removedSummary)}`);
                logIndentedList(removedItems.map((item) => {
                    const reason = item.leftDuringSprint
                        ? (item.removedByStateInSprint ? 'state_removed' : 'iteration_out')
                        : 'hours_decreased';
                    return `REMOVE #${item.azureId} | ${formatHours(item.scopeRemovedHours)} | ${reason} | ${truncateText(item.title)}`;
                }));
            }
            if (completedItems.length) {
                const completedSummary = completedItems.reduce((sum, item) => sum + item.completedInSprintHours, 0);
                step(`    done ${completedItems.length} item(ns) | total=${formatHours(completedSummary)}`);
                logIndentedList(completedItems.map((item) =>
                    `DONE #${item.azureId} | ${formatHours(item.completedInSprintHours)} | ${truncateText(item.title)}`
                ));
            }

        } catch (err: any) {
            warn(`  ❌ ${sprintProgressLabel} — Erro: ${err.message}`);
            stats.errors++;
        }
    }

    return stats;
}

// ─── Exportação Principal ─────────────────────────────────────────────────────

/**
 * Executa o pipeline central completo: Smart Sync → Reconcile → Rebuild Burndown.
 *
 * @param options - Configurações: instância do Prisma, witApi do Azure, credenciais
 * @returns Resultado de cada fase com estatísticas detalhadas
 */
export async function rebuildActiveSprintBurndownOnly(options: {
    prisma: PrismaClient;
    witApi: any;
}): Promise<BurndownStats> {
    return runRebuildBurndown(options.witApi, options.prisma, new Set<string>(), true);
}

export async function runCorePipeline(options: CorePipelineOptions): Promise<CorePipelineResult> {
    const { prisma, witApi, azureProject } = options;
    const startTime = Date.now();
    let hasErrors = false;

    // ── FASE 1: Smart Sync ────────────────────────────────────────────────────
    phase(1, 'SMART SYNC — Atualização incremental de work items');
    let phase1: SmartSyncStats;
    try {
        phase1 = await runSmartSync(witApi, prisma, azureProject, startTime);
        if (phase1.errors > 0) hasErrors = true;

        if (!phase1.skipped) {
            done(
                `Concluído: ${phase1.evaluated} avaliados | ` +
                `${phase1.basicUpdated} atualizados | ` +
                `${phase1.historyRecovered} históricos recuperados | ` +
                `${phase1.errors} erros`
            );
        }
    } catch (err: any) {
        warn(`Fase 1 falhou: ${err.message}`);
        phase1 = { evaluated: 0, basicUpdated: 0, hierarchyUpdated: 0, historyRecovered: 0, errors: 1, skipped: false, affectedSprintIds: [] };
        hasErrors = true;
    }

    // ── FASE 2: Reconcile ─────────────────────────────────────────────────────
    phase(2, 'RECONCILE — Sincroniza remoções e reatribuições nas sprints ativas');
    let phase2: ReconcileStats;
    try {
        phase2 = await runReconcile(witApi, prisma);
        if (phase2.errors > 0) hasErrors = true;

        done(
            `Concluído: ${phase2.sprintsProcessed} sprint(s) | ` +
            `${phase2.markedRemoved} removidos | ` +
            `${phase2.reactivated} reativados | ` +
            `${phase2.reassigned} reatribuídos`
        );
    } catch (err: any) {
        warn(`Fase 2 falhou: ${err.message}`);
        phase2 = { sprintsProcessed: 0, markedRemoved: 0, reactivated: 0, reassigned: 0, errors: 1 };
        hasErrors = true;
    }

    // ── FASE 3: Rebuild Burndown ──────────────────────────────────────────────
    const rebuildAll = options.rebuildAllSprints ?? false;
    const affectedSet = new Set(phase1.affectedSprintIds);

    // Merge: sprints afetadas pelo SmartSync + sprints recém-backfilladas pelo daily
    for (const id of (options.extraAffectedSprintIds ?? [])) {
        affectedSet.add(id);
    }

    const extraCount = (options.extraAffectedSprintIds ?? []).length;
    phase(3, rebuildAll
        ? `REBUILD BURNDOWN — Reconstrói todas as sprints ativas${extraCount > 0 ? ` + ${extraCount} past backfillada(s)` : ''}`
        : `REBUILD BURNDOWN — Reconstrói ${affectedSet.size} sprint(s) afetada(s)`
    );
    let phase3: BurndownStats;
    try {
        phase3 = await runRebuildBurndown(witApi, prisma, affectedSet, rebuildAll);
        if (phase3.errors > 0) hasErrors = true;

        done(
            `Concluído: ${phase3.sprintsRebuilt} sprint(s) reconstruída(s) | ` +
            `${phase3.snapshotsCreated} snapshots | ${phase3.outcomesCreated} outcomes`
        );
    } catch (err: any) {
        warn(`Fase 3 falhou: ${err.message}`);
        phase3 = { sprintsRebuilt: 0, snapshotsCreated: 0, outcomesCreated: 0, errors: 1 };
        hasErrors = true;
    }

    const durationMs = Date.now() - startTime;
    return { phase1, phase2, phase3, durationMs, hasErrors };
}
