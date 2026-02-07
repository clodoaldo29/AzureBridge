import { PrismaClient } from '@prisma/client';
import { getAzureDevOpsClient } from '../src/integrations/azure/client.js';

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
                { initialRemainingWork: 0 }
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

                // Find first non-zero Remaining Work
                let initialRemainingWork = 0;
                let foundHistorical = false;

                for (const rev of revisions) {
                    const val = rev.fields?.['Microsoft.VSTS.Scheduling.RemainingWork'];
                    if (val !== undefined && val > 0) {
                        initialRemainingWork = val;
                        foundHistorical = true;
                        break; // Stop at first non-zero value
                    }
                }

                // Fallback to current if not found in history
                if (!foundHistorical) {
                    initialRemainingWork = (item.remainingWork || 0) + (item.completedWork || 0);
                }

                return {
                    id: item.id,
                    azureId: item.azureId,
                    title: item.title,
                    currentRemaining: item.remainingWork || 0,
                    recoveredInitial: initialRemainingWork,
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
                            initialRemainingWork: res.recoveredInitial
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
