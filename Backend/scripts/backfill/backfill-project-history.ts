import { PrismaClient } from '@prisma/client';
import { getAzureDevOpsClient } from '../../src/integrations/azure/client.js';

// Initialize Prisma
const prisma = new PrismaClient();

// Configuration
const BATCH_SIZE = 5;
const DELAY_MS = 1000;
const TARGET_PROJECTS = ['GIGA - Tempos e Movimentos', 'GIGA - Retrabalho'];

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfillProjectHistory() {
    console.log('=== BACKFILL HISTÓRICO DE PROJETOS ===\n');
    console.log(`Alvos: ${TARGET_PROJECTS.join(', ')}\n`);

    // 1. Find Projects
    const projects = await prisma.project.findMany({
        where: {
            name: { in: TARGET_PROJECTS }
        }
    });

    if (projects.length === 0) {
        console.error('❌ Nenhum projeto encontrado com os nomes especificados.');
        return;
    }

    const projectIds = projects.map(p => p.id);
    console.log(`Projetos encontrados: ${projects.length} (${projects.map(p => p.name).join(', ')})`);

    // 2. Fetch target work items (where initialRemainingWork is 0 or null)
    // We cast logic to 'any' to bypass TS errors if client is outdated
    const workItems = await prisma.workItem.findMany({
        where: {
            projectId: { in: projectIds },
            // @ts-ignore - Field exists in DB
            OR: [
                { initialRemainingWork: null },
                { initialRemainingWork: 0 },
                { lastRemainingWork: null },
                { lastRemainingWork: 0 },
                { doneRemainingWork: null },
                { doneRemainingWork: 0 }
            ],
            isRemoved: false
        },
        orderBy: { azureId: 'desc' } // Process newest first
    });

    console.log(`\nFound ${workItems.length} work items pending history recovery.\n`);

    if (workItems.length === 0) {
        console.log('✅ Tudo atualizado! Nada a fazer.');
        return;
    }

    // 3. Initialize Azure Client
    const client = getAzureDevOpsClient();
    const witApi = await client.getWorkItemTrackingApi();

    let totalRecovered = 0;
    let processedCount = 0;
    let updatedCount = 0;
    let fallbackCount = 0;

    // 4. Process in batches
    for (let i = 0; i < workItems.length; i += BATCH_SIZE) {
        const batch = workItems.slice(i, i + BATCH_SIZE);
        const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(workItems.length / BATCH_SIZE);

        console.log(`Processing batch ${currentBatchNum}/${totalBatches} (${Math.round((i / workItems.length) * 100)}%)...`);

        const promises = batch.map(async (item: any) => {
            try {
                // Fetch revisions - passing only ID
                const revisions = await witApi.getRevisions(item.azureId);

                // Find history for Remaining Work
                let initialRemainingWork = 0;
                let lastRemainingWork = 0;
                let doneRemainingWork = 0;
                let foundHistorical = false;
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

                    if (!foundHistorical && remaining !== undefined && remaining > 0) {
                        initialRemainingWork = remaining;
                        foundHistorical = true;
                    }

                    const isDone = state === 'done' || state === 'closed' || state === 'completed';
                    if (isDone && doneRemainingWork === 0) {
                        if (remaining !== undefined && remaining > 0) {
                            doneRemainingWork = remaining;
                        } else if (lastNonZeroRemaining > 0) {
                            doneRemainingWork = lastNonZeroRemaining;
                        } else if (lastSeenRemaining > 0) {
                            doneRemainingWork = lastSeenRemaining;
                        }
                    }
                }

                // Fallback to current if not found in history
                if (!foundHistorical) {
                    initialRemainingWork = (item.remainingWork || 0) + (item.completedWork || 0);
                }

                if (!lastRemainingWork) {
                    lastRemainingWork = lastNonZeroRemaining || item.remainingWork || 0;
                }

                if (!doneRemainingWork) {
                    const state = (item.state || '').toString().toLowerCase();
                    const isDone = state === 'done' || state === 'closed' || state === 'completed';
                    if (isDone) {
                        doneRemainingWork = (item.remainingWork || 0) > 0
                            ? (item.remainingWork || 0)
                            : (lastNonZeroRemaining > 0 ? lastNonZeroRemaining : (item.completedWork || 0));
                    }
                }

                return {
                    id: item.id,
                    azureId: item.azureId,
                    title: item.title,
                    currentRemaining: item.remainingWork || 0,
                    recoveredInitial: initialRemainingWork,
                    recoveredLast: lastRemainingWork,
                    recoveredDone: doneRemainingWork,
                    foundHistorical
                };
            } catch (error: any) {
                console.error(`   ❌ Error fetching #${item.azureId}: ${error.message}`);
                return {
                    id: item.id,
                    azureId: item.azureId,
                    error: true
                };
            }
        });

        const results = await Promise.all(promises);

        // Update DB
        for (const res of results) {
            processedCount++;

            if (res.error) continue;

            // Only update if value is meaningful or at least initialized
            if (res.recoveredInitial >= 0) {
                try {
                    await prisma.workItem.update({
                        where: { id: res.id },
                        data: {
                            // @ts-ignore
                            initialRemainingWork: res.recoveredInitial,
                            // @ts-ignore
                            lastRemainingWork: res.recoveredLast,
                            // @ts-ignore
                            doneRemainingWork: res.recoveredDone
                        }
                    });

                    if (res.foundHistorical) {
                        updatedCount++;
                        if (res.recoveredInitial > res.currentRemaining) {
                            // console.log(`   #${res.azureId}: ${res.currentRemaining} -> ${res.recoveredInitial} (Recovered!)`);
                        }
                    } else {
                        fallbackCount++;
                    }

                    totalRecovered += res.recoveredInitial;

                } catch (err: any) {
                    console.error(`   Failed DB update #${res.azureId}: ${err.message}`);
                }
            }
        }

        // Rate limiting
        await sleep(DELAY_MS);
    }

    console.log('\n=== GLOBAL BACKFILL COMPLETE ===');
    console.log(`Processed: ${processedCount}/${workItems.length}`);
    console.log(`Found History: ${updatedCount}`);
    console.log(`Used Fallback: ${fallbackCount}`);
    console.log('✅ Database is now consistent with Azure DevOps history.');
}

backfillProjectHistory()
    .catch(e => {
        console.error('Fatal:', e);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
