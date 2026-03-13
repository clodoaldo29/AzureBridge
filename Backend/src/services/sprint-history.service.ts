import { PrismaClient } from '@prisma/client';
import { prisma } from '@/database/client';

type SprintSummarySource = {
    id: string;
    projectId: string;
    name: string;
    startDate: Date;
    endDate: Date;
    state: string;
    timeFrame: string;
    updatedAt: Date;
    lastCalculatedAt: Date | null;
    teamCapacityHours: number | null;
    totalPlannedHours: number | null;
    totalCompletedHours: number | null;
    totalRemainingHours: number | null;
    commitmentHours: number | null;
    capacities: Array<{ availableHours: number | null }>;
    snapshots: Array<{
        snapshotDate: Date;
        totalWork: number;
        remainingWork: number;
        completedWork: number;
        addedCount: number;
        removedCount: number;
    }>;
};

function round(value: number, decimals = 1): number {
    const factor = Math.pow(10, decimals);
    return Math.round((Number(value) || 0) * factor) / factor;
}

function toPercent(part: number, total: number): number {
    if (total <= 0) return 0;
    return (part / total) * 100;
}

function calculateScopeChanges(snapshots: SprintSummarySource['snapshots']): { added: number; removed: number } {
    const ordered = [...(snapshots || [])].sort(
        (a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime()
    );
    if (!ordered.length) return { added: 0, removed: 0 };

    const addedFromFields = ordered.reduce((acc, snap) => acc + Math.max(0, Number(snap.addedCount ?? 0)), 0);
    const removedFromFields = ordered.reduce((acc, snap) => acc + Math.max(0, Number(snap.removedCount ?? 0)), 0);

    let addedFromDiff = 0;
    let removedFromDiff = 0;
    for (let i = 1; i < ordered.length; i++) {
        const prev = Number(ordered[i - 1]?.totalWork ?? 0);
        const curr = Number(ordered[i]?.totalWork ?? 0);
        const delta = curr - prev;
        if (delta > 0) addedFromDiff += delta;
        if (delta < 0) removedFromDiff += Math.abs(delta);
    }

    const useFieldValues = addedFromFields + removedFromFields > 0;
    return {
        added: round(useFieldValues ? addedFromFields : addedFromDiff),
        removed: round(useFieldValues ? removedFromFields : removedFromDiff),
    };
}

function buildSummaryPayload(sprint: SprintSummarySource) {
    const orderedSnapshots = [...(sprint.snapshots || [])].sort(
        (a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime()
    );
    const latestSnapshot = orderedSnapshots[orderedSnapshots.length - 1];
    const capacityFromMembers = (sprint.capacities || []).reduce(
        (acc, cap) => acc + Number(cap.availableHours ?? 0),
        0
    );
    const capacity = Math.max(0, Number(sprint.teamCapacityHours ?? 0) || capacityFromMembers);
    const hasSnapshotTotals = orderedSnapshots.length > 0;
    const plannedFromSnapshot = Number(latestSnapshot?.totalWork ?? 0);
    const planned = Math.max(
        0,
        hasSnapshotTotals
            ? plannedFromSnapshot
            : (
                Number(sprint.totalPlannedHours ?? 0) ||
                Number(sprint.commitmentHours ?? 0) ||
                plannedFromSnapshot
            )
    );
    const remaining = hasSnapshotTotals
        ? Number(latestSnapshot?.remainingWork ?? 0)
        : (Number(sprint.totalRemainingHours ?? 0) || Number(latestSnapshot?.remainingWork ?? 0));
    const completedFromSnapshot = Number(latestSnapshot?.completedWork ?? 0);
    const delivered = Math.max(
        0,
        hasSnapshotTotals
            ? (completedFromSnapshot || (planned - remaining))
            : (
                Number(sprint.totalCompletedHours ?? 0) ||
                completedFromSnapshot ||
                (planned - remaining)
            )
    );
    const scope = calculateScopeChanges(orderedSnapshots);
    const finalDeviation = round(planned - delivered);
    const sprintState = String(sprint.state || '').toLowerCase();
    const sprintTimeFrame = String(sprint.timeFrame || '').toLowerCase();
    const isCurrent = sprintState === 'active' || sprintTimeFrame === 'current';

    return {
        sprintName: sprint.name,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        isCurrent,
        capacityHours: round(capacity),
        plannedHours: round(planned),
        deliveredHours: round(delivered),
        remainingHours: round(remaining),
        scopeAddedHours: round(scope.added),
        scopeRemovedHours: round(scope.removed),
        finalDeviationHours: finalDeviation,
        planVsCapacityPct: round(toPercent(planned, capacity)),
        deliveredVsPlannedPct: round(toPercent(delivered, planned)),
        deliveredVsCapacityPct: round(toPercent(delivered, capacity)),
        snapshotCount: orderedSnapshots.length,
        capacityMemberCount: sprint.capacities.length,
        calculatedAt: new Date(),
    };
}

async function loadSprintForSummary(sprintId: string, db: PrismaClient): Promise<SprintSummarySource | null> {
    return db.sprint.findUnique({
        where: { id: sprintId },
        select: {
            id: true,
            projectId: true,
            name: true,
            startDate: true,
            endDate: true,
            state: true,
            timeFrame: true,
            updatedAt: true,
            lastCalculatedAt: true,
            teamCapacityHours: true,
            totalPlannedHours: true,
            totalCompletedHours: true,
            totalRemainingHours: true,
            commitmentHours: true,
            capacities: {
                select: {
                    availableHours: true,
                },
            },
            snapshots: {
                orderBy: { snapshotDate: 'asc' },
                select: {
                    snapshotDate: true,
                    totalWork: true,
                    remainingWork: true,
                    completedWork: true,
                    addedCount: true,
                    removedCount: true,
                },
            },
        },
    }) as Promise<SprintSummarySource | null>;
}

export class SprintHistoryService {
    async refreshSprintSummary(sprintId: string, db: PrismaClient = prisma) {
        const sprint = await loadSprintForSummary(sprintId, db);
        if (!sprint) return null;

        const payload = buildSummaryPayload(sprint);
        return db.sprintHistorySummary.upsert({
            where: { sprintId },
            create: {
                sprintId,
                projectId: sprint.projectId,
                ...payload,
            },
            update: {
                projectId: sprint.projectId,
                ...payload,
            },
        });
    }

    async refreshManySprintSummaries(sprintIds: string[], db: PrismaClient = prisma): Promise<number> {
        let refreshed = 0;
        for (const sprintId of sprintIds) {
            const summary = await this.refreshSprintSummary(sprintId, db);
            if (summary) refreshed++;
        }
        return refreshed;
    }

    async listProjectHistory(projectId: string, limit = 100, db: PrismaClient = prisma) {
        const sprints = await db.sprint.findMany({
            where: {
                projectId,
                OR: [
                    { state: { in: ['Past', 'Active'] } },
                    { timeFrame: { in: ['past', 'current'] } },
                ],
            },
            orderBy: { startDate: 'desc' },
            take: limit,
            select: {
                id: true,
                updatedAt: true,
                lastCalculatedAt: true,
            },
        });

        if (!sprints.length) return [];

        const summaries = await db.sprintHistorySummary.findMany({
            where: {
                sprintId: { in: sprints.map((sprint) => sprint.id) },
            },
            select: {
                sprintId: true,
                calculatedAt: true,
                updatedAt: true,
            },
        });
        const summaryBySprintId = new Map(summaries.map((summary) => [summary.sprintId, summary]));

        const staleSprintIds = sprints
            .filter((sprint) => {
                const summary = summaryBySprintId.get(sprint.id);
                if (!summary) return true;
                if (sprint.lastCalculatedAt && summary.calculatedAt < sprint.lastCalculatedAt) return true;
                return summary.updatedAt < sprint.updatedAt;
            })
            .map((sprint) => sprint.id);

        if (staleSprintIds.length) {
            await this.refreshManySprintSummaries(staleSprintIds, db);
        }

        return db.sprintHistorySummary.findMany({
            where: {
                sprintId: { in: sprints.map((sprint) => sprint.id) },
            },
            orderBy: { startDate: 'desc' },
        });
    }
}

export const sprintHistoryService = new SprintHistoryService();
