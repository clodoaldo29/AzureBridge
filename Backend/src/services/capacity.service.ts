import { PrismaClient } from '@prisma/client';
import { getAzureDevOpsClient } from '@/integrations/azure/client';
import { logger } from '@/utils/logger';

const prisma = new PrismaClient();

export class CapacityService {
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
                            daysOff: cap.daysOff || [],
                            activitiesPerDay: cap.activities || []
                        },
                        update: {
                            totalHours,
                            availableHours,
                            daysOff: cap.daysOff || [],
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

    /**
     * Get Capacity vs Planned Work comparison for a sprint
     */
    async getCapacityVsPlanned(sprintId: string) {
        const sprint = await prisma.sprint.findUnique({
            where: { id: sprintId },
            include: {
                capacities: {
                    include: { member: true }
                }
            }
        });

        if (!sprint) throw new Error('Sprint not found');

        // Fetch ALL planned work items (assigned + unassigned)
        const workItems = await prisma.workItem.findMany({
            where: {
                sprintId: sprintId,
                isRemoved: false
            },
            select: {
                id: true,
                title: true,
                remainingWork: true,
                assignedToId: true,
                type: true,
                state: true
            }
        });

        // Group planned work by member
        const plannedByMember: Record<string, { totalHours: number, items: number }> = {};
        const unassignedWork = { totalHours: 0, items: 0 };

        workItems.forEach(item => {
            // Unassigned work (items without assignedToId)
            if (!item.assignedToId) {
                unassignedWork.totalHours += (item.remainingWork || 0);
                unassignedWork.items += 1;
                return;
            }

            if (!plannedByMember[item.assignedToId]) {
                plannedByMember[item.assignedToId] = { totalHours: 0, items: 0 };
            }

            // Sum Remaining Work (default to 0 if null)
            const hours = item.remainingWork || 0;
            plannedByMember[item.assignedToId].totalHours += hours;
            plannedByMember[item.assignedToId].items += 1;
        });

        // Build response
        const byMember = sprint.capacities
            .filter(cap => cap.member)
            .map(cap => {
                const planned = plannedByMember[cap.memberId] || { totalHours: 0, items: 0 };

                return {
                    member: {
                        id: cap.memberId,
                        displayName: cap.member.displayName,
                        imageUrl: cap.member.imageUrl,
                        uniqueName: cap.member.uniqueName
                    },
                    capacity: {
                        total: cap.totalHours,
                        available: cap.availableHours,
                        daysOffCount: (cap.daysOff as any[])?.length || 0
                    },
                    planned: {
                        total: planned.totalHours,
                        itemsCount: planned.items
                    },
                    balance: cap.availableHours - planned.totalHours,
                    // Utilization percentage
                    utilization: cap.availableHours > 0
                        ? Math.round((planned.totalHours / cap.availableHours) * 100)
                        : 0
                };
            });

        // Sort by utilization desc
        byMember.sort((a, b) => b.utilization - a.utilization);

        const summary = byMember.reduce((acc, curr) => ({
            totalAvailable: acc.totalAvailable + curr.capacity.available,
            totalPlanned: acc.totalPlanned + curr.planned.total, // Only assigned here
            totalMembers: acc.totalMembers + 1
        }), { totalAvailable: 0, totalPlanned: 0, totalMembers: 0 });

        // Add unassigned to total planned for global view
        const totalPlannedWithUnassigned = summary.totalPlanned + unassignedWork.totalHours;

        return {
            sprint: {
                id: sprint.id,
                name: sprint.name,
                startDate: sprint.startDate,
                endDate: sprint.endDate
            },
            summary: {
                ...summary, // contains sum of assigned only
                totalPlanned: totalPlannedWithUnassigned, // Override with Total (Assigned + Unassigned)
                unassigned: unassignedWork,
                balance: summary.totalAvailable - totalPlannedWithUnassigned,
                utilization: summary.totalAvailable > 0
                    ? Math.round((totalPlannedWithUnassigned / summary.totalAvailable) * 100)
                    : 0
            },
            byMember
        };
    }
}

export const capacityService = new CapacityService();
