import { prisma } from '@/database/client';
import { logger } from '@/utils/logger';
import { buildAzureWorkItemUrl } from '@/utils/azure-url';

export class SnapshotService {
    private readonly scopeAllowedTypes = new Set(['task', 'bug', 'test case']);
    private readonly sprintTimezone = process.env.SPRINT_TIMEZONE || 'America/Sao_Paulo';
    private readonly remainingWorkField = 'Microsoft.VSTS.Scheduling.RemainingWork';
    private readonly stateField = 'System.State';
    private readonly iterationField = 'System.IterationPath';
    private readonly plannedInitialCache = new Map<string, {
        d1Date: string | null;
        value: number;
        contributingItems: number;
        expiresAt: number;
    }>();

    private extractFieldValue(raw: any): any {
        if (!raw || typeof raw !== 'object') return raw;
        if (Object.prototype.hasOwnProperty.call(raw, 'newValue')) return raw.newValue;
        if (Object.prototype.hasOwnProperty.call(raw, 'value')) return raw.value;
        return raw;
    }

    private parseRemaining(raw: any): number | null {
        const value = this.extractFieldValue(raw);
        if (value === null || value === undefined || value === '') return null;
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }

    private parseState(raw: any): string | null {
        const value = this.extractFieldValue(raw);
        if (value === null || value === undefined) return null;
        return String(value).trim().toLowerCase();
    }

    private parseIteration(raw: any): string | null {
        const value = this.extractFieldValue(raw);
        if (value === null || value === undefined) return null;
        return String(value).trim().toLowerCase();
    }

    private isInSprintPath(iteration: string | null | undefined, sprintPath: string): boolean {
        const it = String(iteration || '').trim().toLowerCase();
        if (!it) return false;
        const sp = String(sprintPath || '').trim().toLowerCase();
        return it === sp || it.startsWith(`${sp}\\`);
    }

    private findPreviousParsed<T>(
        history: Array<{ changes: any }>,
        currentIndex: number,
        parser: (changes: any) => T | null
    ): T | null {
        for (let i = currentIndex - 1; i >= 0; i--) {
            const parsed = parser(history[i]?.changes || {});
            if (parsed !== null) return parsed;
        }
        return null;
    }

    private async computeDailyScopeCounters(params: {
        projectId: string;
        sprintPath: string;
        day: Date;
    }): Promise<{ addedCount: number; removedCount: number }> {
        const { projectId, sprintPath, day } = params;
        const dayStart = this.toUtcDay(day);
        // Use the explicit UTC day string as canonical key for snapshot rows.
        // Using business-day conversion here can shift to previous day depending on timezone.
        const dayKey = dayStart.toISOString().slice(0, 10);
        const queryStart = new Date(dayStart);
        queryStart.setUTCDate(queryStart.getUTCDate() - 1);
        const queryEnd = new Date(dayStart);
        queryEnd.setUTCDate(queryEnd.getUTCDate() + 2);

        const dayRevisionsRaw = await prisma.workItemRevision.findMany({
            where: {
                revisedDate: { gte: queryStart, lt: queryEnd },
                workItem: { projectId }
            },
            include: {
                workItem: {
                    select: {
                        id: true,
                        type: true,
                        createdDate: true
                    }
                }
            },
            orderBy: [{ workItemId: 'asc' }, { rev: 'asc' }]
        });

        const dayRevisions = dayRevisionsRaw.filter((r) => this.toBusinessDayKey(r.revisedDate) === dayKey);

        if (!dayRevisions.length) return { addedCount: 0, removedCount: 0 };

        const workItemIds = Array.from(new Set(dayRevisions.map((r) => r.workItemId)));

        const historyRows = await prisma.workItemRevision.findMany({
            where: {
                workItemId: { in: workItemIds },
                revisedDate: { lt: queryEnd }
            },
            select: {
                workItemId: true,
                rev: true,
                changes: true
            },
            orderBy: [{ workItemId: 'asc' }, { rev: 'asc' }]
        });

        const historyByItem = new Map<number, Array<{ rev: number; changes: any }>>();
        for (const row of historyRows) {
            const list = historyByItem.get(row.workItemId) || [];
            list.push({ rev: row.rev, changes: row.changes as any });
            historyByItem.set(row.workItemId, list);
        }

        let added = 0;
        let removed = 0;

        for (const rev of dayRevisions) {
            const type = String(rev.workItem?.type || '').trim().toLowerCase();
            if (!this.scopeAllowedTypes.has(type)) continue;

            const itemHistory = historyByItem.get(rev.workItemId) || [];
            const idx = itemHistory.findIndex((h) => h.rev === rev.rev);
            if (idx < 0) continue;

            const currentChanges: any = itemHistory[idx].changes || {};

            const currRemainingRaw = this.parseRemaining(currentChanges[this.remainingWorkField]);
            let prevRemaining = this.findPreviousParsed(itemHistory, idx, (changes) =>
                this.parseRemaining(changes[this.remainingWorkField])
            );
            let currRemaining = currRemainingRaw !== null ? currRemainingRaw : prevRemaining;

            const prevIteration = this.findPreviousParsed(itemHistory, idx, (changes) =>
                this.parseIteration(changes[this.iterationField])
            );
            const currIteration = this.parseIteration(currentChanges[this.iterationField]) || prevIteration;

            const prevInSprint = this.isInSprintPath(prevIteration, sprintPath);
            const currInSprint = this.isInSprintPath(currIteration, sprintPath);

            // First estimate rule (real scenario):
            // item can be created before D1 with no RemainingWork and receive first estimate on D1..Dn.
            // When it is in sprint on current revision, previous remaining must be treated as zero.
            if (prevRemaining === null && currRemainingRaw !== null && currInSprint) {
                prevRemaining = 0;
                currRemaining = currRemainingRaw;
            }
            if (prevRemaining === null || currRemaining === null) continue;

            const prevState = this.findPreviousParsed(itemHistory, idx, (changes) =>
                this.parseState(changes[this.stateField])
            ) || '';
            const currState = this.parseState(currentChanges[this.stateField]) || prevState;

            const completionEvent = prevRemaining > 0 && currRemaining === 0 && this.isDoneState(currState);

            if (!prevInSprint && currInSprint) {
                if (currRemaining > 0) added += currRemaining;
                continue;
            }

            if (prevInSprint && !currInSprint) {
                if (prevRemaining > 0) removed += prevRemaining;
                continue;
            }

            if (prevInSprint && currInSprint) {
                const delta = currRemaining - prevRemaining;
                if (delta > 0) added += delta;
                if (delta < 0 && !completionEvent) removed += Math.abs(delta);
            }
        }

        return {
            addedCount: Math.max(0, Math.round(added)),
            removedCount: Math.max(0, Math.round(removed))
        };
    }

