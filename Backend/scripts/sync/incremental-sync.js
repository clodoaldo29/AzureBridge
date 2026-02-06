// Incremental Sync - Only sync changes since last sync
const { PrismaClient } = require('@prisma/client');
const azdev = require('azure-devops-node-api');
require('dotenv/config');

const prisma = new PrismaClient();

async function incrementalSync() {
    console.log('🔄 Starting Incremental Sync...\n');

    const startTime = Date.now();

    try {
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
        const pat = process.env.AZURE_DEVOPS_PAT;
        const azureProject = process.env.AZURE_DEVOPS_PROJECT;

        const authHandler = azdev.getPersonalAccessTokenHandler(pat);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        const witApi = await connection.getWorkItemTrackingApi();

        // Get last sync timestamp from database
        const lastSync = await prisma.syncLog.findFirst({
            where: { status: 'completed', syncType: 'incremental_sync' },
            orderBy: { completedAt: 'desc' }
        });

        const since = lastSync?.completedAt || new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24h if no sync log
        console.log(`📅 Syncing changes since: ${since.toISOString()}\n`);

        let totalUpdated = 0;
        let totalNew = 0;

        // Get all projects from database
        const projects = await prisma.project.findMany();
        console.log(`✅ Found ${projects.length} projects in database\n`);

        // For each project, get changed work items
        for (const project of projects) {
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`🏢 PROJECT: ${project.name}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

            // Query work items changed since last sync
            const wiql = {
                query: `
          SELECT [System.Id]
          FROM WorkItems
          WHERE [System.ChangedDate] >= '${since.toISOString()}'
          ORDER BY [System.ChangedDate] DESC
        `
            };

            const result = await witApi.queryByWiql(wiql, azureProject);
            const ids = result.workItems.map(wi => wi.id);

            if (ids.length === 0) {
                console.log(`✅ No changes found\n`);
                continue;
            }

            console.log(`Found ${ids.length} changed work items`);

            // Fetch in batches
            const batchSize = 100;
            let projectUpdated = 0;
            let projectNew = 0;

            for (let i = 0; i < ids.length; i += batchSize) {
                const batch = ids.slice(i, i + batchSize);
                const batchNum = Math.floor(i / batchSize) + 1;
                const totalBatches = Math.ceil(ids.length / batchSize);

                console.log(`Batch ${batchNum}/${totalBatches}: Fetching ${batch.length} items...`);

                const workItems = await witApi.getWorkItems(batch);

                for (const wi of workItems) {
                    const f = wi.fields;

                    try {
                        // Check if work item exists
                        const existing = await prisma.workItem.findUnique({
                            where: { id: wi.id }
                        });

                        // Find sprint by iteration path
                        const sprint = await prisma.sprint.findFirst({
                            where: { path: f['System.IterationPath'] }
                        });

                        await prisma.workItem.upsert({
                            where: { id: wi.id },
                            create: {
                                id: wi.id,
                                azureId: wi.id,
                                type: f['System.WorkItemType'],
                                state: f['System.State'],
                                reason: f['System.Reason'] || null,
                                title: f['System.Title'],
                                description: f['System.Description'] || null,
                                acceptanceCriteria: f['System.AcceptanceCriteria'] || null,
                                reproSteps: f['Microsoft.VSTS.TCM.ReproSteps'] || null,
                                originalEstimate: f['Microsoft.VSTS.Scheduling.OriginalEstimate'] || null,
                                completedWork: f['Microsoft.VSTS.Scheduling.CompletedWork'] || null,
                                remainingWork: f['Microsoft.VSTS.Scheduling.RemainingWork'] || null,
                                storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
                                priority: f['Microsoft.VSTS.Common.Priority'] || 3,
                                severity: f['Microsoft.VSTS.Common.Severity'] || null,
                                createdDate: new Date(f['System.CreatedDate']),
                                changedDate: new Date(f['System.ChangedDate']),
                                closedDate: f['System.ClosedDate'] ? new Date(f['System.ClosedDate']) : null,
                                resolvedDate: f['System.ResolvedDate'] ? new Date(f['System.ResolvedDate']) : null,
                                stateChangeDate: f['System.StateChangeDate'] ? new Date(f['System.StateChangeDate']) : null,
                                activatedDate: f['Microsoft.VSTS.Common.ActivatedDate'] ? new Date(f['Microsoft.VSTS.Common.ActivatedDate']) : null,
                                createdBy: f['System.CreatedBy'].displayName,
                                changedBy: f['System.ChangedBy'].displayName,
                                closedBy: f['System.ClosedBy']?.displayName || null,
                                resolvedBy: f['System.ResolvedBy']?.displayName || null,
                                tags: f['System.Tags'] ? f['System.Tags'].split(';').map(t => t.trim()) : [],
                                areaPath: f['System.AreaPath'],
                                iterationPath: f['System.IterationPath'],
                                url: wi.url,
                                rev: wi.rev,
                                commentCount: wi.commentCount || 0,
                                projectId: project.id,
                                sprintId: sprint?.id || null,
                            },
                            update: {
                                state: f['System.State'],
                                title: f['System.Title'],
                                description: f['System.Description'] || null,
                                changedDate: new Date(f['System.ChangedDate']),
                                changedBy: f['System.ChangedBy'].displayName,
                                completedWork: f['Microsoft.VSTS.Scheduling.CompletedWork'] || null,
                                remainingWork: f['Microsoft.VSTS.Scheduling.RemainingWork'] || null,
                                sprintId: sprint?.id || null,
                            }
                        });

                        if (existing) {
                            projectUpdated++;
                        } else {
                            projectNew++;
                        }
                    } catch (error) {
                        console.error(`   ❌ Failed to sync #${wi.id}:`, error.message);
                    }
                }

                console.log(`✅ Processed ${i + batch.length}/${ids.length} items`);

                if (i + batchSize < ids.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }

            totalUpdated += projectUpdated;
            totalNew += projectNew;

            console.log(`✅ Project completed: ${projectUpdated} updated, ${projectNew} new\n`);
        }

        // Save sync log
        const duration = Math.floor((Date.now() - startTime) / 1000);

        await prisma.syncLog.create({
            data: {
                syncType: 'incremental_sync',
                status: 'completed',
                startedAt: new Date(startTime),
                completedAt: new Date(),
                duration,
                itemsProcessed: totalUpdated + totalNew,
                itemsUpdated: totalUpdated,
                itemsCreated: totalNew,
                metadata: { since },
            }
        });

        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ INCREMENTAL SYNC COMPLETED!');
        console.log('═══════════════════════════════════════════════════════════\n');
        console.log(`📊 Results:`);
        console.log(`   Updated: ${totalUpdated} work items`);
        console.log(`   New: ${totalNew} work items`);
        console.log(`   Total: ${totalUpdated + totalNew} work items`);
        console.log(`   Duration: ${duration}s\n`);

    } catch (error) {
        console.error('\n❌ Incremental sync failed:');
        console.error(error);

        // Save error log
        await prisma.syncLog.create({
            data: {
                syncType: 'incremental_sync',
                status: 'failed',
                startedAt: new Date(startTime),
                completedAt: new Date(),
                error: error instanceof Error ? error.message : 'Unknown error',
            }
        });
    } finally {
        await prisma.$disconnect();
    }
}

incrementalSync();
