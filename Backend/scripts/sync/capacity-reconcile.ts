import { PrismaClient } from '@prisma/client';
import { capacityService } from '../../src/services/capacity.service';

type AzureTeam = {
    id?: string;
    name?: string;
};

type AzureCapacityActivity = {
    name?: string;
    capacityPerDay?: number;
};

type AzureCapacityRow = {
    teamMember?: {
        id?: string;
        displayName?: string;
        uniqueName?: string;
        imageUrl?: string;
    } | null;
    activities?: AzureCapacityActivity[];
    daysOff?: Array<{ start?: string; end?: string }>;
};

type CapacityCandidate = {
    azureId: string;
    displayName: string;
    uniqueName: string;
    imageUrl: string | null;
    teamId: string | null;
    teamName: string | null;
    activities: AzureCapacityActivity[];
    daysOff: Array<{ start?: string; end?: string }>;
    totalHours: number;
    availableHours: number;
    source: 'visible' | 'historical';
};

type IdentityInfo = {
    displayName: string;
    uniqueName: string;
};

export type HistoricalCapacityReconcileResult = {
    sprintId: string;
    sprintName: string;
    projectName: string;
    changed: boolean;
    skipped: boolean;
    reason?: string;
    localRows: number;
    finalRows: number;
    localAvailableHours: number;
    finalAvailableHours: number;
    aggregateCapacityPerDay: number | null;
    aggregateExpectedHours: number | null;
    visibleRows: number;
    recoveredHiddenRows: number;
    addedRows: number;
    updatedRows: number;
    removedRows: number;
};

export type HistoricalCapacityReconcileOptions = {
    prisma: PrismaClient;
    coreApi: any;
    workApi: any;
    sprint: any;
    orgUrl: string;
    pat: string;
    dryRun?: boolean;
};

