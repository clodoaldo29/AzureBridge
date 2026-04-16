import { PrismaClient } from '@prisma/client';
import { getAzureDevOpsClient } from '@/integrations/azure/client';
import { logger } from '@/utils/logger';
import { buildAzureWorkItemUrl } from '@/utils/azure-url';
import { sprintHistoryService } from '@/services/sprint-history.service';

const prisma = new PrismaClient();
const UNASSIGNED_ALLOWED_TYPES = new Set(['task', 'bug', 'test case']);
const DONE_STATES = new Set(['done', 'closed', 'completed']);

type UnassignedByTypeAccumulator = Record<string, { items: number; totalHours: number }>;
type UnassignedTaskItem = {
    id: number;
    title: string;
    state: string;
    plannedHours: number;
    remainingHours: number;
    url: string | null;
    azureUrl: string | null;
};

type CapacityByTypeEntry = {
    type: string;
    items: number;
    totalHours: number;
};

type CapacityUnassignedBucket = {
    totalHours: number;
    remainingHours?: number;
    items: number;
    byType: CapacityByTypeEntry[];
    tasks: UnassignedTaskItem[];
};

type CapacityUnassignedSummary = {
    totalHours: number;
    items: number;
    open: CapacityUnassignedBucket;
    done: CapacityUnassignedBucket;
};

type CapacityDetailsSnapshot = {
    totalPlannedInitial: number;
    totalPlannedCurrent: number;
    totalPlannedDelta: number;
    totalAddedScope: number;
    dayOffDates: string[];
    unassigned: CapacityUnassignedSummary;
};

type CapacityMemberMetrics = {
    planned: number;
    completed: number;
};

type SprintCapacitySnapshot = {
    totalAvailable: number;
    totalPlannedInitial: number;
    totalPlannedCurrent: number;
    totalPlannedDelta: number;
    totalRemaining: number;
    totalCompleted: number;
    totalAddedScope: number;
    dayOffDates: string[];
    unassigned: CapacityUnassignedSummary;
    byMember: Record<string, CapacityMemberMetrics>;
};

export class CapacityService {
    private toSortedTypeBreakdown(acc: UnassignedByTypeAccumulator): CapacityByTypeEntry[] {
        return Object.entries(acc)
            .map(([type, value]) => ({
                type,
                items: value.items,
                totalHours: Math.round(value.totalHours * 10) / 10
            }))
            .sort((a, b) => {
                if (b.totalHours !== a.totalHours) return b.totalHours - a.totalHours;
                return b.items - a.items;
            });
    }

