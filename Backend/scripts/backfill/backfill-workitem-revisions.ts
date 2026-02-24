import { PrismaClient } from '@prisma/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';

const prisma = new PrismaClient();

const DEFAULT_TARGETS = ['GIGA - Retrabalho', 'GIGA - Tempos e Movimentos'];
const BATCH_SIZE = Math.max(1, Number(process.env.REVISION_BACKFILL_BATCH_SIZE || 25));
const DAYS_BACK = Math.max(1, Number(process.env.REVISION_BACKFILL_DAYS || 30));

function getTargets(): string[] {
    const envTargets = String(process.env.TARGET_PROJECTS || '').trim();
    if (!envTargets) return DEFAULT_TARGETS;
    return envTargets.split(',').map((value) => value.trim()).filter(Boolean);
}

function normalizeRevisionChanges(fields: unknown): Record<string, unknown> {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
    return fields as Record<string, unknown>;
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

async function main() {
    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (!orgUrl || !pat) {
        throw new Error('Missing AZURE_DEVOPS_ORG_URL or AZURE_DEVOPS_PAT');
    }

    const targets = getTargets();
    const changedSince = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000);

    const workItems = await prisma.workItem.findMany({
        where: {
            project: {
                name: { in: targets },
            },
            changedDate: { gte: changedSince },
        },
        select: {
            id: true,
            project: { select: { name: true } },
        },
        orderBy: { changedDate: 'desc' },
    });

    console.log('[REV BACKFILL] Targets:', targets.join(', '));
    console.log('[REV BACKFILL] Work items selected:', workItems.length);
    console.log('[REV BACKFILL] Changed since:', changedSince.toISOString());

    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const witApi = await connection.getWorkItemTrackingApi();

    let processedItems = 0;
    let persistedRevisions = 0;
    let errors = 0;

    for (let i = 0; i < workItems.length; i += BATCH_SIZE) {
        const batch = workItems.slice(i, i + BATCH_SIZE);
        console.log(`[REV BACKFILL] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(workItems.length / BATCH_SIZE)} (${batch.length} items)`);

        for (const wi of batch) {
            try {
                const revisions = await witApi.getRevisions(wi.id);
                persistedRevisions += await persistRevisions(wi.id, revisions as any[]);
                processedItems++;
            } catch (error) {
                errors++;
                console.log(`[REV BACKFILL] WARN item ${wi.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    console.log('[REV BACKFILL] Done', {
        processedItems,
        persistedRevisions,
        errors,
    });
}

main()
    .catch((error) => {
        console.error('[REV BACKFILL] Failed:', error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
