
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
    revisionsPersisted: number;
    errors: number;
}

const DB_RETRY_DELAYS_MS = [5000, 15000, 30000];
const ENABLE_REVISION_PERSISTENCE = ['true', '1', 'yes', 'sim', 'on']
    .includes(String(process.env.ENABLE_REVISION_PERSISTENCE || 'false').trim().toLowerCase());
const REVISION_SYNC_MAX_ITEMS_PER_RUN = Math.max(1, Number(process.env.REVISION_SYNC_MAX_ITEMS_PER_RUN || 100));

function isTransientDbError(error: any): boolean {
    const msg = String(error?.message || error || '');
    return (
        msg.includes('PrismaClientInitializationError') ||
        msg.includes('Can\'t reach database server') ||
        msg.includes('Connection terminated unexpectedly') ||
        msg.includes('Timed out fetching a new connection')
    );
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSmartSyncAttempt() {
    console.log('🧠 COMPLETE SMART SYNC - Updates + Hierarchy + History\n');
    console.log('============================================================\n');

    const startTime = Date.now();
    const stats: SyncStats = {
        totalEvaluated: 0,
        updatedBasic: 0,
        updatedHierarchy: 0,
        updatedHistory: 0,
        revisionsPersisted: 0,
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

        // 2. Determine "Since" (last successful incremental/smart sync)
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
            try {
                await logSync(startTime, stats, 'smart_sync', 'completed', 0);
            } catch (logError: any) {
                console.error('⚠️ Failed to write sync log (completed/no changes):', logError?.message || logError);
            }
            return;
        }

        console.log(`🔍 Found ${changedIds.length} changed items to process.`);

        let revisionBudget = REVISION_SYNC_MAX_ITEMS_PER_RUN;

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

                    if (ENABLE_REVISION_PERSISTENCE && revisionBudget > 0) {
                        const persisted = await persistWorkItemRevisions(azItem.id, witApi, prisma);
                        stats.revisionsPersisted += persisted;
                        revisionBudget--;
                    }

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

        console.log('\n============================================================');
        console.log('✅ SMART SYNC COMPLETED!');
        console.log('============================================================');
        console.log(`📊 Stats:`);
        console.log(`   Evaluated: ${stats.totalEvaluated}`);
        console.log(`   Basic Updates: ${stats.updatedBasic}`);
        console.log(`   Hierarchy Updates: ${stats.updatedHierarchy}`);
        console.log(`   History Recovered: ${stats.updatedHistory}`);
        console.log(`   Revisions Persisted: ${stats.revisionsPersisted}`);
        console.log(`   Errors: ${stats.errors}`);

        try {
            await logSync(startTime, stats, 'smart_sync', 'completed', stats.totalEvaluated);
        } catch (logError: any) {
            console.error('⚠️ Failed to write sync log (completed):', logError?.message || logError);
        }
    } catch (error: any) {
        console.error('\n❌ Smart sync failed:', error);
        try {
            await logSync(startTime, stats, 'smart_sync', 'failed', 0, error.message);
        } catch (logError: any) {
            console.error('❌ Failed to write sync log:', logError?.message || logError);
        }
        throw error;
    }
}

