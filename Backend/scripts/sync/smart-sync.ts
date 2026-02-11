
import { PrismaClient } from '@prisma/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';

// Initialize Prisma
const prisma = new PrismaClient();

// Configuration
const BATCH_SIZE = 5; // Smaller batch size due to history fetching
const HISTORY_BATCH_SIZE = 5;

interface SyncStats {
    totalEvaluated: number;
    updatedBasic: number;
    updatedHierarchy: number;
    updatedHistory: number;
    errors: number;
}

async function smartSync() {
    console.log('🧠 COMPLETE SMART SYNC - Updates + Hierarchy + History\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    const startTime = Date.now();
    const stats: SyncStats = {
        totalEvaluated: 0,
        updatedBasic: 0,
        updatedHierarchy: 0,
        updatedHistory: 0,
        errors: 0
    };

    try {
        // 1. Setup Azure Connection
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
        const pat = process.env.AZURE_DEVOPS_PAT;
        const azureProject = process.env.AZURE_DEVOPS_PROJECT;

        if (!orgUrl || !pat) {
            throw new Error('Missing Azure DevOps credentials');
        }

        const authHandler = azdev.getPersonalAccessTokenHandler(pat);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        const witApi = await connection.getWorkItemTrackingApi();

        // 2. Determinar "Since" (último sync incremental bem sucedido)
        const lastSync = await prisma.syncLog.findFirst({
            where: {
                status: 'completed',
                OR: [
                    { syncType: 'incremental_sync' },
                    { syncType: 'smart_sync' } // We will use this new type
                ]
            },
            orderBy: { completedAt: 'desc' }
        });

        // Default to 24h ago if never sync, or uses last sync time
        // For debugging/robustness, let's look back slightly more (e.g., 30 mins buffer if automating)
        // But here we trust the timestamp or default to 1 day
        const since = lastSync?.completedAt || new Date(Date.now() - 24 * 60 * 60 * 1000);
        console.log(`📅 Syncing changes since: ${since.toISOString()}\n`);

        // 3. Find Changed Items
        const sinceDateOnly = since.toISOString().slice(0, 10); // WiQL often prefers YYYY-MM-DD for broad filter

        // Use WiQL to find IDs changed
        // Note: [System.ChangedDate] precision in WiQL can be tricky, using Date string is safer but looser
        // we'll filter strictly in code if needed, but here loose is fine.
        // Format date primarily for WiQL (YYYY-MM-DD) to match incremental-sync behavior
        // Including time causes "You cannot supply a time with the date" error in some API versions
        const formattedDate = since.toISOString().slice(0, 10);

        const wiql = {
            query: `
                SELECT [System.Id]
                FROM WorkItems
                WHERE [System.ChangedDate] >= '${formattedDate}'
                ORDER BY [System.ChangedDate] DESC
            `
        };

        const teamContext = { project: azureProject };
        const result = await witApi.queryByWiql(wiql, teamContext);
        const changedIds = result.workItems?.map(wi => wi.id).filter((id): id is number => typeof id === 'number') || [];

        if (changedIds.length === 0) {
            console.log('✅ No changes found in Azure DevOps.');
            await logSync(startTime, stats, 'smart_sync', 'completed', 0);
            return;
        }

        console.log(`🔍 Found ${changedIds.length} changed items to process.`);

        // 4. Process Items (Basic + Hierarchy)
        // We fetch details in batches
        for (let i = 0; i < changedIds.length; i += 50) { // Fetch batch 50 for details
            const batchIds = changedIds.slice(i, i + 50);
            console.log(`\nProcessing batch ${Math.floor(i / 50) + 1}/${Math.ceil(changedIds.length / 50)} (${batchIds.length} items)...`);

            // 4.1 Get Work Items with Relations (for Hierarchy)
            const azureItems = await witApi.getWorkItems(
                batchIds,
                undefined,
                undefined,
                1 // Expand relations
            );

            let count = 0;
            for (const azItem of azureItems) {
                count++;
                if (!azItem.id) continue;

                // console.log(`   Processing ${count}/${batchIds.length}: #${azItem.id}`);
                process.stdout.write(`\r   Processing item ${count}/${batchIds.length} (ID: ${azItem.id})...`);

                stats.totalEvaluated++;
                try {
                    // Update Basic Data
                    const updated = await syncBasicData(azItem, prisma);
                    if (updated) stats.updatedBasic++;

                    // Update Hierarchy
                    const hierarchyUpdated = await syncHierarchy(azItem, prisma);
                    if (hierarchyUpdated) stats.updatedHierarchy++;

                    // Check History (if initialRemainingWork is 0/null and item is not new)
                    const needsHistory = await checkHistoryNeeded(azItem.id, prisma);
                    if (needsHistory) {
                        // console.log(`   - Fetching history for #${azItem.id}...`);
                        const historyRecovered = await recoverHistory(azItem.id, witApi, prisma);
                        if (historyRecovered) stats.updatedHistory++;
                    }

                } catch (err: any) {
                    console.error(`\n   ❌ Error processing #${azItem.id}:`, err.message);
                    stats.errors++;
                }
            }
            console.log(''); // Newline after batch
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('✅ SMART SYNC COMPLETED!');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`📊 Stats:`);
        console.log(`   Evaluated: ${stats.totalEvaluated}`);
        console.log(`   Basic Updates: ${stats.updatedBasic}`);
        console.log(`   Hierarchy Updates: ${stats.updatedHierarchy}`);
        console.log(`   History Recovered: ${stats.updatedHistory}`);
        console.log(`   Errors: ${stats.errors}`);

        await logSync(startTime, stats, 'smart_sync', 'completed', stats.totalEvaluated);

    } catch (error: any) {
        console.error('\n❌ Smart sync failed:', error);
        await logSync(startTime, stats, 'smart_sync', 'failed', 0, error.message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// --- Helpers ---

async function logSync(startTime: number, stats: SyncStats, type: string, status: string, processed: number, errorMsg?: string) {
    const duration = Math.floor((Date.now() - startTime) / 1000);
    await prisma.syncLog.create({
        data: {
            syncType: type,
            status: status,
            startedAt: new Date(startTime),
            completedAt: new Date(),
            duration,
            itemsProcessed: processed,
            itemsUpdated: stats.updatedBasic + stats.updatedHierarchy + stats.updatedHistory,
            metadata: stats as any,
            error: errorMsg
        }
    });
}

async function syncBasicData(azItem: any, prisma: PrismaClient): Promise<boolean> {
    const f = azItem.fields;
    const id = azItem.id;

    // Determine Project ID (Cache or find)
    const projectName = f['System.TeamProject'];
    const project = await prisma.project.findFirst({ where: { name: projectName } });
    if (!project) return false; // Should likely create project if missing, but for speed skipping

    // Determine Sprint (Iteration)
    const iterationPath = f['System.IterationPath'];
    const sprint = await prisma.sprint.findFirst({ where: { path: iterationPath } });

    // Helper date parser
    const d = (val: any) => val ? new Date(val) : null;

    // Upsert
    const existing = await prisma.workItem.findUnique({ where: { id } });

    const remainingWork = f['Microsoft.VSTS.Scheduling.RemainingWork'] || 0;
    const completedWork = f['Microsoft.VSTS.Scheduling.CompletedWork'] || 0;
    const state = (f['System.State'] || '').toString();

    await prisma.workItem.upsert({
        where: { id },
        create: {
            id,
            azureId: id,
            type: f['System.WorkItemType'],
            state,
            reason: f['System.Reason'] || null,
            title: f['System.Title'],
            description: f['System.Description'] || null,
            acceptanceCriteria: f['System.AcceptanceCriteria'] || null,
            reproSteps: f['Microsoft.VSTS.TCM.ReproSteps'] || null,
            originalEstimate: f['Microsoft.VSTS.Scheduling.OriginalEstimate'] || null,
            completedWork,
            remainingWork,
            // @ts-ignore - Field exists in DB but client might not be generated yet
            lastRemainingWork: remainingWork,
            storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
            priority: f['Microsoft.VSTS.Common.Priority'] || 3,
            severity: f['Microsoft.VSTS.Common.Severity'] || null,
            createdDate: d(f['System.CreatedDate'])!,
            changedDate: d(f['System.ChangedDate'])!,
            closedDate: d(f['System.ClosedDate']),
            resolvedDate: d(f['System.ResolvedDate']),
            stateChangeDate: d(f['System.StateChangeDate']),
            activatedDate: d(f['Microsoft.VSTS.Common.ActivatedDate']),
            createdBy: f['System.CreatedBy']?.displayName || 'Unknown',
            changedBy: f['System.ChangedBy']?.displayName || 'Unknown',
            tags: f['System.Tags'] ? f['System.Tags'].split(';').map((t: string) => t.trim()) : [],
            areaPath: f['System.AreaPath'],
            iterationPath: f['System.IterationPath'],
            url: azItem.url,
            rev: azItem.rev,
            projectId: project.id,
            sprintId: sprint?.id
        },
        update: {
            state,
            title: f['System.Title'],
            description: f['System.Description'] || null,
            changedDate: d(f['System.ChangedDate'])!,
            changedBy: f['System.ChangedBy']?.displayName || 'Unknown',
            completedWork,
            remainingWork,
            // @ts-ignore - Field exists in DB but client might not be generated yet
            lastRemainingWork: remainingWork,
            storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
            sprintId: sprint?.id,
            rev: azItem.rev
        }
    });

    return true;
}

async function syncHierarchy(azItem: any, prisma: PrismaClient): Promise<boolean> {
    if (!azItem.relations) return false;

    const parentRel = azItem.relations.find((r: any) => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
    if (!parentRel) return false;

    // Extract Parent ID
    const match = parentRel.url.match(/workItems\/(\d+)/);
    if (!match) return false;
    const parentAzureId = parseInt(match[1]);

    // Check if Parent exists in DB (we can't link to non-existent parent)
    const parent = await prisma.workItem.findUnique({ where: { azureId: parentAzureId } });
    if (!parent) return false; // Parent not synced yet, maybe next run

    // Update relationship
    await prisma.workItem.update({
        where: { id: azItem.id },
        data: { parentId: parent.id }
    });

    return true;
}

async function checkHistoryNeeded(id: number, prisma: PrismaClient): Promise<boolean> {
    const item = await prisma.workItem.findUnique({
        where: { id },
        // @ts-ignore
        select: { initialRemainingWork: true, lastRemainingWork: true, doneRemainingWork: true, state: true }
    });
    // Check if handling the field via raw query or if schema supports it
    // Assuming schema has it based on context
    const initial = (item as any)?.initialRemainingWork;
    const last = (item as any)?.lastRemainingWork;
    const done = (item as any)?.doneRemainingWork;
    const state = ((item as any)?.state || '').toLowerCase();
    const isDone = state === 'done' || state === 'closed' || state === 'completed';

    return (
        initial === null || initial === 0 ||
        last === null || last === 0 ||
        (isDone && (done === null || done === 0))
    );
}

async function recoverHistory(id: number, witApi: any, prisma: PrismaClient): Promise<boolean> {
    try {
        const revisions = await witApi.getRevisions(id);
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
                lastRemainingWork = remaining;
                lastSeenRemaining = remaining;
                if (remaining > 0) lastNonZeroRemaining = remaining;
            }

            if (!foundInitial && remaining !== undefined && remaining > 0) {
                initialRemainingWork = remaining;
                foundInitial = true;
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

        const current = await witApi.getWorkItem(id);
        const currentRemaining = current.fields['Microsoft.VSTS.Scheduling.RemainingWork'] || 0;
        const currentCompleted = current.fields['Microsoft.VSTS.Scheduling.CompletedWork'] || 0;
        const currentState = (current.fields['System.State'] || '').toString().toLowerCase();

        if (!foundInitial) {
            initialRemainingWork = currentRemaining + currentCompleted;
        }

        if (!lastRemainingWork) {
            lastRemainingWork = lastNonZeroRemaining || currentRemaining;
        }

        if (!doneRemainingWork) {
            const isDone = currentState === 'done' || currentState === 'closed' || currentState === 'completed';
            if (isDone) {
                doneRemainingWork = currentRemaining > 0
                    ? currentRemaining
                    : (lastNonZeroRemaining > 0 ? lastNonZeroRemaining : currentCompleted);
            }
        }

        await prisma.workItem.update({
            where: { id },
            data: {
                // @ts-ignore
                initialRemainingWork,
                // @ts-ignore
                lastRemainingWork,
                // @ts-ignore
                doneRemainingWork
            }
        });
        return true;
    } catch (e) {
        // failed
    }
    return false;
}

smartSync();
