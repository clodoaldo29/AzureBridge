// COMPLETE SYNC - All Projects, All Sprints, All Work Items
const { PrismaClient } = require('@prisma/client');
const azdev = require('azure-devops-node-api');
require('dotenv/config');

const prisma = new PrismaClient();

async function completeMassiveSync() {
    console.log('🚀 COMPLETE MASSIVE SYNC - All Projects, All Sprints, All Work Items\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    const startTime = Date.now();

    try {
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
        const pat = process.env.AZURE_DEVOPS_PAT;
        const azureProject = process.env.AZURE_DEVOPS_PROJECT;

        const authHandler = azdev.getPersonalAccessTokenHandler(pat);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        const coreApi = await connection.getCoreApi();
        const witApi = await connection.getWorkItemTrackingApi();

        // Get all projects from Azure DevOps
        const azureProjects = await coreApi.getProjects();
        console.log(`✅ Found ${azureProjects.length} projects in Azure DevOps\n`);

        let totalSprints = 0;
        let totalWorkItems = 0;
        const stats = {};

        // Process each project
        for (const azProject of azureProjects) {
            console.log('═══════════════════════════════════════════════════════════');
            console.log(`🏢 PROJECT: ${azProject.name}`);
            console.log('═══════════════════════════════════════════════════════════\n');

            stats[azProject.name] = { sprints: 0, workItems: 0 };

            // Get or create project in database
            let dbProject = await prisma.project.findFirst({
                where: { name: azProject.name }
            });

            if (!dbProject) {
                console.log(`Creating project in database...`);
                dbProject = await prisma.project.create({
                    data: {
                        azureId: azProject.id,
                        name: azProject.name,
                        description: azProject.description || null,
                        state: azProject.state || 'wellFormed',
                        visibility: azProject.visibility === 'private' ? 0 : 1,
                    }
                });
                console.log(`✅ Project created\n`);
            }

            // Get iterations for this project
            try {
                const iterationNode = await witApi.getClassificationNode(
                    azProject.name,
                    1, // TreeStructureGroup.Iterations
                    undefined,
                    4
                );

                if (!iterationNode || !iterationNode.children || iterationNode.children.length === 0) {
                    console.log(`⚠️  No iterations found for this project\n`);
                    continue;
                }

                // Extract all sprints
                const sprints = [];
                const now = new Date();

                const extractIterations = (node, parentPath = azProject.name) => {
                    if (!node) return;

                    const nodePath = `${parentPath}\\${node.name}`;

                    if (node.attributes) {
                        const startDate = node.attributes.startDate ? new Date(node.attributes.startDate) : null;
                        const endDate = node.attributes.finishDate ? new Date(node.attributes.finishDate) : null;

                        if (startDate && endDate) {
                            let timeFrame = 'future';
                            if (now >= startDate && now <= endDate) {
                                timeFrame = 'current';
                            } else if (now > endDate) {
                                timeFrame = 'past';
                            }

                            sprints.push({
                                id: node.identifier || node.id?.toString(),
                                name: node.name,
                                path: nodePath,
                                startDate,
                                endDate,
                                timeFrame
                            });
                        }
                    }

                    if (node.children && node.children.length > 0) {
                        node.children.forEach(child => extractIterations(child, nodePath));
                    }
                };

                iterationNode.children.forEach(child => extractIterations(child, azProject.name));

                if (sprints.length === 0) {
                    console.log(`⚠️  No sprints with dates found\n`);
                    continue;
                }

                console.log(`✅ Found ${sprints.length} sprints\n`);

                // Sync sprints to database
                for (const sprint of sprints) {
                    await prisma.sprint.upsert({
                        where: { azureId: sprint.id },
                        create: {
                            azureId: sprint.id,
                            name: sprint.name,
                            path: sprint.path,
                            startDate: sprint.startDate,
                            endDate: sprint.endDate,
                            state: sprint.timeFrame === 'current' ? 'Active' : 'Past',
                            timeFrame: sprint.timeFrame,
                            projectId: dbProject.id,
                        },
                        update: {
                            name: sprint.name,
                            path: sprint.path,
                            startDate: sprint.startDate,
                            endDate: sprint.endDate,
                            state: sprint.timeFrame === 'current' ? 'Active' : 'Past',
                            timeFrame: sprint.timeFrame,
                        }
                    });

                    stats[azProject.name].sprints++;
                    totalSprints++;
                }

                console.log(`✅ Synced ${sprints.length} sprints to database\n`);

                // Now sync work items for each sprint
                let projectWorkItems = 0;

                for (const sprint of sprints) {
                    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                    console.log(`📋 Sprint: ${sprint.name} (${sprint.timeFrame})`);
                    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

                    // Query work items
                    const wiql = {
                        query: `
              SELECT [System.Id]
              FROM WorkItems
              WHERE [System.IterationPath] = '${sprint.path}'
              AND [System.WorkItemType] IN ('Product Backlog Item', 'Bug', 'Task', 'Feature')
              ORDER BY [System.WorkItemType]
            `
                    };

                    const result = await witApi.queryByWiql(wiql, azureProject);
                    const ids = result.workItems.map(wi => wi.id);

                    if (ids.length === 0) {
                        console.log(`⚠️  No work items found\n`);
                        continue;
                    }

                    console.log(`Found ${ids.length} work items`);

                    // Get sprint from database
                    const dbSprint = await prisma.sprint.findFirst({
                        where: { azureId: sprint.id }
                    });

                    // Fetch in batches
                    const batchSize = 100;
                    let sprintCount = 0;

                    for (let i = 0; i < ids.length; i += batchSize) {
                        const batch = ids.slice(i, i + batchSize);
                        const batchNum = Math.floor(i / batchSize) + 1;
                        const totalBatches = Math.ceil(ids.length / batchSize);

                        console.log(`Batch ${batchNum}/${totalBatches}: Fetching ${batch.length} items...`);

                        const workItems = await witApi.getWorkItems(batch);

                        for (const wi of workItems) {
                            const f = wi.fields;

                            try {
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
                                        projectId: dbProject.id,
                                        sprintId: dbSprint.id,
                                    },
                                    update: {
                                        state: f['System.State'],
                                        title: f['System.Title'],
                                        changedDate: new Date(f['System.ChangedDate']),
                                        changedBy: f['System.ChangedBy'].displayName,
                                    }
                                });

                                sprintCount++;
                            } catch (error) {
                                console.error(`   ❌ Failed to save #${wi.id}:`, error.message);
                            }
                        }

                        console.log(`✅ Saved ${sprintCount} items so far`);

                        if (i + batchSize < ids.length) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }

                    projectWorkItems += sprintCount;
                    console.log(`✅ Sprint completed: ${sprintCount} work items\n`);
                }

                stats[azProject.name].workItems = projectWorkItems;
                totalWorkItems += projectWorkItems;
                console.log(`✅ PROJECT COMPLETED: ${projectWorkItems} work items\n`);

            } catch (error) {
                console.error(`❌ Error processing project: ${error.message}\n`);
            }
        }

        const duration = Math.floor((Date.now() - startTime) / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;

        console.log('═══════════════════════════════════════════════════════════');
        console.log('🎉 COMPLETE MASSIVE SYNC FINISHED!');
        console.log('═══════════════════════════════════════════════════════════\n');
        console.log(`📊 Overall Results:`);
        console.log(`   Projects: ${azureProjects.length}`);
        console.log(`   Sprints: ${totalSprints}`);
        console.log(`   Work Items: ${totalWorkItems}`);
        console.log(`   Duration: ${minutes}m ${seconds}s\n`);

        console.log(`📊 Details by Project:`);
        Object.entries(stats).forEach(([projectName, data]) => {
            if (data.sprints > 0 || data.workItems > 0) {
                console.log(`\n   ${projectName}:`);
                console.log(`      Sprints: ${data.sprints}`);
                console.log(`      Work Items: ${data.workItems}`);
            }
        });
        console.log('');

    } catch (error) {
        console.error('\n❌ Sync failed:');
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

completeMassiveSync();