async function smartSync() {
    for (let attempt = 1; attempt <= DB_RETRY_DELAYS_MS.length + 1; attempt++) {
        try {
            await runSmartSyncAttempt();
            return;
        } catch (error: any) {
            const retriable = isTransientDbError(error);
            const hasNextAttempt = attempt <= DB_RETRY_DELAYS_MS.length;
            if (!retriable || !hasNextAttempt) {
                console.error('\n❌ Smart sync failed after retries.');
                process.exit(1);
            }

            const delay = DB_RETRY_DELAYS_MS[attempt - 1];
            console.warn(`\n⚠️ Database unavailable (attempt ${attempt}). Retrying in ${Math.floor(delay / 1000)}s...`);
            await sleep(delay);
        }
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

async function resolveAssignedToMemberId(
    assignedRaw: any,
    projectId: string,
    prisma: PrismaClient
): Promise<string | null> {
    if (!assignedRaw) return null;

    if (typeof assignedRaw === 'object') {
        const uniqueName = assignedRaw.uniqueName ? String(assignedRaw.uniqueName) : null;
        const displayName = assignedRaw.displayName
            ? String(assignedRaw.displayName)
            : (uniqueName || 'Unknown');
        const azureIdentityId = assignedRaw.id
            ? String(assignedRaw.id)
            : (uniqueName ? String(uniqueName) : null);

        if (azureIdentityId) {
            const member = await prisma.teamMember.upsert({
                where: {
                    azureId_projectId: {
                        azureId: azureIdentityId,
                        projectId
                    }
                },
                create: {
                    azureId: azureIdentityId,
                    displayName,
                    uniqueName: uniqueName || displayName,
                    imageUrl: assignedRaw.imageUrl || null,
                    projectId,
                    isActive: true
                },
                update: {
                    displayName,
                    uniqueName: uniqueName || displayName,
                    imageUrl: assignedRaw.imageUrl || null,
                    isActive: true
                }
            });
            return member.id;
        }

        if (uniqueName || displayName) {
            const byIdentity = await prisma.teamMember.findFirst({
                where: {
                    projectId,
                    OR: [
                        ...(uniqueName ? [{ uniqueName }] : []),
                        ...(displayName ? [{ displayName }] : [])
                    ]
                },
                select: { id: true }
            });
            return byIdentity?.id || null;
        }

        return null;
    }

    const assignedText = String(assignedRaw).trim();
    if (!assignedText) return null;

    const byText = await prisma.teamMember.findFirst({
        where: {
            projectId,
            OR: [
                { uniqueName: assignedText },
                { displayName: assignedText }
            ]
        },
        select: { id: true }
    });
    return byText?.id || null;
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
    const state = (f['System.State'] || '').toString();
    const tagsRaw = String(f['System.Tags'] || '').toLowerCase();
    const blockedFieldRaw = f['Microsoft.VSTS.Common.Blocked'];
    const blockedField = typeof blockedFieldRaw === 'boolean'
        ? blockedFieldRaw
        : ['true', 'yes', 'sim', '1'].includes(String(blockedFieldRaw || '').trim().toLowerCase());
    const blockedByState = ['blocked', 'impeded', 'impedido'].includes(state.trim().toLowerCase());
    const boardColumn = String(f['System.BoardColumn'] || '').trim().toLowerCase();
    const blockedByBoardColumn = boardColumn === 'blocked' || boardColumn.includes('imped');
    const blockedByTag = tagsRaw.includes('blocked') || tagsRaw.includes('blocker') || tagsRaw.includes('imped');
    const isBlocked = blockedField || blockedByState || blockedByBoardColumn || blockedByTag;

    const hasField = (fieldName: string) => Object.prototype.hasOwnProperty.call(f, fieldName);
    const stateLower = state.trim().toLowerCase();
    const isDoneState = stateLower === 'done' || stateLower === 'closed' || stateLower === 'completed';

    // Upsert
    const existing = await prisma.workItem.findUnique({
        where: { id },
        // @ts-ignore - Campos historicos existem no banco
        select: {
            remainingWork: true,
            completedWork: true,
            lastRemainingWork: true,
            doneRemainingWork: true
        }
    });

    const incomingRemaining = f['Microsoft.VSTS.Scheduling.RemainingWork'];
    const incomingCompleted = f['Microsoft.VSTS.Scheduling.CompletedWork'];

    // Ausencia de campo no payload nao deve virar reducao de escopo.
    const remainingWork = hasField('Microsoft.VSTS.Scheduling.RemainingWork')
        ? Number(incomingRemaining || 0)
        : Number(existing?.remainingWork || 0);
    const completedWork = hasField('Microsoft.VSTS.Scheduling.CompletedWork')
        ? Number(incomingCompleted || 0)
        : Number(existing?.completedWork || 0);

    const previousLastRemaining = Number((existing as any)?.lastRemainingWork || 0);
    const previousDoneRemaining = Number((existing as any)?.doneRemainingWork || 0);
    const candidateRemainingForHistory = hasField('Microsoft.VSTS.Scheduling.RemainingWork')
        ? Number(incomingRemaining || 0)
        : null;
    const lastRemainingWork = candidateRemainingForHistory !== null
        ? (candidateRemainingForHistory > 0 ? candidateRemainingForHistory : previousLastRemaining)
        : previousLastRemaining;
    const doneRemainingWork = isDoneState
        ? (lastRemainingWork > 0 ? lastRemainingWork : (previousDoneRemaining || null))
        : (previousDoneRemaining || null);
    const assignedToId = await resolveAssignedToMemberId(f['System.AssignedTo'], project.id, prisma);

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
            lastRemainingWork,
            // @ts-ignore - Field exists in DB but client might not be generated yet
            doneRemainingWork,
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
            isBlocked,
            tags: f['System.Tags'] ? f['System.Tags'].split(';').map((t: string) => t.trim()) : [],
            areaPath: f['System.AreaPath'],
            iterationPath: f['System.IterationPath'],
            url: azItem.url,
            rev: azItem.rev,
            projectId: project.id,
            sprintId: sprint?.id,
            assignedToId
        },
        update: {
            state,
            title: f['System.Title'],
            description: f['System.Description'] || null,
            changedDate: d(f['System.ChangedDate'])!,
            changedBy: f['System.ChangedBy']?.displayName || 'Unknown',
            completedWork,
            remainingWork,
            isBlocked,
            // @ts-ignore - Field exists in DB but client might not be generated yet
            lastRemainingWork,
            // @ts-ignore - Field exists in DB but client might not be generated yet
            doneRemainingWork,
            storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
            sprintId: sprint?.id,
            assignedToId,
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

function normalizeRevisionChanges(fields: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
    return fields;
}

async function persistWorkItemRevisions(id: number, witApi: any, prisma: PrismaClient): Promise<number> {
    const revisions = await witApi.getRevisions(id);
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
                    workItemId: id,
                    rev: rev.rev,
                },
            },
            create: {
                workItemId: id,
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

async function recoverHistory(id: number, witApi: any, prisma: PrismaClient): Promise<boolean> {
    try {
        const revisions = await witApi.getRevisions(id);
        let initialRemainingWork = 0;
        let lastRemainingWork = 0;
        let doneRemainingWork = 0;
        let foundInitial = false;
        let lastSeenRemaining = 0;
        let lastNonZeroRemaining = 0;
        let closedDate: Date | null = null;
        let previousState = '';

        for (const rev of revisions) {
            const remaining = rev.fields?.['Microsoft.VSTS.Scheduling.RemainingWork'];
            const state = (rev.fields?.['System.State'] || '').toString().toLowerCase();
            const changedDate = rev.fields?.['System.ChangedDate'];

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

            // Capture closedDate: first transition into a done state
            if (isDone && !closedDate && previousState !== state && changedDate) {
                closedDate = new Date(changedDate);
            }

            if (isDone && doneRemainingWork === 0) {
                if (remaining !== undefined && remaining > 0) {
                    doneRemainingWork = remaining;
                } else if (lastNonZeroRemaining > 0) {
                    doneRemainingWork = lastNonZeroRemaining;
                } else if (lastSeenRemaining > 0) {
                    doneRemainingWork = lastSeenRemaining;
                }
            }

            previousState = state;
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

        const updateData: any = {
            initialRemainingWork,
            lastRemainingWork,
            doneRemainingWork,
        };
        if (closedDate) {
            updateData.closedDate = closedDate;
        }

        await prisma.workItem.update({
            where: { id },
            data: updateData,
        });
        return true;
    } catch (e) {
        // failed
    }
    return false;
}

smartSync().finally(async () => {
    await prisma.$disconnect();
});
