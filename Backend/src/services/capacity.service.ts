import { PrismaClient } from '@prisma/client';
import { getAzureDevOpsClient } from '@/integrations/azure/client';
import { logger } from '@/utils/logger';

const prisma = new PrismaClient();

export class CapacityService {
    private mergeDayOffRanges(memberDaysOff: any[], teamDaysOff: any[]): any[] {
        const merged = [...(memberDaysOff || []), ...(teamDaysOff || [])];
        const seen = new Set<string>();
        return merged.filter((r: any) => {
            if (!r?.start || !r?.end) return false;
            const key = `${new Date(r.start).toISOString()}|${new Date(r.end).toISOString()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    /**
     * Sync capacity for a specific sprint
     */
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

            // Get Team
            const teams = await coreApi.getTeams(sprint.project.azureId);
            if (teams.length === 0) {
                logger.warn(`No teams found for project ${sprint.project.name}`);
                return;
            }
            const team = teams[0]; // TODO: Support multiple teams

            const teamContext = {
                project: sprint.project.name,
                projectId: sprint.project.azureId,
                team: team.name,
                teamId: team.id
            };

            // Fetch capacity using runtime method check
            const api: any = workApi;
            let capacityData;

            try {
                if (typeof api.getCapacitiesWithIdentityRefAndTotals === 'function') {
                    capacityData = await api.getCapacitiesWithIdentityRefAndTotals(teamContext, sprint.azureId);
                } else {
                    logger.error('API method getCapacitiesWithIdentityRefAndTotals not found on workApi object');
                    return;
                }
            } catch (err: any) {
                logger.error(`Failed to fetch capacity from Azure DevOps: ${err.message}`);
                return;
            }

            // Fetch Team Days Off explicitly
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

            // Calculate Team Days Off (Business Days only)
            let teamDaysOffCount = 0;
            const teamDaysOff = (teamDaysOffData && teamDaysOffData.daysOff) ? teamDaysOffData.daysOff : (capacityData.teamDaysOff || []);

            if (teamDaysOff && teamDaysOff.length > 0) {
                for (const d of teamDaysOff) {
                    const start = new Date(d.start);
                    const end = new Date(d.end);
                    // Iterate checking business days overlap with sprint
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
                // Process each team member
                for (const cap of capacityData.teamMembers) {
                    if (!cap.teamMember || !cap.teamMember.id) continue;

                    // Sync Member
                    const member = await this.syncTeamMember(cap.teamMember, projectId);

                    if (!member) {
                        logger.warn(`Could not sync member ${cap.teamMember.displayName}`);
                        continue;
                    }

                    // Calculate hours
                    const capacityPerDay = cap.activities.reduce((acc: number, act: any) => acc + (act.capacityPerDay || 0), 0) || 0;

                    // Calculate individual days off intersection with sprint
                    let individualDaysOffCount = 0;
                    if (cap.daysOff) {
                        for (const d of cap.daysOff) {
                            const start = new Date(d.start);
                            const end = new Date(d.end);

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

                    // Create or Update Capacity
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

            logger.info(`Capacity synced for sprint ${sprint.name}`);

        } catch (error) {
            logger.error(`Error syncing capacity for sprint ${sprintId}:`, { error });
            throw error;
        }
    }

    /**
     * Helper to sync team member
     */
    private async syncTeamMember(azureMember: any, projectId: string) {
        const existingMember = await prisma.teamMember.findFirst({
            where: {
                azureId: azureMember.id,
                projectId: projectId
            }
        });

        if (existingMember) {
            return await prisma.teamMember.update({
                where: { id: existingMember.id },
                data: {
                    displayName: azureMember.displayName,
                    imageUrl: azureMember.imageUrl
                }
            });
        } else {
            return await prisma.teamMember.create({
                data: {
                    azureId: azureMember.id,
                    displayName: azureMember.displayName,
                    uniqueName: azureMember.uniqueName || azureMember.displayName,
                    imageUrl: azureMember.imageUrl,
                    projectId: projectId
                }
            });
        }
    }

    private getBusinessDays(startDate: Date, endDate: Date): number {
        let count = 0;
        const curDate = new Date(startDate);
        while (curDate <= endDate) {
            const dayOfWeek = curDate.getUTCDay();
            if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
            curDate.setUTCDate(curDate.getUTCDate() + 1);
        }
        return count;
    }

    private collectBusinessDayOffDates(
        capacities: Array<{ daysOff: unknown }>,
        sprintStart: Date,
        sprintEnd: Date
    ): string[] {
        const dayOffSet = new Set<string>();
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

        for (const cap of capacities) {
            const ranges = (cap.daysOff as any[]) || [];
            for (const r of ranges) {
                if (!r?.start || !r?.end) continue;
                const rangeStart = new Date(r.start);
                const rangeEnd = new Date(r.end);
                const cur = new Date(Date.UTC(
                    rangeStart.getUTCFullYear(),
                    rangeStart.getUTCMonth(),
                    rangeStart.getUTCDate()
                ));
                const end = new Date(Date.UTC(
                    rangeEnd.getUTCFullYear(),
                    rangeEnd.getUTCMonth(),
                    rangeEnd.getUTCDate()
                ));

                while (cur <= end) {
                    const curMs = cur.getTime();
                    const day = cur.getUTCDay();
                    if (curMs >= startMs && curMs <= endMs && day !== 0 && day !== 6) {
                        dayOffSet.add(cur.toISOString().slice(0, 10));
                    }
                    cur.setUTCDate(cur.getUTCDate() + 1);
                }
            }
        }

        return Array.from(dayOffSet).sort();
    }

    /**
     * Get Capacity vs Planned Work comparison for a sprint
     * Uses first sprint snapshot as baseline for planned hours to handle cases
     * where Remaining Work is zeroed when items move to Review/Done
     */
    async getCapacityVsPlanned(sprintId: string) {
        const sprint = await prisma.sprint.findUnique({
            where: { id: sprintId },
            include: {
                capacities: {
                    include: { member: true }
                },
                snapshots: {
                    orderBy: { snapshotDate: 'asc' },
                    take: 1 // Get first snapshot as baseline
                }
            }
        });

        if (!sprint) throw new Error('Sprint not found');

        // Calculate planned hours using persistent field (initialRemainingWork)
        // This is the most accurate source as it preserves historical planning per item
        const workItemsReceived = await prisma.workItem.findMany({
            where: {
                sprintId: sprintId,
                isRemoved: false
            },
            select: {
                id: true,
                title: true,
                remainingWork: true,
                completedWork: true,
                // @ts-ignore - Field exists in DB but client might not be generated yet
                initialRemainingWork: true,
                // @ts-ignore - Field exists in DB but client might not be generated yet
                lastRemainingWork: true,
                // @ts-ignore - Field exists in DB but client might not be generated yet
                doneRemainingWork: true,
                assignedToId: true,
                type: true,
                state: true
            }
        });

        const workItems = workItemsReceived as any[]; // Cast to any to access new field


        // Group planned work by member
        const plannedByMember: Record<string, { totalHours: number, items: number }> = {};
        const completedByMember: Record<string, number> = {};
        const unassignedWork = { totalHours: 0, items: 0 };
        let totalPlannedInitialFromItems = 0;
        let totalPlannedCurrentFromItems = 0;
        let totalRemainingFromItems = 0;
        let totalCompletedFromItems = 0;

        workItems.forEach(item => {
            // Determine planned hours for this item:
            // 1. Use initialRemainingWork if available (historical truth)
            // 2. Fallback to remainingWork (current truth)
            // Determine planned hours for this item:
            // 1. Use initialRemainingWork if available (historical truth)
            // 2. Fallback to remainingWork (current truth)
            const currentRemaining = item.remainingWork || 0;
            const currentCompleted = item.completedWork || 0;
            const currentTotal = currentRemaining + currentCompleted;

            const initialFromHistory = (item as any).initialRemainingWork || 0;
            const lastFromHistory = (item as any).lastRemainingWork || 0;
            const doneFromHistory = (item as any).doneRemainingWork || 0;

            const state = (item.state || '').toLowerCase();
            const isDone = state === 'done' || state === 'closed' || state === 'completed';

            const plannedInitial = initialFromHistory > 0
                ? initialFromHistory
                : (lastFromHistory > 0 ? lastFromHistory : currentTotal);

            const plannedFinal = isDone
                ? (doneFromHistory > 0
                    ? doneFromHistory
                    : (lastFromHistory > 0 ? lastFromHistory : currentTotal))
                : (lastFromHistory > 0 ? lastFromHistory : currentRemaining);

            totalPlannedInitialFromItems += plannedInitial;
            totalPlannedCurrentFromItems += plannedFinal;
            totalRemainingFromItems += currentRemaining;

            const completedForItem = isDone
                ? (doneFromHistory > 0 ? doneFromHistory : (lastFromHistory > 0 ? lastFromHistory : currentCompleted))
                : 0;

            totalCompletedFromItems += completedForItem;

            // Unassigned work (items without assignedToId)
            if (!item.assignedToId) {
                unassignedWork.totalHours += plannedFinal;
                unassignedWork.items += 1;
                return;
            }

            if (!plannedByMember[item.assignedToId]) {
                plannedByMember[item.assignedToId] = { totalHours: 0, items: 0 };
            }

            plannedByMember[item.assignedToId].totalHours += plannedFinal;
            plannedByMember[item.assignedToId].items += 1;
            completedByMember[item.assignedToId] = (completedByMember[item.assignedToId] || 0) + completedForItem;
        });

        // Freeze initial planned by sprint baseline (first snapshot), fallback to items sum.
        const baselineInitialFromSnapshot = sprint.snapshots[0]?.totalWork || 0;
        const totalPlannedInitial = baselineInitialFromSnapshot > 0
            ? baselineInitialFromSnapshot
            : totalPlannedInitialFromItems;
        const totalPlannedCurrent = totalPlannedCurrentFromItems;
        const totalPlannedDelta = totalPlannedCurrent - totalPlannedInitial;
        const dayOffDates = this.collectBusinessDayOffDates(
            sprint.capacities.map(c => ({ daysOff: c.daysOff })),
            new Date(sprint.startDate),
            new Date(sprint.endDate)
        );

        // For backward compatibility, keep totalPlanned as current plan
        const totalPlanned = totalPlannedCurrent;

        // Calculate total remaining
        const totalRemaining = totalRemainingFromItems;
        let totalAddedScope = 0;

        workItems.forEach(item => {
            const start = (item as any).initialRemainingWork || 0;
            const last = (item as any).lastRemainingWork || 0;
            const done = (item as any).doneRemainingWork || 0;
            const state = (item.state || '').toLowerCase();
            const isDone = state === 'done' || state === 'closed' || state === 'completed';
            const current = isDone
                ? (done > 0 ? done : (last > 0 ? last : (item.remainingWork || 0)))
                : (last > 0 ? last : (item.remainingWork || 0));
            if (current > start) {
                totalAddedScope += (current - start);
            }
        });

        logger.info(`Planned hours calculation for sprint ${sprintId}:`, {
            method: 'persistent_field',
            totalPlannedInitial,
            totalPlannedCurrent,
            totalPlannedDelta,
            totalRemaining,
            totalAddedScope
        });

        return {
            sprint: {
                id: sprint.id,
                name: sprint.name,
                startDate: sprint.startDate,
                endDate: sprint.endDate
            },
            summary: {
                totalAvailable: sprint.capacities.reduce((acc, cap) => acc + (cap.availableHours || 0), 0),
                totalPlanned: totalPlanned,
                totalPlannedInitial,
                totalPlannedCurrent,
                totalPlannedDelta,
                totalRemaining: totalRemaining,
                totalCompleted: totalCompletedFromItems,
                totalAddedScope: totalAddedScope,
                dayOffDates,
                unassigned: unassignedWork,
                balance: sprint.capacities.reduce((acc, cap) => acc + (cap.availableHours || 0), 0) - totalPlanned,
                utilization: sprint.capacities.reduce((acc, cap) => acc + (cap.availableHours || 0), 0) > 0
                    ? Math.round((totalPlanned / sprint.capacities.reduce((acc, cap) => acc + (cap.availableHours || 0), 0)) * 100)
                    : 0
            },
            byMember: sprint.capacities.map(cap => {
                const planned = plannedByMember[cap.memberId] ? plannedByMember[cap.memberId].totalHours : 0;
                const completed = completedByMember[cap.memberId] || 0;
                const capacity = cap.availableHours || 0;
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
                    balance: (cap.availableHours || 0) - planned,
                    utilization: (cap.availableHours || 0) > 0 ? Math.round((planned / (cap.availableHours || 0)) * 100) : 0
                };
            })
        };
    }
}

export const capacityService = new CapacityService();