function roundHours(value: number): number {
    return Math.round(Number(value || 0) * 10) / 10;
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

function countBusinessDaysOff(
    daysOff: Array<{ start?: string; end?: string }> | undefined,
    sprintStart: Date,
    sprintEnd: Date
): number {
    let count = 0;
    for (const range of daysOff || []) {
        if (!range?.start || !range?.end) continue;

        const start = new Date(range.start);
        const end = new Date(range.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

        for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
            if (dt < sprintStart || dt > sprintEnd) continue;
            const day = dt.getUTCDay();
            if (day !== 0 && day !== 6) count++;
        }
    }
    return count;
}

function mergeDayOffRanges(
    memberDaysOff: Array<{ start?: string; end?: string }> | undefined,
    teamDaysOff: Array<{ start?: string; end?: string }> | undefined
): Array<{ start?: string; end?: string }> {
    const merged = [...(memberDaysOff || []), ...(teamDaysOff || [])];
    const seen = new Set<string>();
    return merged.filter((range) => {
        if (!range?.start || !range?.end) return false;
        const key = `${new Date(range.start).toISOString()}|${new Date(range.end).toISOString()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getCapacityPerDay(activities: AzureCapacityActivity[] | undefined): number {
    return (activities || []).reduce((acc, activity) => acc + Number(activity.capacityPerDay || 0), 0);
}

function buildCandidate(input: {
    azureId: string;
    displayName: string;
    uniqueName: string;
    imageUrl?: string | null;
    team: AzureTeam;
    row: AzureCapacityRow;
    teamDaysOff: Array<{ start?: string; end?: string }>;
    sprintStart: Date;
    sprintEnd: Date;
    totalSprintDays: number;
    source: 'visible' | 'historical';
}): CapacityCandidate {
    const activities = input.row.activities || [];
    const capacityPerDay = getCapacityPerDay(activities);
    const teamDaysOffCount = countBusinessDaysOff(input.teamDaysOff, input.sprintStart, input.sprintEnd);
    const netSprintDays = Math.max(0, input.totalSprintDays - teamDaysOffCount);
    const individualDaysOff = countBusinessDaysOff(input.row.daysOff, input.sprintStart, input.sprintEnd);
    const availableDays = Math.max(0, netSprintDays - individualDaysOff);
    const totalHours = capacityPerDay * netSprintDays;
    const availableHours = capacityPerDay * availableDays;

    return {
        azureId: input.azureId,
        displayName: input.displayName,
        uniqueName: input.uniqueName,
        imageUrl: input.imageUrl || null,
        teamId: input.team.id || null,
        teamName: input.team.name || null,
        activities,
        daysOff: mergeDayOffRanges(input.row.daysOff, input.teamDaysOff),
        totalHours,
        availableHours,
        source: input.source,
    };
}

async function fetchJson(url: string, pat: string): Promise<{ status: number; data: any }> {
    const token = Buffer.from(`:${pat}`).toString('base64');
    const response = await fetch(url, {
        headers: {
            Authorization: `Basic ${token}`,
            Accept: 'application/json',
        },
    });
    const text = await response.text();
    let data: any = text;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    return { status: response.status, data };
}

function getOrgName(orgUrl: string): string {
    const parsed = new URL(orgUrl);
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts.length > 0) return pathParts[0];
    return parsed.hostname.split('.')[0];
}

function encodePathPart(value: string): string {
    return encodeURIComponent(value);
}

async function getIterationCapacityPerDay(input: {
    orgUrl: string;
    pat: string;
    projectName: string;
    iterationId: string;
}): Promise<number | null> {
    if (!input.orgUrl || !input.pat) return null;

    const base = input.orgUrl.replace(/\/$/, '');
    const url = `${base}/${encodePathPart(input.projectName)}/_apis/work/iterations/${input.iterationId}/iterationcapacities?api-version=7.1`;
    const response = await fetchJson(url, input.pat);
    if (response.status < 200 || response.status >= 300) return null;
    return Number(response.data?.totalIterationCapacityPerDay ?? 0);
}

async function getIdentityMap(input: {
    orgUrl: string;
    pat: string;
    azureIds: string[];
}): Promise<Map<string, IdentityInfo>> {
    const uniqueIds = Array.from(new Set(input.azureIds.filter(Boolean)));
    const result = new Map<string, IdentityInfo>();
    if (!uniqueIds.length || !input.orgUrl || !input.pat) return result;

    const orgName = getOrgName(input.orgUrl);
    const url = `https://vssps.dev.azure.com/${encodePathPart(orgName)}/_apis/Identities?identityIds=${uniqueIds.join(',')}&api-version=7.1-preview.1`;
    const response = await fetchJson(url, input.pat);
    if (response.status < 200 || response.status >= 300) return result;

    for (const identity of response.data?.value || []) {
        const id = String(identity.id || '');
        if (!id) continue;
        const account = String(identity.properties?.Account?.$value || identity.properties?.Mail?.$value || '');
        const displayName = String(identity.customDisplayName || identity.providerDisplayName || account || id);
        result.set(id, {
            displayName,
            uniqueName: account || displayName,
        });
    }

    return result;
}

async function getTeamDaysOff(
    workApi: any,
    teamContext: any,
    sprintAzureId: string
): Promise<Array<{ start?: string; end?: string }>> {
    try {
        const data = await workApi.getTeamDaysOff(teamContext, sprintAzureId);
        return data?.daysOff || [];
    } catch {
        return [];
    }
}

async function getVisibleCandidates(input: {
    workApi: any;
    teams: AzureTeam[];
    sprint: any;
    sprintStart: Date;
    sprintEnd: Date;
    totalSprintDays: number;
}): Promise<Map<string, CapacityCandidate>> {
    const candidates = new Map<string, CapacityCandidate>();

    for (const team of input.teams) {
        const teamContext = {
            project: input.sprint.project.name,
            projectId: input.sprint.project.azureId,
            team: team.name,
            teamId: team.id,
        };

        let capacityData: any;
        try {
            capacityData = await input.workApi.getCapacitiesWithIdentityRefAndTotals(teamContext, input.sprint.azureId);
        } catch {
            continue;
        }

        if (!capacityData?.teamMembers?.length) continue;
        const teamDaysOff = await getTeamDaysOff(input.workApi, teamContext, input.sprint.azureId);

        for (const row of capacityData.teamMembers as AzureCapacityRow[]) {
            const azureId = String(row.teamMember?.id || '');
            if (!azureId) continue;

            candidates.set(azureId, buildCandidate({
                azureId,
                displayName: String(row.teamMember?.displayName || row.teamMember?.uniqueName || azureId),
                uniqueName: String(row.teamMember?.uniqueName || row.teamMember?.displayName || azureId),
                imageUrl: row.teamMember?.imageUrl || null,
                team,
                row,
                teamDaysOff,
                sprintStart: input.sprintStart,
                sprintEnd: input.sprintEnd,
                totalSprintDays: input.totalSprintDays,
                source: 'visible',
            }));
        }
    }

    return candidates;
}

async function getHistoricalCandidate(input: {
    workApi: any;
    teams: AzureTeam[];
    sprint: any;
    member: any;
    identity: IdentityInfo | undefined;
    orgUrl: string;
    pat: string;
    sprintStart: Date;
    sprintEnd: Date;
    totalSprintDays: number;
}): Promise<CapacityCandidate | null> {
    for (const team of input.teams) {
        const teamContext = {
            project: input.sprint.project.name,
            projectId: input.sprint.project.azureId,
            team: team.name,
            teamId: team.id,
        };

        const base = input.orgUrl.replace(/\/$/, '');
        const url = `${base}/${encodePathPart(input.sprint.project.name)}/${encodePathPart(String(team.name || ''))}` +
            `/_apis/work/teamsettings/iterations/${input.sprint.azureId}/capacities/${input.member.azureId}?api-version=7.1`;
        const response = await fetchJson(url, input.pat);
        const row = response.status >= 200 && response.status < 300
            ? response.data as AzureCapacityRow
            : null;

        if (!row?.activities?.length) continue;

        const capacityPerDay = getCapacityPerDay(row.activities);
        if (capacityPerDay <= 0 && !(row.daysOff || []).length) continue;

        const teamDaysOff = await getTeamDaysOff(input.workApi, teamContext, input.sprint.azureId);
        return buildCandidate({
            azureId: input.member.azureId,
            displayName: input.identity?.displayName || input.member.displayName || input.member.uniqueName || input.member.azureId,
            uniqueName: input.identity?.uniqueName || input.member.uniqueName || input.member.displayName || input.member.azureId,
            imageUrl: input.member.imageUrl || null,
            team,
            row,
            teamDaysOff,
            sprintStart: input.sprintStart,
            sprintEnd: input.sprintEnd,
            totalSprintDays: input.totalSprintDays,
            source: 'historical',
        });
    }

    return null;
}

function selectFinalCandidates(input: {
    visible: Map<string, CapacityCandidate>;
    historical: Map<string, CapacityCandidate>;
    aggregateExpectedHours: number | null;
}): Map<string, CapacityCandidate> {
    const finalCandidates = new Map<string, CapacityCandidate>();
    for (const [azureId, candidate] of input.visible) finalCandidates.set(azureId, candidate);
    for (const [azureId, candidate] of input.historical) {
        if (!finalCandidates.has(azureId)) finalCandidates.set(azureId, candidate);
    }

    if (input.aggregateExpectedHours === null) return finalCandidates;

    let total = roundHours(Array.from(finalCandidates.values()).reduce((sum, item) => sum + item.availableHours, 0));
    const expected = roundHours(input.aggregateExpectedHours);
    if (total <= expected) return finalCandidates;

    const removableHidden = Array.from(finalCandidates.values())
        .filter((candidate) => candidate.source === 'historical' && !input.visible.has(candidate.azureId))
        .sort((a, b) => {
            if (b.availableHours !== a.availableHours) return b.availableHours - a.availableHours;
            return a.displayName.localeCompare(b.displayName);
        });

    for (const candidate of removableHidden) {
        if (total <= expected) break;
        const withoutCandidate = roundHours(total - candidate.availableHours);
        if (Math.abs(withoutCandidate - expected) <= Math.abs(total - expected)) {
            finalCandidates.delete(candidate.azureId);
            total = withoutCandidate;
        }
    }

    return finalCandidates;
}

function hasCapacityChanged(existing: any | undefined, candidate: CapacityCandidate): boolean {
    if (!existing) return true;
    if (roundHours(existing.totalHours) !== roundHours(candidate.totalHours)) return true;
    if (roundHours(existing.availableHours) !== roundHours(candidate.availableHours)) return true;
    if (JSON.stringify(normalizeActivities(existing.activitiesPerDay)) !== JSON.stringify(normalizeActivities(candidate.activities))) return true;
    if (JSON.stringify(normalizeDaysOff(existing.daysOff)) !== JSON.stringify(normalizeDaysOff(candidate.daysOff))) return true;
    return false;
}

function normalizeActivities(value: unknown): Array<{ name: string; capacityPerDay: number }> {
    if (!Array.isArray(value)) return [];
    return value
        .map((activity: any) => ({
            name: String(activity?.name || ''),
            capacityPerDay: Number(activity?.capacityPerDay || 0),
        }))
        .sort((a, b) => {
            const nameCompare = a.name.localeCompare(b.name);
            if (nameCompare !== 0) return nameCompare;
            return a.capacityPerDay - b.capacityPerDay;
        });
}

function normalizeDaysOff(value: unknown): Array<{ start: string; end: string }> {
    if (!Array.isArray(value)) return [];
    return value
        .map((range: any) => ({
            start: range?.start ? new Date(range.start).toISOString() : '',
            end: range?.end ? new Date(range.end).toISOString() : '',
        }))
        .filter((range) => range.start && range.end)
        .sort((a, b) => {
            const startCompare = a.start.localeCompare(b.start);
            if (startCompare !== 0) return startCompare;
            return a.end.localeCompare(b.end);
        });
}

export async function reconcileHistoricalSprintCapacity(
    options: HistoricalCapacityReconcileOptions
): Promise<HistoricalCapacityReconcileResult> {
    const sprint = options.sprint;
    const existingCapacities = await options.prisma.teamCapacity.findMany({
        where: { sprintId: sprint.id },
        include: { member: true },
    });
    const existingByAzureId = new Map(existingCapacities.map((cap) => [cap.member.azureId, cap]));
    const localAvailableHours = roundHours(existingCapacities.reduce((sum, cap) => sum + Number(cap.availableHours || 0), 0));

    const teams = await options.coreApi.getTeams(sprint.project.azureId) as AzureTeam[];
    if (!teams?.length) {
        return {
            sprintId: sprint.id,
            sprintName: sprint.name,
            projectName: sprint.project.name,
            changed: false,
            skipped: true,
            reason: 'no_teams',
            localRows: existingCapacities.length,
            finalRows: existingCapacities.length,
            localAvailableHours,
            finalAvailableHours: localAvailableHours,
            aggregateCapacityPerDay: null,
            aggregateExpectedHours: null,
            visibleRows: 0,
            recoveredHiddenRows: 0,
            addedRows: 0,
            updatedRows: 0,
            removedRows: 0,
        };
    }

    const sprintStart = new Date(sprint.startDate);
    const sprintEnd = new Date(sprint.endDate);
    const totalSprintDays = getBusinessDaysCount(sprintStart, sprintEnd);
    const aggregateCapacityPerDay = await getIterationCapacityPerDay({
        orgUrl: options.orgUrl,
        pat: options.pat,
        projectName: sprint.project.name,
        iterationId: sprint.azureId,
    });
    const aggregateExpectedHours = aggregateCapacityPerDay === null
        ? null
        : roundHours(aggregateCapacityPerDay * totalSprintDays);

    const visible = await getVisibleCandidates({
        workApi: options.workApi,
        teams,
        sprint,
        sprintStart,
        sprintEnd,
        totalSprintDays,
    });

    const historicalIds = existingCapacities
        .map((cap) => cap.member.azureId)
        .filter((azureId) => !visible.has(azureId));
    const identities = await getIdentityMap({
        orgUrl: options.orgUrl,
        pat: options.pat,
        azureIds: historicalIds,
    });

    const historical = new Map<string, CapacityCandidate>();
    for (const cap of existingCapacities) {
        if (visible.has(cap.member.azureId)) continue;
        const candidate = await getHistoricalCandidate({
            workApi: options.workApi,
            teams,
            sprint,
            member: cap.member,
            identity: identities.get(cap.member.azureId),
            orgUrl: options.orgUrl,
            pat: options.pat,
            sprintStart,
            sprintEnd,
            totalSprintDays,
        });
        if (candidate) historical.set(candidate.azureId, candidate);
    }

    const finalCandidates = selectFinalCandidates({ visible, historical, aggregateExpectedHours });
    const finalAvailableHours = roundHours(Array.from(finalCandidates.values()).reduce((sum, item) => sum + item.availableHours, 0));
    const removedRows = existingCapacities.filter((cap) => !finalCandidates.has(cap.member.azureId)).length;
    let addedRows = 0;
    let updatedRows = 0;

    for (const candidate of finalCandidates.values()) {
        const existing = existingByAzureId.get(candidate.azureId);
        if (!existing) addedRows++;
        else if (hasCapacityChanged(existing, candidate)) updatedRows++;
    }

    const changed = addedRows > 0 || updatedRows > 0 || removedRows > 0
        || roundHours(localAvailableHours) !== finalAvailableHours;

    if (!options.dryRun && changed) {
        for (const cap of existingCapacities) {
            if (!finalCandidates.has(cap.member.azureId)) {
                await options.prisma.teamCapacity.delete({ where: { id: cap.id } });
            }
        }

        for (const candidate of finalCandidates.values()) {
            const member = await options.prisma.teamMember.upsert({
                where: {
                    azureId_projectId: {
                        azureId: candidate.azureId,
                        projectId: sprint.projectId,
                    },
                },
                create: {
                    azureId: candidate.azureId,
                    displayName: candidate.displayName,
                    uniqueName: candidate.uniqueName,
                    imageUrl: candidate.imageUrl,
                    projectId: sprint.projectId,
                },
                update: {
                    displayName: candidate.displayName,
                    uniqueName: candidate.uniqueName,
                    imageUrl: candidate.imageUrl,
                },
            });

            await options.prisma.teamCapacity.upsert({
                where: {
                    memberId_sprintId: {
                        memberId: member.id,
                        sprintId: sprint.id,
                    },
                },
                create: {
                    memberId: member.id,
                    sprintId: sprint.id,
                    totalHours: roundHours(candidate.totalHours),
                    availableHours: roundHours(candidate.availableHours),
                    allocatedHours: 0,
                    completedHours: 0,
                    daysOff: candidate.daysOff,
                    activitiesPerDay: candidate.activities,
                },
                update: {
                    totalHours: roundHours(candidate.totalHours),
                    availableHours: roundHours(candidate.availableHours),
                    daysOff: candidate.daysOff,
                    activitiesPerDay: candidate.activities,
                },
            });
        }

        await capacityService.recalculateSprintCapacitySnapshot(sprint.id, options.prisma);
    }

    return {
        sprintId: sprint.id,
        sprintName: sprint.name,
        projectName: sprint.project.name,
        changed,
        skipped: false,
        localRows: existingCapacities.length,
        finalRows: finalCandidates.size,
        localAvailableHours,
        finalAvailableHours,
        aggregateCapacityPerDay,
        aggregateExpectedHours,
        visibleRows: visible.size,
        recoveredHiddenRows: historical.size,
        addedRows,
        updatedRows,
        removedRows,
    };
}

export async function reconcileHistoricalCapacities(input: {
    prisma: PrismaClient;
    coreApi: any;
    workApi: any;
    orgUrl: string;
    pat: string;
    dryRun?: boolean;
    projectNameContains?: string[];
    sprintNameContains?: string;
    limit?: number;
}): Promise<HistoricalCapacityReconcileResult[]> {
    const projectFilters = input.projectNameContains || [];
    const sprints = await input.prisma.sprint.findMany({
        where: {
            timeFrame: 'past',
            ...(input.sprintNameContains ? { name: { contains: input.sprintNameContains, mode: 'insensitive' } } : {}),
        },
        include: { project: true },
        orderBy: [{ project: { name: 'asc' } }, { startDate: 'asc' }],
        ...(input.limit ? { take: input.limit } : {}),
    });

    const targetSprints = projectFilters.length
        ? sprints.filter((sprint) => projectFilters.some((filter) =>
            sprint.project.name.toLowerCase().includes(filter.toLowerCase())
        ))
        : sprints;

    const results: HistoricalCapacityReconcileResult[] = [];
    for (const sprint of targetSprints) {
        results.push(await reconcileHistoricalSprintCapacity({
            prisma: input.prisma,
            coreApi: input.coreApi,
            workApi: input.workApi,
            orgUrl: input.orgUrl,
            pat: input.pat,
            sprint,
            dryRun: input.dryRun,
        }));
    }

    return results;
}
