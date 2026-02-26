import { PrismaClient } from '@prisma/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';

const prisma = new PrismaClient();

const TARGET_PROJECTS = ['GIGA - Retrabalho', 'GIGA - Tempos e Movimentos'];
const BATCH_SIZE = Math.max(1, Number(process.env.REVISION_BACKFILL_BATCH_SIZE || 10));
const SPRINT_IDS = String(process.env.SPRINT_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

function normalizeRevisionChanges(fields: unknown): Record<string, unknown> {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
    return fields as Record<string, unknown>;
}

function extractAvNavNumber(name: string): number | null {
    const match = String(name || '').match(/AV-NAV\s+SP\s*0*(\d{1,2})/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
}

async function persistRevisions(workItemId: number, revisions: any[]): Promise<number> {
    if (!Array.isArray(revisions) || revisions.length === 0) return 0;

    let persisted = 0;
    for (const rev of revisions) {
        if (typeof rev?.rev !== 'number') continue;
        const fields = normalizeRevisionChanges(rev.fields);
        const changedFields = Object.keys(fields);
        const revisedDateRaw = (fields['System.ChangedDate'] || fields['System.RevisedDate']) as string | undefined;
        const revisedDate = revisedDateRaw ? new Date(revisedDateRaw) : new Date();
        const revisedByObj = fields['System.ChangedBy'] as { displayName?: string; uniqueName?: string } | undefined;
        const revisedBy = revisedByObj?.displayName || revisedByObj?.uniqueName || rev.revisedBy?.displayName || 'Unknown';

        await prisma.workItemRevision.upsert({
            where: {
                workItemId_rev: {
                    workItemId,
                    rev: rev.rev,
                },
            },
            create: {
                workItemId,
                rev: rev.rev,
                revisedDate,
                revisedBy,
                changes: fields as any,
                changedFields,
            },
            update: {
                revisedDate,
                revisedBy,
                changes: fields as any,
                changedFields,
            },
        });
        persisted++;
    }

    return persisted;
}

async function resolveSprintIds(): Promise<string[]> {
    if (SPRINT_IDS.length > 0) return SPRINT_IDS;

    const projects = await prisma.project.findMany({
        where: { name: { in: TARGET_PROJECTS } },
        select: {
            name: true,
            sprints: {
                where: { state: { in: ['Past', 'past', 'Active', 'active'] } },
                orderBy: { startDate: 'asc' },
                select: { id: true, name: true },
            },
        },
    });

    const retrabalho = projects.find((project) => project.name === 'GIGA - Retrabalho');
    const tempos = projects.find((project) => project.name === 'GIGA - Tempos e Movimentos');

    const retrabalhoSprints = (retrabalho?.sprints || []).filter((sprint) => /^Sprint\s+[1-9]\d*$/i.test(sprint.name));
    const temposSprints = (tempos?.sprints || []).filter((sprint) => {
        const n = extractAvNavNumber(sprint.name);
        return n !== null && n >= 1 && n <= 11;
    });

    return [...retrabalhoSprints, ...temposSprints].map((sprint) => sprint.id);
}

async function main() {
    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (!orgUrl || !pat) {
        throw new Error('Missing AZURE_DEVOPS_ORG_URL or AZURE_DEVOPS_PAT');
    }

    const sprintIds = await resolveSprintIds();
    if (sprintIds.length === 0) {
        console.log('[REV BACKFILL SELECTED] No sprint ids selected.');
        return;
    }

    const workItems = await prisma.workItem.findMany({
        where: {
            sprintId: { in: sprintIds },
        },
        select: {
            id: true,
            sprint: { select: { name: true } },
            project: { select: { name: true } },
        },
        orderBy: [{ project: { name: 'asc' } }, { sprint: { name: 'asc' } }, { id: 'asc' }],
    });

    console.log('[REV BACKFILL SELECTED] Sprint IDs:', sprintIds.length);
    console.log('[REV BACKFILL SELECTED] Work items selected:', workItems.length);
    console.log('[REV BACKFILL SELECTED] Batch size:', BATCH_SIZE);

    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const witApi = await connection.getWorkItemTrackingApi();

    let processedItems = 0;
    let persistedRevisions = 0;
    let errors = 0;

    for (let i = 0; i < workItems.length; i += BATCH_SIZE) {
        const batch = workItems.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(workItems.length / BATCH_SIZE);
        console.log(`[REV BACKFILL SELECTED] Batch ${batchNumber}/${totalBatches} (${batch.length} items)`);

        for (const wi of batch) {
            try {
                const revisions = await witApi.getRevisions(wi.id);
                persistedRevisions += await persistRevisions(wi.id, revisions as any[]);
                processedItems++;
            } catch (error) {
                errors++;
                console.log(
                    `[REV BACKFILL SELECTED] WARN item ${wi.id} (${wi.project?.name || '-'} / ${wi.sprint?.name || '-'}) : ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    console.log('[REV BACKFILL SELECTED] Done', {
        processedItems,
        persistedRevisions,
        errors,
    });
}

main()
    .catch((error) => {
        console.error('[REV BACKFILL SELECTED] Failed:', error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