    private mergeDayOffRanges(memberDaysOff: any[], teamDaysOff: any[]): any[] {
        const merged = [...(memberDaysOff || []), ...(teamDaysOff || [])];
        const seen = new Set<string>();
        return merged.filter((range: any) => {
            if (!range?.start || !range?.end) return false;
            const key = `${new Date(range.start).toISOString()}|${new Date(range.end).toISOString()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    private createEmptyUnassignedBucket(includeRemainingHours: boolean): CapacityUnassignedBucket {
        return {
            totalHours: 0,
            ...(includeRemainingHours ? { remainingHours: 0 } : {}),
            items: 0,
            byType: [],
            tasks: []
        };
    }

    private createEmptyUnassignedSummary(): CapacityUnassignedSummary {
        return {
            totalHours: 0,
            items: 0,
            open: this.createEmptyUnassignedBucket(true),
            done: this.createEmptyUnassignedBucket(false)
        };
    }

    private normalizeTaskList(tasks: unknown): UnassignedTaskItem[] {
        if (!Array.isArray(tasks)) return [];
        return tasks
            .map((task) => {
                if (!task || typeof task !== 'object') return null;
                const row = task as Record<string, unknown>;
                return {
                    id: Number(row.id || 0),
                    title: String(row.title || ''),
                    state: String(row.state || ''),
                    plannedHours: Math.round(Number(row.plannedHours || 0) * 10) / 10,
                    remainingHours: Math.round(Number(row.remainingHours || 0) * 10) / 10,
                    url: row.url ? String(row.url) : null,
                    azureUrl: row.azureUrl ? String(row.azureUrl) : null
                };
            })
            .filter((task): task is UnassignedTaskItem => task !== null && task.id > 0)
            .sort((a, b) => b.plannedHours - a.plannedHours);
    }

    private normalizeTypeBreakdown(entries: unknown): CapacityByTypeEntry[] {
        if (!Array.isArray(entries)) return [];
        return entries
            .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                const row = entry as Record<string, unknown>;
                return {
                    type: String(row.type || 'Other'),
                    items: Number(row.items || 0),
                    totalHours: Math.round(Number(row.totalHours || 0) * 10) / 10
                };
            })
            .filter((entry): entry is CapacityByTypeEntry => entry !== null)
            .sort((a, b) => {
                if (b.totalHours !== a.totalHours) return b.totalHours - a.totalHours;
                return b.items - a.items;
            });
    }

    private normalizeCapacityDetails(raw: unknown): CapacityDetailsSnapshot | null {
        if (!raw || typeof raw !== 'object') return null;
        const data = raw as Record<string, any>;
        const openRaw = data.unassigned?.open || {};
        const doneRaw = data.unassigned?.done || {};

        return {
            totalPlannedInitial: Number(data.totalPlannedInitial || 0),
            totalPlannedCurrent: Number(data.totalPlannedCurrent || 0),
            totalPlannedDelta: Number(data.totalPlannedDelta || 0),
            totalAddedScope: Number(data.totalAddedScope || 0),
            dayOffDates: Array.isArray(data.dayOffDates)
                ? data.dayOffDates.map((value: unknown) => String(value))
                : [],
            unassigned: {
                totalHours: Math.round(Number(data.unassigned?.totalHours || 0) * 10) / 10,
                items: Number(data.unassigned?.items || 0),
                open: {
                    totalHours: Math.round(Number(openRaw.totalHours || 0) * 10) / 10,
                    remainingHours: Math.round(Number(openRaw.remainingHours || 0) * 10) / 10,
                    items: Number(openRaw.items || 0),
                    byType: this.normalizeTypeBreakdown(openRaw.byType),
                    tasks: this.normalizeTaskList(openRaw.tasks)
                },
                done: {
                    totalHours: Math.round(Number(doneRaw.totalHours || 0) * 10) / 10,
                    items: Number(doneRaw.items || 0),
                    byType: this.normalizeTypeBreakdown(doneRaw.byType),
                    tasks: this.normalizeTaskList(doneRaw.tasks)
                }
            }
        };
    }

    private getWorkItemMetrics(item: any) {
        const currentRemaining = Number(item.remainingWork || 0);
        const currentCompleted = Number(item.completedWork || 0);
        const currentTotal = currentRemaining + currentCompleted;
        const initialFromHistory = Number(item.initialRemainingWork || 0);
        const lastFromHistory = Number(item.lastRemainingWork || 0);
        const doneFromHistory = Number(item.doneRemainingWork || 0);
        const state = String(item.state || '').trim().toLowerCase();
        const isDone = DONE_STATES.has(state);

        const plannedInitial = initialFromHistory > 0
            ? initialFromHistory
            : (lastFromHistory > 0 ? lastFromHistory : currentTotal);

        const plannedFinal = isDone
            ? (doneFromHistory > 0
                ? doneFromHistory
                : (lastFromHistory > 0 ? lastFromHistory : currentTotal))
            : (lastFromHistory > 0 ? lastFromHistory : currentRemaining);

        const completedForItem = isDone
            ? (doneFromHistory > 0
                ? doneFromHistory
                : (lastFromHistory > 0 ? lastFromHistory : currentCompleted))
            : 0;

        const currentForAddedScope = isDone
            ? (doneFromHistory > 0
                ? doneFromHistory
                : (lastFromHistory > 0 ? lastFromHistory : currentRemaining))
            : (lastFromHistory > 0 ? lastFromHistory : currentRemaining);

        const addedScope = currentForAddedScope > initialFromHistory
            ? currentForAddedScope - initialFromHistory
            : 0;

        return {
            currentRemaining,
            plannedInitial,
            plannedFinal,
            completedForItem,
            addedScope,
            isDone
        };
    }

    private buildCapacitySnapshot(
        sprint: any,
        workItems: any[]
    ): SprintCapacitySnapshot {
        const plannedByMember: Record<string, { totalHours: number; items: number }> = {};
        const completedByMember: Record<string, number> = {};
        const unassignedAccumulator = {
            totalHours: 0,
            items: 0,
            open: {
                totalHours: 0,
                remainingHours: 0,
                items: 0,
                byType: {} as UnassignedByTypeAccumulator,
                tasks: [] as UnassignedTaskItem[]
            },
            done: {
                totalHours: 0,
                items: 0,
                byType: {} as UnassignedByTypeAccumulator,
                tasks: [] as UnassignedTaskItem[]
            }
        };

        let totalPlannedInitialFromItems = 0;
        let totalPlannedCurrentFromItems = 0;
        let totalRemainingFromItems = 0;
        let totalCompletedFromItems = 0;
        let totalAddedScope = 0;

        for (const item of workItems) {
            const metrics = this.getWorkItemMetrics(item);
            totalPlannedInitialFromItems += metrics.plannedInitial;
            totalPlannedCurrentFromItems += metrics.plannedFinal;
            totalRemainingFromItems += metrics.currentRemaining;
            totalCompletedFromItems += metrics.completedForItem;
            totalAddedScope += metrics.addedScope;

            if (!item.assignedToId) {
                const typeLabel = String(item.type || 'Other');
                if (!UNASSIGNED_ALLOWED_TYPES.has(typeLabel.trim().toLowerCase())) {
                    continue;
                }

                const target = metrics.isDone ? unassignedAccumulator.done : unassignedAccumulator.open;
                unassignedAccumulator.totalHours += metrics.plannedFinal;
                unassignedAccumulator.items += 1;
                target.totalHours += metrics.plannedFinal;
                target.items += 1;

                if (!metrics.isDone) {
                    unassignedAccumulator.open.remainingHours += metrics.currentRemaining;
                }

                if (!target.byType[typeLabel]) {
                    target.byType[typeLabel] = { items: 0, totalHours: 0 };
                }
                target.byType[typeLabel].items += 1;
                target.byType[typeLabel].totalHours += metrics.plannedFinal;

                if (typeLabel.trim().toLowerCase() === 'task') {
                    target.tasks.push({
                        id: item.id,
                        title: String(item.title || `Work item #${item.id}`),
                        state: String(item.state || ''),
                        plannedHours: Math.round(metrics.plannedFinal * 10) / 10,
                        remainingHours: Math.round(metrics.currentRemaining * 10) / 10,
                        url: item.url || null,
                        azureUrl: buildAzureWorkItemUrl({
                            id: item.id,
                            rawUrl: item.url || null,
                            projectName: sprint.project?.name || null
                        })
                    });
                }