    private isPbiType(type?: string | null): boolean {
        const t = String(type || '').trim().toLowerCase();
        return t === 'product backlog item' || t === 'user story' || t === 'pbi';
    }

    private isCountableChartType(type?: string | null): boolean {
        const t = String(type || '').trim().toLowerCase();
        return t === 'task' || t === 'bug';
    }

    private isDoneState(state?: string | null): boolean {
        const s = String(state || '').trim().toLowerCase();
        return s === 'done' || s === 'closed' || s === 'completed';
    }

    private isInProgressState(state?: string | null): boolean {
        const s = String(state || '').trim().toLowerCase();
        return s === 'in progress' || s === 'active' || s === 'committed' || s.includes('progress');
    }

    private toUtcDay(date: Date): Date {
        const d = new Date(date);
        d.setUTCHours(0, 0, 0, 0);
        return d;
    }

    private toBusinessDayKey(date: Date): string {
        const fmt = new Intl.DateTimeFormat('en-CA', {
            timeZone: this.sprintTimezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        return fmt.format(date);
    }

    private isWeekend(date: Date): boolean {
        const day = date.getUTCDay();
        return day === 0 || day === 6;
    }

    private extractDayOffSet(capacities: Array<{ daysOff: unknown }>): Set<string> {
        // Sprint day off must represent team day off only.
        // We derive it as the intersection of day-off ranges across members.
        if (!capacities.length) return new Set<string>();

        const memberDaySets: Array<Set<string>> = capacities.map((cap) => {
            const memberSet = new Set<string>();
            const ranges = (cap.daysOff as any[]) || [];
            for (const r of ranges) {
                if (!r?.start || !r?.end) continue;
                const start = this.toUtcDay(new Date(r.start));
                const end = this.toUtcDay(new Date(r.end));
                for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                    if (!this.isWeekend(dt)) {
                        memberSet.add(dt.toISOString().slice(0, 10));
                    }
                }
            }
            return memberSet;
        });

        let intersection = new Set<string>(memberDaySets[0]);
        for (let i = 1; i < memberDaySets.length; i++) {
            intersection = new Set(
                Array.from(intersection).filter((dayKey) => memberDaySets[i].has(dayKey))
            );
        }

        return intersection;
    }
    /**
     * Capturar snapshot diario para todas as sprints ativas
     */
    async captureDailySnapshots(): Promise<void> {
        try {
            logger.info('📸 Starting Daily Snapshot capture...');

            // 1. Buscar todas as sprints ativas
            const activeSprints = await prisma.sprint.findMany({
                where: {
                    state: { in: ['active', 'Active'] }
                },
                include: {
                    project: true
                }
            });

            if (activeSprints.length === 0) {
                logger.info('No active sprints found for snapshot.');
                return;
            }

            logger.info(`Found ${activeSprints.length} active sprints.`);

            // 2. Processar cada sprint
            for (const sprint of activeSprints) {
                await this.createSprintSnapshot(sprint.id);
            }

            logger.info('✅ Daily Snapshot capture completed.');
        } catch (error) {
            logger.error('Failed to capture daily snapshots', error);
            throw error;
        }
    }

    /**
     * Criar um snapshot para uma sprint especifica
     */
    async createSprintSnapshot(sprintId: string): Promise<void> {
        try {
            const today = this.toUtcDay(new Date()); // Sempre normalizar para dia UTC

            const sprint = await prisma.sprint.findUnique({
                where: { id: sprintId },
                include: {
                    capacities: {
                        select: { daysOff: true }
                    }
                }
            });

            if (!sprint) {
                logger.warn(`Sprint not found for snapshot: ${sprintId}`);
                return;
            }

            // Never create snapshots on weekends or configured day-off dates
            const dayOffSet = this.extractDayOffSet(sprint.capacities);
            const todayIso = today.toISOString().slice(0, 10);
            if (this.isWeekend(today) || dayOffSet.has(todayIso)) {
                logger.info(`Skipping snapshot for ${sprintId} on non-working day (${todayIso}).`);
                return;
            }

            // Defensive cleanup: active sprints may have historical backfill rows in future dates.
            // Keeping them causes false negative scope deltas when scope increases today.
            await prisma.sprintSnapshot.deleteMany({
                where: {
                    sprintId,
                    snapshotDate: { gt: today }
                }
            });

            // Get work items metrics
            const workItems = await prisma.workItem.findMany({
                where: {
                    sprintId,
                    isRemoved: false // Exclude removed items
                },
                select: {
                    id: true,
                    state: true,
                    remainingWork: true,
                    completedWork: true,
                    // @ts-ignore
                    initialRemainingWork: true,
                    // @ts-ignore
                    lastRemainingWork: true,
                    // @ts-ignore
                    doneRemainingWork: true,
                    changedDate: true,
                    storyPoints: true,
                    type: true,
                    isBlocked: true
                }
            });

            // Use canonical UTC day key to avoid timezone shifting (same rule used for snapshotDate).
            const todayBusinessKey = todayIso;
            const doneItemIds = workItems
                .filter((item) => this.isDoneState(item.state))
                .map((item) => item.id);
            const doneTodayItemIds = workItems
                .filter((item) => this.isDoneState(item.state) && this.toBusinessDayKey(new Date(item.changedDate)) === todayBusinessKey)
                .map((item) => item.id);

            const doneRemainingHint = new Map<number, {
                hadRemainingToday: boolean;
                lastRemainingBeforeToday: number | null;
                latestRemainingToday: number | null;
            }>();
            const doneRemainingFromHistory = new Map<number, number>();
            const tomorrowUtc = new Date(today);
            tomorrowUtc.setUTCDate(tomorrowUtc.getUTCDate() + 1);

            if (doneItemIds.length > 0) {
                const doneHistoryRows = await prisma.workItemRevision.findMany({
                    where: {
                        workItemId: { in: doneItemIds },
                        revisedDate: { lt: tomorrowUtc },
                    },
                    select: {
                        workItemId: true,
                        rev: true,
                        changes: true,
                    },
                    orderBy: [{ workItemId: 'asc' }, { rev: 'asc' }]
                });

                const doneAccumulator = new Map<number, {
                    lastRemaining: number | null;
                    currentState: string | null;
                    doneRemaining: number | null;
                }>();

                for (const row of doneHistoryRows) {
                    const info = doneAccumulator.get(row.workItemId) || {
                        lastRemaining: null,
                        currentState: null,
                        doneRemaining: null
                    };
                    const changes = (row.changes as any) || {};

                    const rem = this.parseRemaining(changes[this.remainingWorkField]);
                    if (rem !== null) {
                        info.lastRemaining = rem;
                    }

                    const state = this.parseState(changes[this.stateField]);
                    if (state !== null) {
                        info.currentState = state;
                    }

                    if (info.doneRemaining === null && this.isDoneState(info.currentState)) {
                        info.doneRemaining = Math.max(0, Number(info.lastRemaining || 0));
                    }

                    doneAccumulator.set(row.workItemId, info);
                }

                for (const [workItemId, info] of doneAccumulator) {
                    if (info.doneRemaining !== null) {
                        doneRemainingFromHistory.set(workItemId, Math.max(0, Number(info.doneRemaining || 0)));
                    }
                }
            }
            if (doneTodayItemIds.length > 0) {
                const remainingRows = await prisma.workItemRevision.findMany({
                    where: {
                        workItemId: { in: doneTodayItemIds },
                        revisedDate: { lt: tomorrowUtc },
                        changedFields: { has: this.remainingWorkField }
                    },
                    select: {
                        workItemId: true,
                        revisedDate: true,
                        changes: true
                    },
                    orderBy: [{ workItemId: 'asc' }, { revisedDate: 'asc' }]
                });

                for (const row of remainingRows) {
                    const info = doneRemainingHint.get(row.workItemId) || {
                        hadRemainingToday: false,
                        lastRemainingBeforeToday: null,
                        latestRemainingToday: null
                    };
                    const rem = this.parseRemaining((row.changes as any)?.[this.remainingWorkField]);
                    if (rem === null) continue;
                    const rowDayKey = this.toBusinessDayKey(row.revisedDate);
                    if (rowDayKey === todayBusinessKey) {
                        info.hadRemainingToday = true;
                        info.latestRemainingToday = rem;
                    } else if (rowDayKey < todayBusinessKey) {
                        info.lastRemainingBeforeToday = rem;
                    }
                    doneRemainingHint.set(row.workItemId, info);
                }
            }

            // Calculate Metrics
            let remainingWork = 0;
            let completedWork = 0;
            let totalWork = 0;
            let remainingPoints = 0;
            let completedPoints = 0;
            let totalPoints = 0;

            let todoCount = 0;
            let inProgressCount = 0;
            let doneCount = 0;
            let blockedCount = 0;

            for (const item of workItems) {
                const remaining = item.remainingWork || 0;
                const completed = item.completedWork || 0;
                const state = item.state.toLowerCase();
                const isDone = state === 'done' || state === 'closed' || state === 'completed';
                const last = (item as any).lastRemainingWork || 0;
                const done = (item as any).doneRemainingWork || 0;
                const doneFromHistory = doneRemainingFromHistory.get((item as any).id) || 0;
                const isPbi = this.isPbiType(item.type);
                const isCountableForCharts = this.isCountableChartType(item.type);

                // Use current planned scope for this day, so snapshot totalWork reflects scope changes.
                const currentTotal = remaining + completed;
                let plannedCurrent = isDone
                    ? (doneFromHistory > 0 ? doneFromHistory : (done > 0 ? done : (last > 0 ? last : currentTotal)))
                    : remaining;

                // If item moved to Done today without RemainingWork change today,
                // keep the last RemainingWork known before today as planned scope.
                if (isDone && this.toBusinessDayKey(new Date((item as any).changedDate)) === todayBusinessKey) {
                    const hint = doneRemainingHint.get((item as any).id);
                    if (hint) {
                        if (!hint.hadRemainingToday && hint.lastRemainingBeforeToday !== null && hint.lastRemainingBeforeToday > 0) {
                            plannedCurrent = hint.lastRemainingBeforeToday;
                        } else if (hint.hadRemainingToday && plannedCurrent <= 0 && hint.latestRemainingToday !== null && hint.latestRemainingToday > 0) {
                            plannedCurrent = hint.latestRemainingToday;
                        }
                    }
                }
                const resolved = isDone
                    ? Math.max(0, plannedCurrent)
                    : 0;

                const effectiveRemaining = isDone ? 0 : Math.max(0, remaining);
                remainingWork += effectiveRemaining;
                totalWork += Math.max(0, plannedCurrent);
                completedWork += Math.max(0, resolved);

                // Sum Points (usually only PBI/Bug)
                const points = item.storyPoints || 0;
                totalPoints += points;

                // Contadores do CFD excluem PBI/User Story por regra.
                if (!isPbi && isCountableForCharts) {
                    if ((item as any).isBlocked) blockedCount++;
                    if (state === 'done' || state === 'closed' || state === 'completed') {
                        doneCount++;
                    } else if (state === 'in progress' || state === 'committed' || state === 'active') {
                        inProgressCount++;
                    } else {
                        // New, To Do, Approved
                        todoCount++;
                    }
                }

                // Pontos permanecem inalterados (não usados pelas camadas visuais do CFD)
                if (state === 'done' || state === 'closed' || state === 'completed') completedPoints += points;
                else remainingPoints += points;
            }

            // Keep consistency: total = current planned scope; completed reflects done scope from real history.
            if (totalWork <= 0) {
                totalWork = remainingWork + completedWork;
            }
            completedWork = Math.max(0, completedWork);

            const { addedCount, removedCount } = await this.computeDailyScopeCounters({
                projectId: sprint.projectId,
                sprintPath: sprint.path,
                day: today
            });

            // Save or refresh same-day snapshot to capture intra-day scope changes.
            await prisma.sprintSnapshot.upsert({
                where: {
                    sprintId_snapshotDate: {
                        sprintId,
                        snapshotDate: today
                    }
                },
                create: {
                    sprintId,
                    snapshotDate: today,
                    remainingWork,
                    completedWork,
                    totalWork,
                    remainingPoints,
                    completedPoints,
                    totalPoints,
                    todoCount,
                    inProgressCount,
                    doneCount,
                    blockedCount,
                    addedCount,
                    removedCount
                },
                update: {
                    remainingWork,
                    completedWork,
                    totalWork,
                    remainingPoints,
                    completedPoints,
                    totalPoints,
                    todoCount,
                    inProgressCount,
                    doneCount,
                    blockedCount,
                    addedCount,
                    removedCount
                }
            });

            logger.info(`📸 Snapshot created for sprint ${sprintId}: Rem=${remainingWork}h, Comp=${completedWork}h`);

        } catch (error) {
            logger.error(`Failed to create snapshot for sprint ${sprintId}`, error);
            // Don't throw to allow other sprints to proceed
        }
    }

    /**
     * Reconstroi snapshots historicos da sprint usando sinais temporais dos work items
     * (created/activated/closed/changed). Nao depende de work_item_revisions.
     */
    async rebuildSprintHistorySnapshots(sprintId: string): Promise<void> {
        const sprint = await prisma.sprint.findUnique({
            where: { id: sprintId },
            include: {
                capacities: {
                    select: { daysOff: true }
                }
            }
        });

        if (!sprint) {
            logger.warn(`Sprint not found for history rebuild: ${sprintId}`);
            return;
        }

        const offSet = this.extractDayOffSet(sprint.capacities);
        const startMs = this.toUtcDay(new Date(sprint.startDate)).getTime();
        const endCap = Math.min(
            this.toUtcDay(new Date(sprint.endDate)).getTime(),
            this.toUtcDay(new Date()).getTime()
        );

        const existing = await prisma.sprintSnapshot.findMany({
            where: { sprintId },
            orderBy: { snapshotDate: 'asc' }
        });
        const byDate = new Map(existing.map((s) => [this.toUtcDay(s.snapshotDate).getTime(), s]));

        const workItems = await prisma.workItem.findMany({
            where: {
                sprintId,
                isRemoved: false
            },
            select: {
                type: true,
                state: true,
                isBlocked: true,
                createdDate: true,
                changedDate: true,
                activatedDate: true,
                closedDate: true
            }
        });

        for (let ms = startMs; ms <= endCap; ms += 24 * 60 * 60 * 1000) {
            const d = new Date(ms);
            const wd = d.getUTCDay();
            if (wd === 0 || wd === 6) continue;
            const iso = d.toISOString().slice(0, 10);
            if (offSet.has(iso)) continue;

            let todoCount = 0;
            let inProgressCount = 0;
            let doneCount = 0;
            let blockedCount = 0;

            const dayEndMs = ms + (24 * 60 * 60 * 1000 - 1);

            for (const item of workItems) {
                if (!this.isCountableChartType(item.type)) continue;
                const createdMs = this.toUtcDay(item.createdDate).getTime();
                if (createdMs > ms) continue;

                const closedMs = item.closedDate ? this.toUtcDay(item.closedDate).getTime() : null;
                const activatedMs = item.activatedDate ? this.toUtcDay(item.activatedDate).getTime() : null;
                const changedMs = this.toUtcDay(item.changedDate).getTime();

                const doneByDate = closedMs !== null
                    ? closedMs <= dayEndMs
                    : (this.isDoneState(item.state) && changedMs <= dayEndMs);

                if (doneByDate) {
                    doneCount++;
                    continue;
                }

                const inProgressByDate = activatedMs !== null
                    ? activatedMs <= dayEndMs
                    : (this.isInProgressState(item.state) && changedMs <= dayEndMs);

                if (inProgressByDate) {
                    inProgressCount++;
                    if (item.isBlocked) blockedCount++;
                } else {
                    todoCount++;
                }
            }

            const snapshotDate = new Date(ms);
            const existingSnap = byDate.get(ms);

            await prisma.sprintSnapshot.upsert({
                where: {
                    sprintId_snapshotDate: {
                        sprintId,
                        snapshotDate
                    }
                },
                create: {
                    sprintId,
                    snapshotDate,
                    remainingWork: existingSnap?.remainingWork || 0,
                    completedWork: existingSnap?.completedWork || 0,
                    totalWork: existingSnap?.totalWork || 0,
                    remainingPoints: existingSnap?.remainingPoints || 0,
                    completedPoints: existingSnap?.completedPoints || 0,
                    totalPoints: existingSnap?.totalPoints || 0,
                    todoCount,
                    inProgressCount,
                    doneCount,
                    blockedCount,
                    addedCount: existingSnap?.addedCount || 0,
                    removedCount: existingSnap?.removedCount || 0,
                    idealRemaining: existingSnap?.idealRemaining || null
                },
                update: {
                    todoCount,
                    inProgressCount,
                    doneCount,
                    blockedCount
                }
            });
        }

        logger.info(`Rebuilt historical snapshots for sprint ${sprintId}`);
    }

    /**
     * Baseline canônico (< D1): soma do RemainingWork já existente antes do D1
     * para itens que já estavam na sprint antes do D1.
     */
    async getPlannedInitialBeforeD1(sprintId: string): Promise<{
        plannedInitialBeforeD1: number;
        d1Date: string | null;
        contributingItems: number;
    }> {
        const cacheKey = sprintId;
        const cached = this.plannedInitialCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return {
                plannedInitialBeforeD1: cached.value,
                d1Date: cached.d1Date,
                contributingItems: cached.contributingItems
            };
        }

        const sprint = await prisma.sprint.findUnique({
            where: { id: sprintId },
            select: { id: true, projectId: true, path: true, startDate: true }
        });
        if (!sprint) {
            return { plannedInitialBeforeD1: 0, d1Date: null, contributingItems: 0 };
        }

        const d1Utc = this.toUtcDay(new Date(sprint.startDate));
        const d1Date = d1Utc.toISOString().slice(0, 10);

        const revisionUpperBound = new Date(d1Utc);
        revisionUpperBound.setUTCDate(revisionUpperBound.getUTCDate() + 1);
        const revisionRows = await prisma.workItemRevision.findMany({
            where: {
                revisedDate: { lt: revisionUpperBound },
                workItem: {
                    projectId: sprint.projectId,
                    createdDate: { lt: d1Utc },
                    OR: [
                        { type: { equals: 'Task', mode: 'insensitive' } },
                        { type: { equals: 'Bug', mode: 'insensitive' } },
                        { type: { equals: 'Test Case', mode: 'insensitive' } }
                    ]
                },
                OR: [
                    { changedFields: { has: this.remainingWorkField } },
                    { changedFields: { has: this.iterationField } }
                ]
            },
            select: {
                workItemId: true,
                rev: true,
                revisedDate: true,
                changes: true,
                workItem: {
                    select: {
                        createdDate: true,
                        sprintId: true,
                        changedDate: true
                    }
                }
            },
            orderBy: [{ workItemId: 'asc' }, { rev: 'asc' }]
        });

        if (!revisionRows.length) {
            return { plannedInitialBeforeD1: 0, d1Date, contributingItems: 0 };
        }

        const latestByItem = new Map<number, {
            remaining: number | null;
            iteration: string | null;
            createdDate: Date | null;
            sprintId: string | null;
            changedDate: Date | null;
        }>();
        for (const row of revisionRows) {
            if (this.toBusinessDayKey(row.revisedDate) >= d1Date) continue;

            const latest = latestByItem.get(row.workItemId) || {
                remaining: null,
                iteration: null,
                createdDate: row.workItem?.createdDate || null,
                sprintId: row.workItem?.sprintId || null,
                changedDate: row.workItem?.changedDate || null
            };
            const changes: any = row.changes || {};

            const rem = this.parseRemaining(changes[this.remainingWorkField]);
            if (rem !== null) latest.remaining = rem;

            const iter = this.parseIteration(changes[this.iterationField]);
            if (iter !== null) latest.iteration = iter;

            if (!latest.createdDate && row.workItem?.createdDate) {
                latest.createdDate = row.workItem.createdDate;
            }
            if (latest.sprintId === null && row.workItem?.sprintId) {
                latest.sprintId = row.workItem.sprintId;
            }
            if (!latest.changedDate && row.workItem?.changedDate) {
                latest.changedDate = row.workItem.changedDate;
            }
            latestByItem.set(row.workItemId, latest);
        }

        let total = 0;
        let contributingItems = 0;
        for (const latest of latestByItem.values()) {
            if (!latest.createdDate) continue;
            const createdDayKey = this.toBusinessDayKey(latest.createdDate);
            if (createdDayKey >= d1Date) continue;

            // If item is no longer tied to this sprint and its latest change happened before D1,
            // it was already out before sprint start and must not be part of baseline.
            if (latest.sprintId !== sprintId && latest.changedDate && this.toBusinessDayKey(latest.changedDate) < d1Date) {
                continue;
            }

            if (!this.isInSprintPath(latest.iteration, sprint.path)) continue;

            const rem = latest.remaining;
            if (rem !== null && rem > 0) {
                total += rem;
                contributingItems++;
            }
        }

        const result = {
            plannedInitialBeforeD1: Math.max(0, Math.round(total)),
            d1Date,
            contributingItems
        };
        this.plannedInitialCache.set(cacheKey, {
            d1Date: result.d1Date,
            value: result.plannedInitialBeforeD1,
            contributingItems: result.contributingItems,
            expiresAt: Date.now() + 10 * 60 * 1000
        });
        return result;
    }

