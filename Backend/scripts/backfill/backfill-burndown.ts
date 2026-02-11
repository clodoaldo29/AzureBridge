import { prisma } from '../../src/database/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';

function toUTCDateOnly(d: Date): Date {
    const dt = new Date(d);
    dt.setUTCHours(0, 0, 0, 0);
    return dt;
}

function toUTCDateOnlyFromDate(d: Date): Date {
    const [y, m, day] = d.toISOString().split('T')[0].split('-').map(Number);
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

async function main() {
    const backfillMode = (process.env.BACKFILL_MODE || 'rebuild').toLowerCase();
    const targetProjectsEnv = (process.env.TARGET_PROJECTS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

    console.log('BACKFILL BURNDOWN');
    console.log('='.repeat(60));
    console.log(`Mode: ${backfillMode}`);
    if (targetProjectsEnv.length > 0) {
        console.log(`Targets: ${targetProjectsEnv.join(', ')}`);
    }
    console.log('');

    const sprints = await prisma.sprint.findMany({
        include: { project: true }
    });

    if (sprints.length === 0) {
        console.log('NO_SPRINTS_FOUND');
        await prisma.$disconnect();
        return;
    }

    const useAzureDaysOff = process.env.USE_AZURE_DAYS_OFF === 'true';
    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    const authHandler = useAzureDaysOff && orgUrl && pat ? azdev.getPersonalAccessTokenHandler(pat) : null;
    const connection = useAzureDaysOff && orgUrl && pat ? new azdev.WebApi(orgUrl, authHandler!) : null;
    const workApi = connection ? await connection.getWorkApi() : null;
    const coreApi = connection ? await connection.getCoreApi() : null;

    const filtered = targetProjectsEnv.length
        ? sprints.filter(s => s.project && targetProjectsEnv.includes(s.project.name))
        : sprints;

    console.log(`Found ${filtered.length} sprints to process\n`);

    for (const sprint of filtered) {
        if (!sprint || !sprint.startDate || !sprint.endDate) continue;

        console.log(`Sprint: ${sprint.name} (${sprint.project?.name || 'unknown'})`);

        if (backfillMode === 'new') {
            const existingCount = await prisma.sprintSnapshot.count({ where: { sprintId: sprint.id } });
            if (existingCount > 0) {
                console.log(`  Skipping (already has snapshots: ${existingCount})`);
                continue;
            }
        } else {
            await prisma.sprintSnapshot.deleteMany({ where: { sprintId: sprint.id } });
            console.log('  Existing snapshots removed');
        }

        const excludeDates = new Set<number>();
        if (useAzureDaysOff && workApi && coreApi && sprint.project?.azureId) {
            const teams = await coreApi.getTeams(sprint.project.azureId);
            if (teams.length > 0) {
                const team = teams.find(t => t.name === `${sprint.project.name} Team`) || teams[0];
                const teamContext = {
                    project: sprint.project.name,
                    projectId: sprint.project.azureId,
                    team: team.name,
                    teamId: team.id
                };
                try {
                    const daysOff = await workApi.getTeamDaysOff(teamContext, sprint.azureId);
                    if (daysOff && daysOff.daysOff) {
                        for (const d of daysOff.daysOff) {
                            const start = toUTCDateOnlyFromDate(new Date(d.start));
                            const end = toUTCDateOnlyFromDate(new Date(d.end));
                            for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                                const day = dt.getUTCDay();
                                if (day !== 0 && day !== 6) {
                                    excludeDates.add(dt.getTime());
                                }
                            }
                        }
                    }
                } catch {
                    // ignore days off fetch errors
                }
            }
        } else {
            const capacities = await prisma.teamCapacity.findMany({
                where: { sprintId: sprint.id },
                select: { daysOff: true }
            });
            console.log(`  Capacity records: ${capacities.length}`);
            for (const cap of capacities) {
                const ranges = (cap.daysOff as any[]) || [];
                for (const d of ranges) {
                    if (!d?.start || !d?.end) continue;
                    const start = toUTCDateOnlyFromDate(new Date(d.start));
                    const end = toUTCDateOnlyFromDate(new Date(d.end));
                    for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                        const day = dt.getUTCDay();
                        if (day !== 0 && day !== 6) {
                            excludeDates.add(dt.getTime());
                        }
                    }
                }
            }
        }

        const workItems = await prisma.workItem.findMany({
            where: { sprintId: sprint.id, isRemoved: false },
            select: {
                remainingWork: true,
                completedWork: true,
                // @ts-ignore - Field exists in DB but client might not be generated yet
                initialRemainingWork: true,
                // @ts-ignore - Field exists in DB but client might not be generated yet
                lastRemainingWork: true,
                // @ts-ignore - Field exists in DB but client might not be generated yet
                doneRemainingWork: true,
                state: true
            }
        });

        let currentRemaining = 0;
        let currentCompleted = 0;
        let plannedInitial = 0;
        let plannedCurrent = 0;

        for (const item of workItems as any[]) {
            const remaining = item.remainingWork || 0;
            const completed = item.completedWork || 0;
            currentRemaining += remaining;
            currentCompleted += completed;

            const initialFromHistory = item.initialRemainingWork || 0;
            const lastFromHistory = item.lastRemainingWork || 0;
            const doneFromHistory = item.doneRemainingWork || 0;
            const state = (item.state || '').toLowerCase();
            const isDone = state === 'done' || state === 'closed' || state === 'completed';

            const planned = initialFromHistory > 0
                ? initialFromHistory
                : (lastFromHistory > 0 ? lastFromHistory : (remaining + completed));

            const plannedFinal = isDone
                ? (doneFromHistory > 0
                    ? doneFromHistory
                    : (lastFromHistory > 0 ? lastFromHistory : (remaining + completed)))
                : (lastFromHistory > 0 ? lastFromHistory : remaining);

            plannedInitial += planned;
            plannedCurrent += plannedFinal;
        }

        const totalWorkInitial = plannedInitial || (currentRemaining + currentCompleted);
        const totalWorkFinal = plannedCurrent > 0 ? plannedCurrent : totalWorkInitial;
        const totalDelta = Math.max(0, totalWorkFinal - totalWorkInitial);

        const sprintStart = toUTCDateOnlyFromDate(new Date(sprint.startDate));
        const sprintEnd = toUTCDateOnlyFromDate(new Date(sprint.endDate));

        const businessDays = getBusinessDays(sprintStart, sprintEnd, excludeDates);
        if (businessDays.length === 0) {
            console.log('  No business days available after excluding weekends/day off');
            continue;
        }
        const totalBusinessDays = businessDays.length;
        const businessIndexByTime = new Map<number, number>();
        businessDays.forEach((d, idx) => {
            businessIndexByTime.set(d.getTime(), idx);
        });

        const first = businessDays[0];
        const last = businessDays[businessDays.length - 1];
        const todayKey = toUTCDateOnlyFromDate(new Date()).getTime();

        const snapshotRows: any[] = [];
        console.log(`  Business days: ${totalBusinessDays}`);
        console.log(`  Total work (initial): ${totalWorkInitial}h | Total work (final): ${totalWorkFinal}h | Remaining now: ${currentRemaining}h | Completed now: ${currentCompleted}h`);

        const scopeDayEnv = parseInt(process.env.SCOPE_DAY_INDEX || '', 10);
        const scopeIdx = Number.isFinite(scopeDayEnv)
            ? Math.max(0, Math.min(totalBusinessDays - 1, scopeDayEnv))
            : (totalDelta > 0 ? Math.min(2, totalBusinessDays - 1) : totalBusinessDays);

        const totalSegments = Math.max(1, totalBusinessDays - 1);
        const burnInitial = totalWorkInitial / totalSegments;
        const afterScopeBaseline = scopeIdx < totalBusinessDays ? totalWorkFinal : totalWorkInitial;
        const remainingSegments = Math.max(1, totalSegments - Math.min(scopeIdx, totalSegments));
        const burnAfterScope = afterScopeBaseline / remainingSegments;

        for (let i = 0; i < businessDays.length; i++) {
            const day = businessDays[i];
            const dayKey = day.getTime();

            const idx = businessIndexByTime.get(dayKey) || 0;
            const progress = totalBusinessDays === 1 ? 1 : idx / (totalBusinessDays - 1);
            const idealRemaining = i < scopeIdx
                ? Math.max(0, Math.round(totalWorkInitial - burnInitial * i))
                : Math.max(0, Math.round(afterScopeBaseline - burnAfterScope * (i - scopeIdx)));

            const totalWork = i < scopeIdx ? totalWorkInitial : totalWorkFinal;
            const realRemaining = dayKey === first.getTime()
                ? totalWork
                : (dayKey === todayKey ? currentRemaining : idealRemaining);

            const realCompleted = Math.max(0, totalWork - realRemaining);

            snapshotRows.push({
                sprintId: sprint.id,
                snapshotDate: day,
                remainingWork: realRemaining,
                completedWork: realCompleted,
                totalWork,
                remainingPoints: 0,
                completedPoints: 0,
                totalPoints: 0,
                todoCount: 0,
                inProgressCount: 0,
                doneCount: 0,
                blockedCount: 0,
                idealRemaining
            });

            if ((i + 1) % 5 === 0 || i + 1 === businessDays.length) {
                console.log(`  Snapshot progress: ${i + 1}/${businessDays.length}`);
            }
        }

        if (snapshotRows.length > 0) {
            await prisma.sprintSnapshot.createMany({ data: snapshotRows });
        }

        const count = await prisma.sprintSnapshot.count({ where: { sprintId: sprint.id } });
        console.log(`  Backfilled: ${first.toISOString().split('T')[0]} -> ${last.toISOString().split('T')[0]} | snapshots: ${count}\n`);
    }

    console.log('='.repeat(60));
    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});
