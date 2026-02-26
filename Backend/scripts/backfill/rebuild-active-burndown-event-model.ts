import { prisma } from '../../src/database/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';

type RevisionLike = {
    fields?: Record<string, any>;
};

type ItemLike = {
    id: number;
    azureId: number;
    type: string;
    state: string;
    isBlocked: boolean;
    isRemoved: boolean;
    createdDate: Date;
    changedDate: Date;
    activatedDate: Date | null;
    closedDate: Date | null;
    iterationPath?: string | null;
    remainingWork: number | null;
    completedWork: number | null;
    initialRemainingWork: number | null;
    lastRemainingWork: number | null;
    doneRemainingWork: number | null;
    originalEstimate: number | null;
};

const ALLOWED_TYPES = new Set(['task', 'bug', 'test case']);
const DONE_LIKE_STATES = new Set(['done', 'closed', 'completed']);
const COUNTABLE_CHART_TYPES = new Set(['task', 'bug']);
const SPRINT_TIMEZONE = process.env.SPRINT_TIMEZONE || 'America/Sao_Paulo';

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
    // Map non-business events (weekend/holiday) to the previous business day.
    // Never push scope changes forward to a future day.
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

function isInSprintPath(iteration: string | null | undefined, sprintPath: string): boolean {
    const it = String(iteration || '').trim().toLowerCase();
    if (!it) return false;
    const sp = String(sprintPath || '').trim().toLowerCase();
    return it === sp || it.startsWith(`${sp}\\`);
}

function parseState(value: any): string | null {
    if (value === null || value === undefined) return null;
    return String(value).trim().toLowerCase();
}

function isDoneLike(state?: string | null): boolean {
    return DONE_LIKE_STATES.has(String(state || '').trim().toLowerCase());
}

