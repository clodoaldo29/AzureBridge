import { PrismaClient } from '@prisma/client';
import { getAzureDevOpsClient } from '../src/integrations/azure/client.js';

const prisma = new PrismaClient();

// Configuration
const BATCH_SIZE = 5;
const DELAY_MS = 1000;

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function recoverAllInitialHours() {
    console.log('=== RECUPERAÇÃO COMPLETA DE HORAS PLANEJADAS (HISTÓRICO) ===\n');

    // 1. Find Sprint 5
    const sprint = await prisma.sprint.findFirst({
        where: {
            name: 'Sprint 5',
            path: { startsWith: 'GIGA - Retrabalho' }
        },
        include: {
            project: true,
            snapshots: {
                orderBy: { snapshotDate: 'asc' },
                take: 1
            }
        }
    });

    if (!sprint) {
        console.error('❌ Sprint 5 not found');
        return;
    }

    if (sprint.snapshots.length === 0) {
        console.error('❌ No baseline snapshot found. Please run create-baseline-snapshot.ts first.');
        return;
    }

    const baselineSnapshot = sprint.snapshots[0];
    console.log(`Sprint: ${sprint.name}`);
    console.log(`Baseline Snapshot ID: ${baselineSnapshot.id}`);
    console.log(`Current Total Work: ${baselineSnapshot.totalWork}h\n`);

    // 2. Fetch all work items
    const workItems = await prisma.workItem.findMany({
        where: { sprintId: sprint.id, isRemoved: false },
        orderBy: { azureId: 'asc' }
    });

    console.log(`Found ${workItems.length} work items to process.\n`);

    // 3. Initialize Azure Client
    const client = getAzureDevOpsClient();
    const witApi = await client.getWorkItemTrackingApi();
    const projectId = sprint.project.azureId;

    let totalRecoveredPlannedHours = 0;
    let processedCount = 0;
    let itemsUpdatedCount = 0;

    // Detailed logs for verification
    const details = [];

    // 4. Process in batches
    for (let i = 0; i < workItems.length; i += BATCH_SIZE) {
        const batch = workItems.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(workItems.length / BATCH_SIZE)}...`);

        const promises = batch.map(async (item) => {
            try {
                // Fetch revisions - passing only ID as per potential signature mismatch
                // If project is needed, it might be in the connection context or different method
                const revisions = await witApi.getRevisions(item.azureId);

                // Find first non-zero Remaining Work
                let initialRemainingWork = 0;
                let usedFallback = false;

                for (const rev of revisions) {
                    const val = rev.fields?.['Microsoft.VSTS.Scheduling.RemainingWork'];
                    if (val !== undefined && val > 0) {
                        initialRemainingWork = val;
                        break; // Stop at first non-zero value
                    }
                }

                // If not found in history (rare), revert to current or completed
                if (initialRemainingWork === 0) {
                    initialRemainingWork = (item.remainingWork || 0) + (item.completedWork || 0);
                    usedFallback = true;
                }

                return {
                    id: item.id,
                    azureId: item.azureId,
                    title: item.title,
                    currentRemaining: item.remainingWork || 0,
                    recoveredInitial: initialRemainingWork,
                    usedFallback
                };
            } catch (error: any) {
                console.error(`   ❌ Error fetching history for #${item.azureId}: ${error.message}`);
                return {
                    id: item.id,
                    azureId: item.azureId,
                    title: item.title,
                    currentRemaining: item.remainingWork || 0,
                    recoveredInitial: (item.remainingWork || 0), // Fallback to current
                    error: true
                };
            }
        });

        const results = await Promise.all(promises);

        // Aggregate results
        for (const res of results) {
            totalRecoveredPlannedHours += res.recoveredInitial;
            processedCount++;

            if (res.recoveredInitial > res.currentRemaining) {
                itemsUpdatedCount++;
                details.push(`#${res.azureId}: ${res.currentRemaining}h -> ${res.recoveredInitial}h (${res.title.substring(0, 30)}...)`);
            } else if (res.currentRemaining === 0 && res.recoveredInitial > 0) {
                itemsUpdatedCount++;
                details.push(`#${res.azureId}: 0h -> ${res.recoveredInitial}h (RECOVERED)`);
            }

            // Update DB immediately
            if (!res.error && res.recoveredInitial > 0) {
                try {
                    await prisma.workItem.update({
                        where: { id: res.id },
                        data: { initialRemainingWork: res.recoveredInitial }
                    });
                } catch (err: any) {
                    console.error(`Failed to update DB for item ${res.azureId}: ${err.message}`);
                }
            }
        }

        // Rate limiting delay
        await sleep(DELAY_MS);
    }

    console.log('\n=== RECOVERY COMPLETE ===');
    console.log(`Processed: ${processedCount}/${workItems.length}`);
    console.log(`Items with hidden planned hours: ${itemsUpdatedCount}`);

    if (details.length > 0) {
        console.log('\nSample Recoveries:');
        details.slice(0, 10).forEach(d => console.log(`   ${d}`));
        if (details.length > 10) console.log(`   ... and ${details.length - 10} more`);
    }

    console.log(`\nBefore Recovery (Current State): ${baselineSnapshot.totalWork}h`);
    console.log(`After Recovery (Historical Data): ${totalRecoveredPlannedHours}h`);
    console.log(`Difference: +${totalRecoveredPlannedHours - baselineSnapshot.totalWork}h`);

    // 5. Update Snapshot logic
    // We already updated work items in the loop above.
    // Now just recalculate snapshot for consistency.

    // We can now calculate total planned by summing initialRemainingWork
    const updatedSprint = await prisma.sprint.findUnique({
        where: { id: sprint.id },
        include: {
            workItems: true
        }
    });

    const newTotalPlanned = updatedSprint?.workItems.reduce((sum, item) => sum + (item.initialRemainingWork || 0), 0) || 0;

    console.log(`\nNew Total Planned (Sum of initialRemainingWork): ${newTotalPlanned}h`);

    if (baselineSnapshot) {
        console.log('Updating baseline snapshot to match...');
        await prisma.sprintSnapshot.update({
            where: { id: baselineSnapshot.id },
            data: { totalWork: newTotalPlanned }
        });
        console.log('✅ Snapshot updated successfully!');
    }
}

recoverAllInitialHours()
    .catch(e => {
        console.error('Fatal Error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
