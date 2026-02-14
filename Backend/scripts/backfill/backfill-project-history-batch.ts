import { PrismaClient } from '@prisma/client';
import { getAzureDevOpsClient } from '../../src/integrations/azure/client';

const prisma = new PrismaClient();

const BATCH_SIZE = 20;
const DELAY_MS = 500;

function isDoneState(state: string) {
    const s = (state || '').toLowerCase();
    return s === 'done' || s === 'closed' || s === 'completed';
}

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfill() {
    const targetProjects = (process.env.TARGET_PROJECTS || '')
        .split(',')
        .map(p => p.trim())
        .filter(Boolean);
    const useAllProjects = targetProjects.length === 0;

    console.log('BACKFILL HISTORICO (BATCH)');
    console.log('='.repeat(60));
    console.log(`Targets: ${useAllProjects ? 'ALL PROJECTS' : targetProjects.join(', ')}\n`);

    const projects = await prisma.project.findMany({
        where: useAllProjects ? undefined : { name: { in: targetProjects } }
    });
    if (projects.length === 0) {
        console.log('WARN: Nenhum projeto encontrado.');
        return;
    }

    const projectIds = projects.map(p => p.id);

    const workItems = await prisma.workItem.findMany({
        where: {
            projectId: { in: projectIds },
            isRemoved: false,
            OR: [
                { initialRemainingWork: null },
                { initialRemainingWork: 0 },
                { lastRemainingWork: null },
                { lastRemainingWork: 0 },
                // Only recalc doneRemainingWork if item is Done and value is missing/zero
                { AND: [{ state: { in: ['Done', 'Closed', 'Completed'] } }, { doneRemainingWork: 0 }] },
                { AND: [{ state: { in: ['Done', 'Closed', 'Completed'] } }, { doneRemainingWork: null }] },
            ]
        },
        orderBy: { azureId: 'desc' }
    });

    if (workItems.length === 0) {
        console.log('Nothing to backfill.');
        return;
    }

    console.log(`Items pending: ${workItems.length}\n`);

    const client = getAzureDevOpsClient();
    const witApi = await client.getWorkItemTrackingApi();

    let processed = 0;
    let updated = 0;

    for (let i = 0; i < workItems.length; i += BATCH_SIZE) {
        const batch = workItems.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(workItems.length / BATCH_SIZE);

        console.log(`Batch ${batchNum}/${totalBatches} (${batch.length} items)...`);

        for (const item of batch) {
            try {
                const revisions = await witApi.getRevisions(item.azureId);
                let initialRemainingWork = 0;
                let lastRemainingWork = 0;
                let doneRemainingWork = 0;
                let foundInitial = false;
                let lastSeenRemaining = 0;
                let lastNonZeroRemaining = 0;

                for (const rev of revisions) {
                    const remaining = rev.fields?.['Microsoft.VSTS.Scheduling.RemainingWork'];
                    const state = (rev.fields?.['System.State'] || '').toString().toLowerCase();

                    if (remaining !== undefined) {
                        lastSeenRemaining = remaining;
                        if (remaining > 0) lastNonZeroRemaining = remaining;
                        lastRemainingWork = remaining;
                    }

                    if (!foundInitial && remaining !== undefined && remaining > 0) {
                        initialRemainingWork = remaining;
                        foundInitial = true;
                    }

                    if (isDoneState(state) && doneRemainingWork === 0) {
                        if (remaining !== undefined && remaining > 0) {
                            doneRemainingWork = remaining;
                        } else if (lastNonZeroRemaining > 0) {
                            doneRemainingWork = lastNonZeroRemaining;
                        } else if (lastSeenRemaining > 0) {
                            doneRemainingWork = lastSeenRemaining;
                        }
                    }
                }

                if (!foundInitial) {
                    initialRemainingWork = (item.remainingWork || 0) + (item.completedWork || 0);
                }
                if (!lastRemainingWork) {
                    lastRemainingWork = lastNonZeroRemaining || item.remainingWork || 0;
                }
                if (!doneRemainingWork && isDoneState(item.state)) {
                    doneRemainingWork = (item.remainingWork || 0) > 0
                        ? (item.remainingWork || 0)
                        : (lastNonZeroRemaining > 0 ? lastNonZeroRemaining : (item.completedWork || 0));
                }

                await prisma.workItem.update({
                    where: { id: item.id },
                    data: {
                        initialRemainingWork,
                        lastRemainingWork,
                        doneRemainingWork
                    }
                });
                updated++;
            } catch (err) {
                // ignore individual errors
            } finally {
                processed++;
                if (processed % 25 === 0 || processed === workItems.length) {
                    console.log(`Progress: ${processed}/${workItems.length}`);
                }
            }
        }

        await sleep(DELAY_MS);
        console.log(`Batch complete. Progress: ${processed}/${workItems.length}\n`);
    }

    console.log(`Backfill completed. Updated: ${updated}/${workItems.length}`);
}

backfill()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