    /**
     * Retorna os work items que tiveram mudanca de escopo em um dia especifico
     */
    async getScopeChangesForDay(sprintId: string, dateStr: string): Promise<{
        date: string;
        added: Array<{
            id: number;
            title: string;
            type: string;
            hoursChange: number;
            changedBy: string;
            azureUrl: string | null;
            reason: 'added_to_sprint' | 'removed_from_sprint' | 'hours_increased' | 'hours_decreased';
        }>;
        removed: Array<{
            id: number;
            title: string;
            type: string;
            hoursChange: number;
            changedBy: string;
            azureUrl: string | null;
            reason: 'added_to_sprint' | 'removed_from_sprint' | 'hours_increased' | 'hours_decreased';
        }>;
    }> {
        const empty = { date: dateStr, added: [], removed: [] };

        const sprint = await prisma.sprint.findUnique({
            where: { id: sprintId },
            select: {
                path: true,
                projectId: true,
                project: {
                    select: { name: true }
                }
            }
        });
        if (!sprint) return empty;

        const { path: sprintPath, projectId } = sprint;
        const projectName = sprint.project?.name || null;

        // dayKey usa o dateStr diretamente (YYYY-MM-DD) para evitar problema de timezone:
        // toBusinessDayKey(UTC midnight) retorna o dia ANTERIOR no fuso America/Sao_Paulo
        const dayKey = dateStr;
        const dayStart = this.toUtcDay(new Date(dateStr));
        const queryStart = new Date(dayStart);
        queryStart.setUTCDate(queryStart.getUTCDate() - 1);
        const queryEnd = new Date(dayStart);
        queryEnd.setUTCDate(queryEnd.getUTCDate() + 2);

        const dayRevisionsRaw = await prisma.workItemRevision.findMany({
            where: {
                revisedDate: { gte: queryStart, lt: queryEnd },
                workItem: { projectId }
            },
            include: {
                workItem: {
                    select: { id: true, title: true, type: true, createdDate: true, url: true }
                }
            },
            orderBy: [{ workItemId: 'asc' }, { rev: 'asc' }]
        });

        const dayRevisions = dayRevisionsRaw.filter(
            (r) => this.toBusinessDayKey(r.revisedDate) === dayKey
        );

        if (!dayRevisions.length) return empty;

        const workItemIds = Array.from(new Set(dayRevisions.map((r) => r.workItemId)));

        const historyRows = await prisma.workItemRevision.findMany({
            where: {
                workItemId: { in: workItemIds },
                revisedDate: { lt: queryEnd }
            },
            select: { workItemId: true, rev: true, changes: true },
            orderBy: [{ workItemId: 'asc' }, { rev: 'asc' }]
        });

        const historyByItem = new Map<number, Array<{ rev: number; changes: any }>>();
        for (const row of historyRows) {
            const list = historyByItem.get(row.workItemId) || [];
            list.push({ rev: row.rev, changes: row.changes as any });
            historyByItem.set(row.workItemId, list);
        }

        type ItemAccum = {
            addedHours: number;
            removedHours: number;
            sprintAdded: boolean;
            sprintRemoved: boolean;
            title: string;
            type: string;
            changedBy: string;
            azureUrl: string | null;
        };

        const accumMap = new Map<number, ItemAccum>();

        for (const rev of dayRevisions) {
            const wiId = rev.workItemId;
            const wiType = String(rev.workItem?.type || '').trim().toLowerCase();
            if (!this.scopeAllowedTypes.has(wiType)) continue;

            const itemHistory = historyByItem.get(wiId) || [];
            const idx = itemHistory.findIndex((h) => h.rev === rev.rev);
            if (idx < 0) continue;

            const currentChanges: any = itemHistory[idx].changes || {};

            const currRemainingRaw = this.parseRemaining(currentChanges[this.remainingWorkField]);
            let prevRemaining = this.findPreviousParsed(itemHistory, idx, (changes) =>
                this.parseRemaining(changes[this.remainingWorkField])
            );
            let currRemaining = currRemainingRaw !== null ? currRemainingRaw : prevRemaining;

            const prevIteration = this.findPreviousParsed(itemHistory, idx, (changes) =>
                this.parseIteration(changes[this.iterationField])
            );
            const currIteration = this.parseIteration(currentChanges[this.iterationField]) || prevIteration;

            const prevInSprint = this.isInSprintPath(prevIteration, sprintPath);
            const currInSprint = this.isInSprintPath(currIteration, sprintPath);

            // Same first-estimate rule used by snapshot bars:
            // if first RemainingWork appears while item is in sprint, it is scope added.
            if (prevRemaining === null && currRemainingRaw !== null && currInSprint) {
                prevRemaining = 0;
                currRemaining = currRemainingRaw;
            }
            if (prevRemaining === null || currRemaining === null) continue;

            const prevState = this.findPreviousParsed(itemHistory, idx, (changes) =>
                this.parseState(changes[this.stateField])
            ) || '';
            const currState = this.parseState(currentChanges[this.stateField]) || prevState;

            const completionEvent = prevRemaining > 0 && currRemaining === 0 && this.isDoneState(currState);

            const accum: ItemAccum = accumMap.get(wiId) || {
                addedHours: 0,
                removedHours: 0,
                sprintAdded: false,
                sprintRemoved: false,
                title: rev.workItem?.title || `#${wiId}`,
                type: rev.workItem?.type || '',
                changedBy: rev.revisedBy,
                azureUrl: buildAzureWorkItemUrl({
                    id: wiId,
                    rawUrl: rev.workItem?.url || null,
                    projectName
                })
            };

            if (!prevInSprint && currInSprint) {
                if (currRemaining > 0) {
                    accum.addedHours += currRemaining;
                    accum.sprintAdded = true;
                }
            } else if (prevInSprint && !currInSprint) {
                if (prevRemaining > 0) {
                    accum.removedHours += prevRemaining;
                    accum.sprintRemoved = true;
                }
            } else if (prevInSprint && currInSprint) {
                const delta = currRemaining - prevRemaining;
                if (delta > 0) accum.addedHours += delta;
                if (delta < 0 && !completionEvent) accum.removedHours += Math.abs(delta);
            }

            accumMap.set(wiId, accum);
        }

        type ScopeItem = {
            id: number;
            title: string;
            type: string;
            hoursChange: number;
            changedBy: string;
            azureUrl: string | null;
            reason: 'added_to_sprint' | 'removed_from_sprint' | 'hours_increased' | 'hours_decreased';
        };
        const added: ScopeItem[] = [];
        const removed: ScopeItem[] = [];

        for (const [wiId, accum] of accumMap) {
            if (accum.addedHours > 0) {
                added.push({
                    id: wiId,
                    title: accum.title,
                    type: accum.type,
                    hoursChange: Math.round(accum.addedHours * 10) / 10,
                    changedBy: accum.changedBy,
                    azureUrl: accum.azureUrl,
                    reason: accum.sprintAdded ? 'added_to_sprint' : 'hours_increased'
                });
            }

            if (accum.removedHours > 0) {
                removed.push({
                    id: wiId,
                    title: accum.title,
                    type: accum.type,
                    hoursChange: Math.round(accum.removedHours * 10) / 10,
                    changedBy: accum.changedBy,
                    azureUrl: accum.azureUrl,
                    reason: accum.sprintRemoved ? 'removed_from_sprint' : 'hours_decreased'
                });
            }
        }

        added.sort((a, b) => b.hoursChange - a.hoursChange);
        removed.sort((a, b) => b.hoursChange - a.hoursChange);

        return { date: dateStr, added, removed };
    }

    async getScopeTotalsForDay(sprintId: string, dateStr: string): Promise<{
        addedCount: number;
        removedCount: number;
    }> {
        const scope = await this.getScopeChangesForDay(sprintId, dateStr);
        const addedCount = Math.max(
            0,
            Math.round(scope.added.reduce((sum, item) => sum + Number(item.hoursChange || 0), 0))
        );
        const removedCount = Math.max(
            0,
            Math.round(scope.removed.reduce((sum, item) => sum + Number(item.hoursChange || 0), 0))
        );
        return { addedCount, removedCount };
    }
}

export const snapshotService = new SnapshotService();
