import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const prisma = new PrismaClient();
const DEFAULT_TARGETS = ['GIGA - Retrabalho', 'GIGA - Tempos e Movimentos'];

function getTargets(): string[] {
    const envTargets = String(process.env.TARGET_PROJECTS || '').trim();
    if (!envTargets) return DEFAULT_TARGETS;
    return envTargets.split(',').map((value) => value.trim()).filter(Boolean);
}

function toUtcDay(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
}

function toEndOfUtcDay(value: Date): Date {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999));
}

function toIsoDay(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function getChangePair(changes: Record<string, unknown>, field: string): { oldValue: number | null; newValue: number | null } | null {
    const raw = changes[field] as { oldValue?: unknown; newValue?: unknown } | undefined;
    if (!raw) return null;
    return {
        oldValue: toNumber(raw.oldValue),
        newValue: toNumber(raw.newValue),
    };
}

function estimateRevisionDelta(changesRaw: unknown): number {
    const changes = (changesRaw && typeof changesRaw === 'object' && !Array.isArray(changesRaw))
        ? (changesRaw as Record<string, unknown>)
        : {};

    const rem = getChangePair(changes, 'Microsoft.VSTS.Scheduling.RemainingWork');
    const comp = getChangePair(changes, 'Microsoft.VSTS.Scheduling.CompletedWork');

    if (rem && comp) {
        const oldTotal = (rem.oldValue ?? 0) + (comp.oldValue ?? 0);
        const newTotal = (rem.newValue ?? 0) + (comp.newValue ?? 0);
        return newTotal - oldTotal;
    }

    if (rem) return (rem.newValue ?? 0) - (rem.oldValue ?? 0);
    if (comp) return (comp.newValue ?? 0) - (comp.oldValue ?? 0);
    return 0;
}

function csvEscape(value: unknown): string {
    const str = value == null ? '' : String(value);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

async function main() {
    const targets = getTargets();
    const fromEnv = process.env.RECONCILE_FROM ? new Date(process.env.RECONCILE_FROM) : null;
    const toEnv = process.env.RECONCILE_TO ? new Date(process.env.RECONCILE_TO) : null;

    const fromDate = fromEnv && !Number.isNaN(fromEnv.getTime()) ? toUtcDay(fromEnv) : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const toDate = toEnv && !Number.isNaN(toEnv.getTime()) ? toEndOfUtcDay(toEnv) : toEndOfUtcDay(new Date());

    const sprints = await prisma.sprint.findMany({
        where: {
            project: { name: { in: targets } },
            startDate: { lte: toDate },
            endDate: { gte: fromDate },
        },
        select: {
            id: true,
            name: true,
            project: { select: { name: true } },
        },
        orderBy: [{ projectId: 'asc' }, { startDate: 'asc' }],
    });

    const rows: Array<Record<string, unknown>> = [];

    for (const sprint of sprints) {
        const snapshots = await prisma.sprintSnapshot.findMany({
            where: {
                sprintId: sprint.id,
                snapshotDate: { gte: fromDate, lte: toDate },
            },
            select: {
                snapshotDate: true,
                totalWork: true,
                addedCount: true,
                removedCount: true,
            },
            orderBy: { snapshotDate: 'asc' },
        });

        for (let i = 1; i < snapshots.length; i++) {
            const previous = snapshots[i - 1];
            const current = snapshots[i];

            const windowStart = toEndOfUtcDay(previous.snapshotDate);
            const windowEnd = toEndOfUtcDay(current.snapshotDate);

            const revisions = await prisma.workItemRevision.findMany({
                where: {
                    revisedDate: { gt: windowStart, lte: windowEnd },
                    workItem: { sprintId: sprint.id },
                    OR: [
                        { changedFields: { has: 'Microsoft.VSTS.Scheduling.RemainingWork' } },
                        { changedFields: { has: 'Microsoft.VSTS.Scheduling.CompletedWork' } },
                        { changedFields: { has: 'Microsoft.VSTS.Scheduling.OriginalEstimate' } },
                        { changedFields: { has: 'System.IterationPath' } },
                    ],
                },
                select: {
                    workItemId: true,
                    revisedDate: true,
                    changedFields: true,
                    changes: true,
                    workItem: { select: { title: true } },
                },
                orderBy: { revisedDate: 'asc' },
            });

            const revisionDelta = revisions.reduce((acc, rev) => acc + estimateRevisionDelta(rev.changes), 0);
            const snapshotDelta = Number(current.totalWork || 0) - Number(previous.totalWork || 0);
            const snapshotAdded = Number(current.addedCount || 0);
            const snapshotRemoved = Number(current.removedCount || 0);
            const gap = snapshotDelta - revisionDelta;

            rows.push({
                project: sprint.project.name,
                sprint: sprint.name,
                day: toIsoDay(current.snapshotDate),
                prevDayTotal: Number(previous.totalWork || 0),
                currDayTotal: Number(current.totalWork || 0),
                snapshotDelta,
                snapshotAdded,
                snapshotRemoved,
                revisionDelta,
                revisionsCount: revisions.length,
                reconciliationGap: gap,
            });
        }
    }

    const report = {
        generatedAt: new Date().toISOString(),
        targets,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        rows,
        summary: {
            rows: rows.length,
            rowsWithGap: rows.filter((row) => Number(row.reconciliationGap || 0) !== 0).length,
        },
    };

    const outputDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const jsonPath = path.join(outputDir, 'scope-delta-reconciliation.json');
    const csvPath = path.join(outputDir, 'scope-delta-reconciliation.csv');

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

    const headers = [
        'project',
        'sprint',
        'day',
        'prevDayTotal',
        'currDayTotal',
        'snapshotDelta',
        'snapshotAdded',
        'snapshotRemoved',
        'revisionDelta',
        'revisionsCount',
        'reconciliationGap',
    ];

    const csvLines = [headers.join(',')];
    for (const row of rows) {
        csvLines.push(headers.map((header) => csvEscape(row[header])).join(','));
    }
    fs.writeFileSync(csvPath, csvLines.join('\n'), 'utf8');

    console.log('[RECONCILE] done', {
        jsonPath,
        csvPath,
        rows: report.summary.rows,
        rowsWithGap: report.summary.rowsWithGap,
    });
}

main()
    .catch((error) => {
        console.error('[RECONCILE] failed', error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
