import { prisma } from '@/database/client';
import { logger } from '@/utils/logger';

export class SnapshotService {
    private readonly scopeAllowedTypes = new Set(['task', 'bug', 'test case']);
    private readonly sprintTimezone = process.env.SPRINT_TIMEZONE || 'America/Sao_Paulo';

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

    private async computeDailyScopeCounters(params: {
        projectId: string;
        sprintPath: string;
        day: Date;
    }): Promise<{ addedCount: number; removedCount: number }> {
        const { projectId, sprintPath, day } = params;
        const dayStart = this.toUtcDay(day);
        const dayKey = this.toBusinessDayKey(dayStart);
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
                        type: true
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
            const prevChanges: any = idx > 0 ? (itemHistory[idx - 1].changes || {}) : {};

            const prevRemaining = this.parseRemaining(prevChanges['Microsoft.VSTS.Scheduling.RemainingWork']);
            const currRemaining = this.parseRemaining(currentChanges['Microsoft.VSTS.Scheduling.RemainingWork']);
            if (prevRemaining === null || currRemaining === null) continue;

            const prevState = this.parseState(prevChanges['System.State']) || '';
            const currState = this.parseState(currentChanges['System.State']) || prevState;

            const prevIteration = this.parseIteration(prevChanges['System.IterationPath']);
            const currIteration = this.parseIteration(currentChanges['System.IterationPath']) || prevIteration;

            const prevInSprint = this.isInSprintPath(prevIteration, sprintPath);
            const currInSprint = this.isInSprintPath(currIteration, sprintPath);

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
        return t === 'task' || t === 'bug' || t === 'test case';
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
        const set = new Set<string>();
        for (const cap of capacities) {
            const ranges = (cap.daysOff as any[]) || [];
            for (const r of ranges) {
                if (!r?.start || !r?.end) continue;
                const start = this.toUtcDay(new Date(r.start));
                const end = this.toUtcDay(new Date(r.end));
                for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                    if (!this.isWeekend(dt)) {
                        set.add(dt.toISOString().slice(0, 10));
                    }
                }
            }
        }
        return set;
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
                    state: true,
                    remainingWork: true,
                    completedWork: true,
                    // @ts-ignore
                    initialRemainingWork: true,
                    // @ts-ignore
                    lastRemainingWork: true,
                    // @ts-ignore
                    doneRemainingWork: true,
                    storyPoints: true,
                    type: true,
                    isBlocked: true
                }
            });

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
                const initial = (item as any).initialRemainingWork || 0;
                const last = (item as any).lastRemainingWork || 0;
                const done = (item as any).doneRemainingWork || 0;
                const isPbi = this.isPbiType(item.type);
                const isCountableForCharts = this.isCountableChartType(item.type);

                // Use current planned scope for this day, so snapshot totalWork reflects scope changes.
                const currentTotal = remaining + completed;
                const plannedCurrent = isDone
                    ? (done > 0 ? done : (last > 0 ? last : currentTotal))
                    : (last > 0 ? last : remaining);
                const plannedBaseline = initial > 0 ? initial : (last > 0 ? last : currentTotal);
                const resolved = isDone
                    ? (done > 0 ? done : (last > 0 ? last : completed))
                    : Math.max(0, plannedBaseline - remaining);

                remainingWork += remaining;
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

            // Keep consistency: total = current planned scope; completed = total - remaining
            if (totalWork <= 0) {
                totalWork = remainingWork + completedWork;
            }
            completedWork = Math.max(0, totalWork - remainingWork);

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
}

export const snapshotService = new SnapshotService();
