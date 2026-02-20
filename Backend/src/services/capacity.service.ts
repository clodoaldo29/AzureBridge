import { PrismaClient } from '@prisma/client';
import { getAzureDevOpsClient } from '@/integrations/azure/client';
import { logger } from '@/utils/logger';

const prisma = new PrismaClient();
const UNASSIGNED_ALLOWED_TYPES = new Set(['task', 'bug', 'test case']);

type UnassignedByTypeAccumulator = Record<string, { items: number; totalHours: number }>;

export class CapacityService {
    private toSortedTypeBreakdown(acc: UnassignedByTypeAccumulator): Array<{ type: string; items: number; totalHours: number }> {
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
        return merged.filter((r: any) => {
            if (!r?.start || !r?.end) return false;
            const key = `${new Date(r.start).toISOString()}|${new Date(r.end).toISOString()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    /**
     * Sincronizar capacidade para uma sprint especifica
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

            // Obter Time
            const teams = await coreApi.getTeams(sprint.project.azureId);
            if (teams.length === 0) {
                logger.warn(`No teams found for project ${sprint.project.name}`);
                return;
            }
            const team = teams[0]; // TODO: Suportar multiplos times

            const teamContext = {
                project: sprint.project.name,
                projectId: sprint.project.azureId,
                team: team.name,
                teamId: team.id
            };

            // Buscar capacidade verificando metodo disponivel em runtime
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

            // Buscar folgas do time explicitamente
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

            // Calcular folgas do time (apenas dias uteis)
            let teamDaysOffCount = 0;
            const teamDaysOff = (teamDaysOffData && teamDaysOffData.daysOff) ? teamDaysOffData.daysOff : (capacityData.teamDaysOff || []);

            if (teamDaysOff && teamDaysOff.length > 0) {
                for (const d of teamDaysOff) {
                    const start = new Date(d.start);
                    const end = new Date(d.end);
                    // Iterar verificando sobreposicao de dias uteis com a sprint
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
                // Processar cada membro do time
                for (const cap of capacityData.teamMembers) {
                    if (!cap.teamMember || !cap.teamMember.id) continue;

                    // Sincronizar membro
                    const member = await this.syncTeamMember(cap.teamMember, projectId);

                    if (!member) {
                        logger.warn(`Could not sync member ${cap.teamMember.displayName}`);
                        continue;
                    }

                    // Calcular horas
                    const capacityPerDay = cap.activities.reduce((acc: number, act: any) => acc + (act.capacityPerDay || 0), 0) || 0;

                    // Calcular intersecao de folgas individuais com a sprint
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

                    // Criar ou atualizar capacidade
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
     * Helper para sincronizar membro do time
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
     * Obter comparacao Capacidade vs Trabalho Planejado para uma sprint
     * Usa primeiro snapshot da sprint como baseline para horas planejadas
     * pois Remaining Work zera quando itens movem para Review/Done
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
                    take: 1 // Obter primeiro snapshot como baseline
                }
            }
        });

        if (!sprint) throw new Error('Sprint not found');

        // Calcular horas planejadas usando campo persistente (initialRemainingWork)
        // Fonte mais precisa pois preserva o planejamento historico por item
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
                // @ts-ignore - Campo existe no BD mas o client pode nao estar gerado ainda
                initialRemainingWork: true,
                // @ts-ignore - Campo existe no BD mas o client pode nao estar gerado ainda
                lastRemainingWork: true,
                // @ts-ignore - Campo existe no BD mas o client pode nao estar gerado ainda
                doneRemainingWork: true,
                assignedToId: true,
                type: true,
                state: true
            }
        });

        const workItems = workItemsReceived as any[]; // Cast to any to access new field


        // Agrupar trabalho planejado por membro
        const plannedByMember: Record<string, { totalHours: number, items: number }> = {};
        const completedByMember: Record<string, number> = {};
        const unassignedWork = {
            totalHours: 0,
            // Backward compatibility: previous UI consumed "items".
            items: 0,
            open: {
                totalHours: 0,
                remainingHours: 0,
                items: 0,
                byType: {} as UnassignedByTypeAccumulator
            },
            done: {
                totalHours: 0,
                items: 0,
                byType: {} as UnassignedByTypeAccumulator
            }
        };
        let totalPlannedInitialFromItems = 0;
        let totalPlannedCurrentFromItems = 0;
        let totalRemainingFromItems = 0;
        let totalCompletedFromItems = 0;

        workItems.forEach(item => {
            // Determinar horas planejadas para este item:
            // 1. Usar initialRemainingWork se disponivel (verdade historica)
            // 2. Fallback para remainingWork (verdade atual)
            // Determinar horas planejadas para este item:
            // 1. Usar initialRemainingWork se disponivel (verdade historica)
            // 2. Fallback para remainingWork (verdade atual)
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

            // Trabalho nao atribuido (itens sem assignedToId)
            if (!item.assignedToId) {
                const typeLabel = String(item.type || 'Other');
                const isAllowedUnassignedType = UNASSIGNED_ALLOWED_TYPES.has(typeLabel.trim().toLowerCase());
                if (!isAllowedUnassignedType) {
                    return;
                }
                unassignedWork.totalHours += plannedFinal;
                unassignedWork.items += 1;

                if (isDone) {
                    unassignedWork.done.totalHours += plannedFinal;
                    unassignedWork.done.items += 1;
                    if (!unassignedWork.done.byType[typeLabel]) {
                        unassignedWork.done.byType[typeLabel] = { items: 0, totalHours: 0 };
                    }
                    unassignedWork.done.byType[typeLabel].items += 1;
                    unassignedWork.done.byType[typeLabel].totalHours += plannedFinal;
                } else {
                    unassignedWork.open.totalHours += plannedFinal;
                    unassignedWork.open.remainingHours += currentRemaining;
                    unassignedWork.open.items += 1;
                    if (!unassignedWork.open.byType[typeLabel]) {
                        unassignedWork.open.byType[typeLabel] = { items: 0, totalHours: 0 };
                    }
                    unassignedWork.open.byType[typeLabel].items += 1;
                    unassignedWork.open.byType[typeLabel].totalHours += plannedFinal;
                }

                return;
            }

            if (!plannedByMember[item.assignedToId]) {
                plannedByMember[item.assignedToId] = { totalHours: 0, items: 0 };
            }

            plannedByMember[item.assignedToId].totalHours += plannedFinal;
            plannedByMember[item.assignedToId].items += 1;
            completedByMember[item.assignedToId] = (completedByMember[item.assignedToId] || 0) + completedForItem;
        });

        // Congelar planejado inicial pelo baseline da sprint (primeiro snapshot), fallback para soma dos itens.
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

        // Para compatibilidade retroativa, manter totalPlanned como plano atual
        const totalPlanned = totalPlannedCurrent;

        // Calcular total restante
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
                unassigned: {
                    totalHours: Math.round(unassignedWork.totalHours * 10) / 10,
                    items: unassignedWork.items,
                    open: {
                        totalHours: Math.round(unassignedWork.open.totalHours * 10) / 10,
                        remainingHours: Math.round(unassignedWork.open.remainingHours * 10) / 10,
                        items: unassignedWork.open.items,
                        byType: this.toSortedTypeBreakdown(unassignedWork.open.byType)
                    },
                    done: {
                        totalHours: Math.round(unassignedWork.done.totalHours * 10) / 10,
                        items: unassignedWork.done.items,
                        byType: this.toSortedTypeBreakdown(unassignedWork.done.byType)
                    }
                },
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