async function main() {
    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (!orgUrl || !pat) {
        throw new Error('AZURE_DEVOPS_ORG_URL / AZURE_DEVOPS_PAT ausentes');
    }

    const configuredTargets = String(process.env.TARGET_PROJECTS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    const discoveredTargets = configuredTargets.length > 0
        ? configuredTargets
        : (await prisma.project.findMany({
            where: {
                sprints: {
                    some: {
                        state: { in: ['Active', 'active'] }
                    }
                }
            },
            select: { name: true },
            orderBy: { name: 'asc' }
        })).map((p) => p.name);
    const targetProjectsEnv = Array.from(new Set(discoveredTargets));
    if (!targetProjectsEnv.length) {
        console.log('Nenhum projeto com sprint ativa encontrado para rebuild de burndown.');
        await prisma.$disconnect();
        return;
    }
    const targetSet = new Set(targetProjectsEnv.map(p => p.toLowerCase()));
    const sprintStatesEnv = (process.env.REBUILD_SPRINT_STATES || 'Active,active')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const sprintIdsEnv = (process.env.SPRINT_IDS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    const sprintIdsSet = new Set(sprintIdsEnv);
    const sprintNameRegexRaw = String(process.env.SPRINT_NAME_REGEX || '').trim();
    const sprintNameRegex = sprintNameRegexRaw ? new RegExp(sprintNameRegexRaw, 'i') : null;

    console.log('REBUILD BURNDOWN (EVENT MODEL)');
    console.log('='.repeat(72));
    console.log(`Targets: ${targetProjectsEnv.join(', ')}`);
    console.log(`State filter: ${sprintStatesEnv.join(', ')}`);
    if (sprintIdsSet.size > 0) {
        console.log(`Sprint IDs filter enabled: ${sprintIdsSet.size} id(s)`);
    }
    if (sprintNameRegexRaw) {
        console.log(`Sprint name regex: ${sprintNameRegexRaw}`);
    }

    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const witApi = await connection.getWorkItemTrackingApi();

    const where: any = {
        project: { name: { in: targetProjectsEnv } },
    };
    if (sprintIdsSet.size > 0) {
        where.id = { in: Array.from(sprintIdsSet) };
    } else {
        where.state = { in: sprintStatesEnv };
    }

    const selectedSprints = await prisma.sprint.findMany({
        where,
        include: {
            project: true,
            capacities: { select: { daysOff: true } },
        },
        orderBy: [{ project: { name: 'asc' } }, { startDate: 'asc' }],
    });

    const sprints = selectedSprints.filter((sprint) => {
        if (!targetSet.has(sprint.project.name.toLowerCase())) return false;
        if (sprintIdsSet.size > 0 && !sprintIdsSet.has(sprint.id)) return false;
        if (sprintNameRegex && !sprintNameRegex.test(sprint.name)) return false;
        return true;
    });

    if (!sprints.length) {
        console.log('Nenhuma sprint encontrada para os filtros informados.');
        await prisma.$disconnect();
        return;
    }

    console.log(`Sprints alvo: ${sprints.length}\n`);

    for (const sprint of sprints) {
        if (!sprint.startDate || !sprint.endDate) continue;

        console.log(`Sprint: ${sprint.project.name} / ${sprint.name}`);

        await prisma.sprintSnapshot.deleteMany({ where: { sprintId: sprint.id } });
        console.log('  snapshots antigos removidos');

        // Sprint-level day off must represent team day off only.
        // Derive from intersection across members (each member has merged team+individual days off).
        const memberDaySets: Array<Set<number>> = sprint.capacities.map((cap) => {
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

        let excludeDates = new Set<number>();
        if (memberDaySets.length > 0) {
            excludeDates = new Set<number>(memberDaySets[0]);
            for (let i = 1; i < memberDaySets.length; i++) {
                excludeDates = new Set(
                    Array.from(excludeDates).filter((dayMs) => memberDaySets[i].has(dayMs))
                );
            }
        }

        // Sprint boundaries are stored as calendar dates; keep UTC date-only to avoid shifting D1/D10.
        const sprintStart = toUTCDateOnlyFromDate(new Date(sprint.startDate));
        const sprintEnd = toUTCDateOnlyFromDate(new Date(sprint.endDate));
        const today = toUTCDateOnlyFromDate(new Date());
        const effectiveEnd = sprintEnd.getTime() > today.getTime() ? today : sprintEnd;
        if (effectiveEnd.getTime() < sprintStart.getTime()) {
            console.log('  sprint ainda nao iniciou no recorte atual');
            continue;
        }
        const businessDays = getBusinessDays(sprintStart, effectiveEnd, excludeDates);
        if (!businessDays.length) {
            console.log('  sem dias uteis para processar');
            continue;
        }

        const firstDayMs = businessDays[0].getTime();

        const workItems = await prisma.workItem.findMany({
            // Include removed items to capture real scope reductions (items leaving sprint).
            where: { sprintId: sprint.id },
            select: {
                id: true,
                azureId: true,
                type: true,
                state: true,
                isBlocked: true,
                isRemoved: true,
                createdDate: true,
                changedDate: true,
                activatedDate: true,
                closedDate: true,
                iterationPath: true,
                remainingWork: true,
                completedWork: true,
                initialRemainingWork: true,
                lastRemainingWork: true,
                doneRemainingWork: true,
                originalEstimate: true,
            },
        }) as ItemLike[];

        const scopedItems = workItems.filter(w => ALLOWED_TYPES.has(String(w.type || '').toLowerCase()));

        // D0 baseline (logical, not shown in chart):
        // sum RemainingWork that was already set before D1 for items that were in this sprint before D1.
        let baselineInitial = 0;
        let baselineContributors = 0;

        const scopeDeltaByDay = new Array<number>(businessDays.length).fill(0);
        const scopeAddedByDay = new Array<number>(businessDays.length).fill(0);
        const scopeRemovedByDay = new Array<number>(businessDays.length).fill(0);
        const completedByDay = new Array<number>(businessDays.length).fill(0);

        for (const item of scopedItems) {
            const revisions = (await witApi.getRevisions(item.azureId)) as RevisionLike[];

            if (!revisions?.length) {
                continue;
            }

            const sorted = [...revisions].sort((a, b) => {
                const ad = parseChangedDate(a.fields?.['System.ChangedDate'])?.getTime() || 0;
                const bd = parseChangedDate(b.fields?.['System.ChangedDate'])?.getTime() || 0;
                return ad - bd;
            });

            // Build baseline state/remaining at D0 (before first business day).
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
                if (rem !== null) {
                    prevRemaining = rem;
                    hadRemainingBeforeD1 = true;
                }
                if (st) prevState = st;
                if (it) {
                    prevIteration = it;
                    hadIterationBeforeD1 = true;
                }
            }

            // Canonical rule:
            // if there is no explicit RemainingWork before D1, D0 baseline for this item is zero.
            // Hours first assigned on D1..Dn must be counted as scope added.
            if (prevRemaining === null) {
                prevRemaining = 0;
            }
            if (!prevState) prevState = parseState(item.state) || '';
            if (!prevIteration) prevIteration = parseIteration(item.iterationPath) || sprint.path.toLowerCase();

            const createdBeforeD1 = item.createdDate
                ? toUTCDateOnlyFromDate(new Date(item.createdDate)).getTime() < firstDayMs
                : false;
            // Baseline D0 only accepts items with explicit pre-D1 iteration evidence.
            // This avoids pulling items that were created before D1 but entered sprint after D1.
            const wasInSprintBeforeD1 = createdBeforeD1 && hadIterationBeforeD1 && isInSprintPath(prevIteration, sprint.path);
            if (wasInSprintBeforeD1 && hadRemainingBeforeD1 && (prevRemaining || 0) > 0) {
                baselineInitial += Number(prevRemaining || 0);
                baselineContributors++;
            }

            for (const rev of sorted) {
                const changed = parseChangedDate(rev.fields?.['System.ChangedDate']);
                if (!changed) continue;
                const dayMs = toBusinessDateOnlyFromDate(changed).getTime();
                if (dayMs < firstDayMs) continue;

                const idx = indexForDay(dayMs, businessDays);
                const currentState = parseState(rev.fields?.['System.State']) || prevState || '';
                const currentIteration = parseIteration(rev.fields?.['System.IterationPath']) || prevIteration || '';
                const remField = parseRemaining(rev.fields?.['Microsoft.VSTS.Scheduling.RemainingWork']);
                let currentRemaining = remField !== null ? remField : (prevRemaining || 0);
                // Azure often omits RemainingWork on done-like transitions.
                // In done-like states, missing RemainingWork must be treated as zero.
                if (remField === null && isDoneLike(currentState)) {
                    currentRemaining = 0;
                }

                const previousRemaining = prevRemaining || 0;
                const prevInSprint = isInSprintPath(prevIteration, sprint.path);
                const currentInSprint = isInSprintPath(currentIteration, sprint.path);
                const crossedIntoSprint = !prevInSprint && currentInSprint;
                const crossedOutOfSprint = prevInSprint && !currentInSprint;

                if (crossedIntoSprint) {
                    // If item was created before D1 but iteration history before D1 is missing,
                    // treat it as already inside sprint at baseline (avoid false scope add).
                    if (createdBeforeD1 && !hadIterationBeforeD1) {
                        prevRemaining = currentRemaining;
                        prevState = currentState;
                        prevIteration = currentIteration;
                        continue;
                    }
                    // Item entered the sprint on this revision.
                    // Add its total contribution and restore completed share.
                    const enteringTotal = Math.max(0, currentRemaining + itemCompleted);
                    if (enteringTotal > 0) {
                        scopeDeltaByDay[idx] += enteringTotal;
                        scopeAddedByDay[idx] += enteringTotal;
                    }
                    if (itemCompleted > 0) {
                        completedByDay[idx] += itemCompleted;
                    }
                } else if (crossedOutOfSprint) {
                    // Item left the sprint on this revision.
                    // Remove both remaining and completed shares from sprint totals.
                    const leavingTotal = Math.max(0, currentRemaining + itemCompleted);
                    if (leavingTotal > 0) {
                        scopeDeltaByDay[idx] -= leavingTotal;
                        scopeRemovedByDay[idx] += leavingTotal;
                    }
                    if (itemCompleted > 0) {
                        completedByDay[idx] -= itemCompleted;
                    }
                } else if (currentInSprint || prevInSprint) {
                    // Completion event rule (real):
                    // count concluded exactly when Remaining transitions from >0 to 0.
                    const completionEvent = previousRemaining > 0 && currentRemaining === 0;
                    if (completionEvent) {
                        completedByDay[idx] += previousRemaining;
                        itemCompleted += previousRemaining;
                    } else if (previousRemaining === 0 && currentRemaining > 0 && itemCompleted > 0) {
                        // Reopen: hours return to remaining and must be debited from completed.
                        const debit = Math.min(itemCompleted, currentRemaining);
                        if (debit > 0) {
                            completedByDay[idx] -= debit;
                            itemCompleted -= debit;
                        }
                    }

                    // Scope delta rule (real):
                    // use only explicit Remaining changes from revisions;
                    // increases and decreases both count, EXCEPT completion transitions
                    // (>0 -> 0) which belong to concluded work, not scope reduction.
                    if (remField !== null) {
                        const delta = currentRemaining - previousRemaining;
                        if (!(completionEvent && delta < 0)) {
                            scopeDeltaByDay[idx] += delta;
                            if (delta > 0) {
                                scopeAddedByDay[idx] += delta;
                            } else if (delta < 0) {
                                scopeRemovedByDay[idx] += Math.abs(delta);
                            }
                        }
                    }
                }

                prevRemaining = currentRemaining;
                prevState = currentState;
                prevIteration = currentIteration;
            }
        }

        // Safety fallback only when no historical D0 contribution was found.
        if (baselineInitial <= 0) {
            const sprintPlanned = Number(sprint.totalPlannedHours || 0);
            if (Number.isFinite(sprintPlanned) && sprintPlanned > 0) {
                baselineInitial = sprintPlanned;
            }
        }
        baselineInitial = Math.max(0, Math.round(baselineInitial));

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

        // No reconciliation/forcing:
        // series must come only from real historical events.

        // Piecewise ideal with net scope delta (+/-).
        const idealByDay = new Array<number>(businessDays.length).fill(0);
        let idealCursor = baselineInitial;
        if (businessDays.length > 0) {
            idealByDay[0] = Math.round(Math.max(0, idealCursor));
        }
        for (let i = 1; i < businessDays.length; i++) {
            idealCursor = Math.max(0, idealCursor + scopeDeltaByDay[i]);
            const stepsRemaining = businessDays.length - i;
            const burnStep = stepsRemaining > 0 ? idealCursor / stepsRemaining : idealCursor;
            idealCursor = Math.max(0, idealCursor - burnStep);
            idealByDay[i] = Math.round(idealCursor);
        }

        const rows = [];
        for (let i = 0; i < businessDays.length; i++) {
            const day = businessDays[i];
            const dayEnd = day.getTime() + 24 * 60 * 60 * 1000;

            let todoCount = 0;
            let inProgressCount = 0;
            let doneCount = 0;
            let blockedCount = 0;

            for (const item of scopedItems) {
                const itemType = String(item.type || '').trim().toLowerCase();
                if (!COUNTABLE_CHART_TYPES.has(itemType)) continue;
                const createdTs = item.createdDate ? toUTCDateOnly(new Date(item.createdDate)).getTime() : null;
                if (createdTs === null || createdTs >= dayEnd) continue;
                const closedTs = item.closedDate ? toUTCDateOnly(new Date(item.closedDate)).getTime() : null;
                const activatedTs = item.activatedDate ? toUTCDateOnly(new Date(item.activatedDate)).getTime() : null;
                const changedTs = item.changedDate ? toUTCDateOnly(new Date(item.changedDate)).getTime() : null;
                const currentState = parseState(item.state) || '';
                if (item.isBlocked) blockedCount++;
                const doneByDate = closedTs !== null
                    ? closedTs < dayEnd
                    : (isDoneLike(currentState) && changedTs !== null && changedTs < dayEnd);

                if (doneByDate) {
                    doneCount++;
                    continue;
                }

                const inProgressByDate = activatedTs !== null
                    ? activatedTs < dayEnd
                    : (currentState.includes('progress') && changedTs !== null && changedTs < dayEnd);

                if (inProgressByDate) inProgressCount++;
                else todoCount++;
            }

            const totalWork = totalWorkByDay[i];
            const remaining = realRemainingByDay[i];
            const completed = Math.max(0, totalWork - remaining);
            const scopeAdded = Math.max(0, Math.round(scopeAddedByDay[i]));
            const scopeRemoved = Math.max(0, Math.round(scopeRemovedByDay[i]));

            rows.push({
                sprintId: sprint.id,
                snapshotDate: day,
                remainingWork: remaining,
                completedWork: completed,
                totalWork,
                remainingPoints: 0,
                completedPoints: 0,
                totalPoints: 0,
                todoCount,
                inProgressCount,
                doneCount,
                blockedCount,
                addedCount: scopeAdded,
                removedCount: scopeRemoved,
                idealRemaining: idealByDay[i],
            });
        }

        if (rows.length) {
            await prisma.sprintSnapshot.createMany({ data: rows });
        }

        const latest = rows[rows.length - 1];
        console.log(
            `  snapshots=${rows.length} | baseline(D0)=${baselineInitial}h | baseItems=${baselineContributors} | remAtual=${latest?.remainingWork ?? 0}h | total=${latest?.totalWork ?? 0}h`
        );
        console.log('');
    }

    console.log('Concluído.');
    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});