                continue;
            }

            if (!plannedByMember[item.assignedToId]) {
                plannedByMember[item.assignedToId] = { totalHours: 0, items: 0 };
            }

            plannedByMember[item.assignedToId].totalHours += metrics.plannedFinal;
            plannedByMember[item.assignedToId].items += 1;
            completedByMember[item.assignedToId] = (completedByMember[item.assignedToId] || 0) + metrics.completedForItem;
        }

        const baselineInitialFromSnapshot = Number(sprint.snapshots?.[0]?.totalWork || 0);
        const totalPlannedInitial = baselineInitialFromSnapshot > 0
            ? baselineInitialFromSnapshot
            : totalPlannedInitialFromItems;
        const totalPlannedCurrent = totalPlannedCurrentFromItems;
        const totalAvailable = sprint.capacities.reduce(
            (acc: number, cap: any) => acc + Number(cap.availableHours || 0),
            0
        );
        const dayOffDates = this.collectBusinessDayOffDates(
            sprint.capacities.map((cap: any) => ({ daysOff: cap.daysOff })),
            new Date(sprint.startDate),
            new Date(sprint.endDate)
        );

        return {
            totalAvailable,
            totalPlannedInitial,
            totalPlannedCurrent,
            totalPlannedDelta: totalPlannedCurrent - totalPlannedInitial,
            totalRemaining: totalRemainingFromItems,
            totalCompleted: totalCompletedFromItems,
            totalAddedScope,
            dayOffDates,
            unassigned: {
                totalHours: Math.round(unassignedAccumulator.totalHours * 10) / 10,
                items: unassignedAccumulator.items,
                open: {
                    totalHours: Math.round(unassignedAccumulator.open.totalHours * 10) / 10,
                    remainingHours: Math.round(unassignedAccumulator.open.remainingHours * 10) / 10,
                    items: unassignedAccumulator.open.items,
                    byType: this.toSortedTypeBreakdown(unassignedAccumulator.open.byType),
                    tasks: unassignedAccumulator.open.tasks.sort((a, b) => b.plannedHours - a.plannedHours)
                },
                done: {
                    totalHours: Math.round(unassignedAccumulator.done.totalHours * 10) / 10,
                    items: unassignedAccumulator.done.items,
                    byType: this.toSortedTypeBreakdown(unassignedAccumulator.done.byType),
                    tasks: unassignedAccumulator.done.tasks.sort((a, b) => b.plannedHours - a.plannedHours)
                }
            },
            byMember: Object.fromEntries(
                sprint.capacities.map((cap: any) => [
                    cap.memberId,
                    {
                        planned: Math.round(Number(plannedByMember[cap.memberId]?.totalHours || 0) * 10) / 10,
                        completed: Math.round(Number(completedByMember[cap.memberId] || 0) * 10) / 10
                    }
                ])
            )
        };
    }

    private async loadSprintForCapacity(sprintId: string, db: PrismaClient) {
        return db.sprint.findUnique({
            where: { id: sprintId },
            include: {
                project: {
                    select: { name: true }
                },
                capacities: {
                    include: { member: true }
                },
                snapshots: {
                    orderBy: { snapshotDate: 'asc' },
                    take: 1
                }
            }
        });
    }

    private async loadSprintWorkItems(sprintId: string, db: PrismaClient) {
        return db.workItem.findMany({
            where: {
                sprintId,
                isRemoved: false
            },
            select: {
                id: true,
                title: true,
                remainingWork: true,
                completedWork: true,
                initialRemainingWork: true,
                lastRemainingWork: true,
                doneRemainingWork: true,
                assignedToId: true,
                type: true,
                state: true,
                url: true
            }
        });
    }

    async syncSprintCapacity(sprintId: string, projectId: string): Promise<void> {
        try {
            const sprint = await prisma.sprint.findUnique({
                where: { id: sprintId },
                include: { project: true }
            });

            if (!sprint) {
                throw new Error(`Sprint ${sprintId} not found`);
            }

            logger.info(`Syncing capacity for sprint: ${sprint.name} (${sprint.id})`);

            const client = getAzureDevOpsClient();
            const workApi = await client.getWorkApi();
            const coreApi = await client.getCoreApi();

            const teams = await coreApi.getTeams(sprint.project.azureId);
            if (teams.length === 0) {
                logger.warn(`No teams found for project ${sprint.project.name}`);
                return;
            }
            const team = teams[0];

            const teamContext = {
                project: sprint.project.name,
                projectId: sprint.project.azureId,
                team: team.name,
                teamId: team.id
            };

            const api: any = workApi;
            let capacityData;

            try {
                if (typeof api.getCapacitiesWithIdentityRefAndTotals !== 'function') {
                    logger.error('API method getCapacitiesWithIdentityRefAndTotals not found on workApi object');
                    return;
                }
                capacityData = await api.getCapacitiesWithIdentityRefAndTotals(teamContext, sprint.azureId);
            } catch (err: any) {
                logger.error(`Failed to fetch capacity from Azure DevOps: ${err.message}`);
                return;
            }

            let teamDaysOffData = null;
            try {
                if (typeof api.getTeamDaysOff === 'function') {
                    teamDaysOffData = await api.getTeamDaysOff(teamContext, sprint.azureId);
                }
            } catch (err: any) {
                logger.warn(`Could not fetch Team Days Off from Azure DevOps: ${err.message}`);
            }

            if (!capacityData || (!capacityData.teamMembers && !teamDaysOffData)) {
                logger.info(`No capacity data found for sprint ${sprint.name}`);
                return;
            }

            logger.info(`Found ${capacityData.teamMembers ? capacityData.teamMembers.length : 0} team members with capacity data`);

            const sprintStart = new Date(sprint.startDate);
            const sprintEnd = new Date(sprint.endDate);
            const totalSprintDays = this.getBusinessDays(sprintStart, sprintEnd);

            let teamDaysOffCount = 0;
            const teamDaysOff = (teamDaysOffData && teamDaysOffData.daysOff)
                ? teamDaysOffData.daysOff
                : (capacityData.teamDaysOff || []);

            if (teamDaysOff && teamDaysOff.length > 0) {
                for (const dayOff of teamDaysOff) {
                    const start = new Date(dayOff.start);
                    const end = new Date(dayOff.end);
                    for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                        if (dt >= sprintStart && dt <= sprintEnd) {
                            const dayOfWeek = dt.getUTCDay();
                            if (dayOfWeek !== 0 && dayOfWeek !== 6) teamDaysOffCount++;
                        }
                    }
                }
            }

            const netSprintDays = Math.max(0, totalSprintDays - teamDaysOffCount);
            logger.info(`Sprint Days: ${totalSprintDays} - ${teamDaysOffCount} (Team Off) = ${netSprintDays} Net Days`);

            if (capacityData.teamMembers) {
                for (const cap of capacityData.teamMembers) {
                    if (!cap.teamMember || !cap.teamMember.id) continue;

                    const member = await this.syncTeamMember(cap.teamMember, projectId);
                    if (!member) {
                        logger.warn(`Could not sync member ${cap.teamMember.displayName}`);
                        continue;
                    }

                    const capacityPerDay = (cap.activities || []).reduce(
                        (acc: number, activity: any) => acc + Number(activity.capacityPerDay || 0),
                        0
                    );

                    let individualDaysOffCount = 0;
                    if (cap.daysOff) {
                        for (const dayOff of cap.daysOff) {
                            const start = new Date(dayOff.start);
                            const end = new Date(dayOff.end);

                            for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                                if (dt >= sprintStart && dt <= sprintEnd) {
                                    const dayOfWeek = dt.getUTCDay();
                                    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                                        individualDaysOffCount++;
                                    }
                                }
                            }
                        }
                    }

                    const availableDays = Math.max(0, netSprintDays - individualDaysOffCount);
                    const totalHours = capacityPerDay * netSprintDays;
                    const availableHours = capacityPerDay * availableDays;
                    const mergedDaysOff = this.mergeDayOffRanges(cap.daysOff || [], teamDaysOff || []);

                    await prisma.teamCapacity.upsert({
                        where: {
                            memberId_sprintId: {
                                memberId: member.id,
                                sprintId: sprint.id
                            }
                        },
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
                }
            }

            await this.recalculateSprintCapacitySnapshot(sprintId);
            logger.info(`Capacity synced for sprint ${sprint.name}`);
        } catch (error) {
            logger.error(`Error syncing capacity for sprint ${sprintId}:`, { error });
            throw error;
        }
    }

    async recalculateSprintCapacitySnapshot(sprintId: string, db: PrismaClient = prisma): Promise<void> {
        const sprint = await this.loadSprintForCapacity(sprintId, db);
        if (!sprint) {
            throw new Error(`Sprint ${sprintId} not found`);
        }

        const workItems = await this.loadSprintWorkItems(sprintId, db);
        const snapshot = this.buildCapacitySnapshot(sprint, workItems);

        const capacityUpdates = sprint.capacities.map((cap) =>
            db.teamCapacity.update({
                where: { id: cap.id },
                data: {
                    allocatedHours: snapshot.byMember[cap.memberId]?.planned || 0,
                    completedHours: snapshot.byMember[cap.memberId]?.completed || 0
                }
            })
        );

        const details: CapacityDetailsSnapshot = {
            totalPlannedInitial: Math.round(snapshot.totalPlannedInitial * 10) / 10,
            totalPlannedCurrent: Math.round(snapshot.totalPlannedCurrent * 10) / 10,
            totalPlannedDelta: Math.round(snapshot.totalPlannedDelta * 10) / 10,
            totalAddedScope: Math.round(snapshot.totalAddedScope * 10) / 10,
            dayOffDates: snapshot.dayOffDates,
            unassigned: snapshot.unassigned
        };

        await db.$transaction([
            ...capacityUpdates,
            db.sprint.update({
                where: { id: sprintId },
                data: {
                    totalPlannedHours: Math.round(snapshot.totalPlannedCurrent * 10) / 10,
                    totalCompletedHours: Math.round(snapshot.totalCompleted * 10) / 10,
                    totalRemainingHours: Math.round(snapshot.totalRemaining * 10) / 10,
                    teamCapacityHours: Math.round(snapshot.totalAvailable * 10) / 10,
                    commitmentHours: Math.round(snapshot.totalPlannedCurrent * 10) / 10,
                    capacityDetails: details as any,
                    lastCalculatedAt: new Date()
                }
            })
        ]);

        await sprintHistoryService.refreshSprintSummary(sprintId, db);
    }

    private async syncTeamMember(azureMember: any, projectId: string) {
        const existingMember = await prisma.teamMember.findFirst({
            where: {
                azureId: azureMember.id,
                projectId
            }
        });

        if (existingMember) {
            return prisma.teamMember.update({
                where: { id: existingMember.id },
                data: {
                    displayName: azureMember.displayName,
                    imageUrl: azureMember.imageUrl
                }
            });
        }

        return prisma.teamMember.create({
            data: {
                azureId: azureMember.id,
                displayName: azureMember.displayName,
                uniqueName: azureMember.uniqueName || azureMember.displayName,
                imageUrl: azureMember.imageUrl,
                projectId
            }
        });
    }

    private getBusinessDays(startDate: Date, endDate: Date): number {
        let count = 0;
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const dayOfWeek = currentDate.getUTCDay();
            if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
            currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        }
        return count;
    }

    private collectBusinessDayOffDates(
        capacities: Array<{ daysOff: unknown }>,
        sprintStart: Date,
        sprintEnd: Date
    ): string[] {
        if (!capacities.length) return [];

        const startMs = Date.UTC(
            sprintStart.getUTCFullYear(),
            sprintStart.getUTCMonth(),
            sprintStart.getUTCDate()
        );
        const endMs = Date.UTC(
            sprintEnd.getUTCFullYear(),
            sprintEnd.getUTCMonth(),
            sprintEnd.getUTCDate()
        );

        const memberDaySets: Array<Set<string>> = capacities.map((cap) => {
            const memberSet = new Set<string>();
            const ranges = (cap.daysOff as any[]) || [];

            for (const range of ranges) {
                if (!range?.start || !range?.end) continue;

                const start = new Date(range.start);
                const end = new Date(range.end);
                if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;

                for (let current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
                    const dayMs = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
                    if (dayMs < startMs || dayMs > endMs) continue;

                    const dayOfWeek = current.getUTCDay();
                    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

                    memberSet.add(current.toISOString().slice(0, 10));
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

        return Array.from(intersection).sort();
    }

    async getCapacityVsPlanned(sprintId: string) {
        let sprint = await this.loadSprintForCapacity(sprintId, prisma);
        if (!sprint) throw new Error('Sprint not found');

        let details = this.normalizeCapacityDetails(sprint.capacityDetails);
        if (!details || !sprint.lastCalculatedAt) {
            await this.recalculateSprintCapacitySnapshot(sprintId, prisma);
            sprint = await this.loadSprintForCapacity(sprintId, prisma);
            if (!sprint) throw new Error('Sprint not found');
            details = this.normalizeCapacityDetails(sprint.capacityDetails);
        }

        const normalizedDetails = details || {
            totalPlannedInitial: Number(sprint.totalPlannedHours || 0),
            totalPlannedCurrent: Number(sprint.totalPlannedHours || 0),
            totalPlannedDelta: 0,
            totalAddedScope: 0,
            dayOffDates: this.collectBusinessDayOffDates(
                sprint.capacities.map((cap) => ({ daysOff: cap.daysOff })),
                new Date(sprint.startDate),
                new Date(sprint.endDate)
            ),
            unassigned: this.createEmptyUnassignedSummary()
        };

        const totalAvailable = Number(
            sprint.teamCapacityHours
            ?? sprint.capacities.reduce((acc, cap) => acc + Number(cap.availableHours || 0), 0)
        );
        const totalPlanned = Number(sprint.totalPlannedHours || normalizedDetails.totalPlannedCurrent || 0);
        const totalCompleted = Number(sprint.totalCompletedHours || 0);
        const totalRemaining = Number(sprint.totalRemainingHours || 0);

        logger.info(`Capacity comparison served from persisted snapshot for sprint ${sprintId}`, {
            totalAvailable,
            totalPlanned,
            totalCompleted,
            totalRemaining,
            lastCalculatedAt: sprint.lastCalculatedAt
        });

        return {
            sprint: {
                id: sprint.id,
                name: sprint.name,
                startDate: sprint.startDate,
                endDate: sprint.endDate
            },
            summary: {
                totalAvailable,
                totalPlanned,
                totalPlannedInitial: normalizedDetails.totalPlannedInitial,
                totalPlannedCurrent: normalizedDetails.totalPlannedCurrent,
                totalPlannedDelta: normalizedDetails.totalPlannedDelta,
                totalRemaining,
                totalCompleted,
                totalAddedScope: normalizedDetails.totalAddedScope,
                dayOffDates: normalizedDetails.dayOffDates,
                unassigned: normalizedDetails.unassigned,
                balance: totalAvailable - totalPlanned,
                utilization: totalAvailable > 0
                    ? Math.round((totalPlanned / totalAvailable) * 100)
                    : 0
            },
            byMember: sprint.capacities.map((cap) => {
                const planned = Number(cap.allocatedHours || 0);
                const completed = Number((cap as any).completedHours || 0);
                const capacity = Number(cap.availableHours || 0);
                const completionPct = capacity > 0 ? Math.round((completed / capacity) * 100) : 0;
                const remainingToCapacity = Math.max(0, capacity - completed);
                const overCapacity = Math.max(0, completed - capacity);

                return {
                    member: cap.member,
                    capacity,
                    planned,
                    completed,
                    completionPct,
                    remainingToCapacity,
                    overCapacity,
                    balance: capacity - planned,
                    utilization: capacity > 0 ? Math.round((planned / capacity) * 100) : 0
                };
            })
        };
    }
}

export const capacityService = new CapacityService();
