// Sync Work Item Hierarchy
const { PrismaClient } = require('@prisma/client');
const azdev = require('azure-devops-node-api');
require('dotenv/config');

const prisma = new PrismaClient();

async function syncWorkItemHierarchy() {
    console.log('🔗 SYNCING WORK ITEM HIERARCHY');
    console.log('═══════════════════════════════════════════════════════════\n');

    try {
        // Connect to Azure DevOps
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
        const token = process.env.AZURE_DEVOPS_PAT;

        if (!orgUrl || !token) {
            throw new Error('Missing Azure DevOps credentials in .env');
        }

        const authHandler = azdev.getPersonalAccessTokenHandler(token);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        const witApi = await connection.getWorkItemTrackingApi();

        // Get all work items from database
        console.log('📊 Fetching work items from database...');
        const workItems = await prisma.workItem.findMany({
            select: {
                id: true,
                azureId: true,
                type: true,
                title: true,
            },
        });

        console.log(`✅ Found ${workItems.length} work items\n`);

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        console.log('🔄 Processing work items in batches...\n');

        // Process in batches to avoid API rate limits
        const batchSize = 50;
        for (let i = 0; i < workItems.length; i += batchSize) {
            const batch = workItems.slice(i, i + batchSize);

            console.log(`Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(workItems.length / batchSize)}: Processing ${batch.length} items...`);

            for (const wi of batch) {
                try {
                    // Fetch work item with relations from Azure DevOps
                    const azureWI = await witApi.getWorkItem(
                        wi.azureId,
                        undefined,
                        undefined,
                        1, // Expand relations
                        undefined
                    );

                    if (!azureWI.relations || azureWI.relations.length === 0) {
                        skipped++;
                        continue;
                    }

                    // Find parent relation (System.LinkTypes.Hierarchy-Reverse)
                    const parentRelation = azureWI.relations.find(
                        r => r.rel === 'System.LinkTypes.Hierarchy-Reverse'
                    );

                    if (!parentRelation) {
                        skipped++;
                        continue;
                    }

                    // Extract parent ID from URL
                    const match = parentRelation.url.match(/workItems\/(\d+)/);
                    if (!match) {
                        console.log(`  ⚠️  Could not extract parent ID from URL: ${parentRelation.url}`);
                        errors++;
                        continue;
                    }

                    const parentAzureId = parseInt(match[1], 10);

                    // Find parent in database
                    const parent = await prisma.workItem.findUnique({
                        where: { azureId: parentAzureId },
                        select: { id: true },
                    });

                    if (!parent) {
                        console.log(`  ⚠️  Parent ${parentAzureId} not found in database for work item ${wi.azureId}`);
                        errors++;
                        continue;
                    }

                    // Update work item with parentId
                    await prisma.workItem.update({
                        where: { id: wi.id },
                        data: { parentId: parent.id },
                    });

                    updated++;

                    // Log progress every 10 updates
                    if (updated % 10 === 0) {
                        console.log(`  ✅ Updated ${updated} work items so far...`);
                    }

                } catch (error) {
                    console.error(`  ❌ Error processing work item ${wi.azureId}:`, error.message);
                    errors++;
                }
            }

            // Delay between batches
            if (i + batchSize < workItems.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('✅ HIERARCHY SYNC COMPLETED!');
        console.log('═══════════════════════════════════════════════════════════\n');

        console.log('📊 Results:');
        console.log(`   Total Work Items: ${workItems.length}`);
        console.log(`   Updated with Parent: ${updated}`);
        console.log(`   Skipped (no parent): ${skipped}`);
        console.log(`   Errors: ${errors}`);
        console.log('');

        // Verify hierarchy
        console.log('🔍 Verifying hierarchy...\n');

        const parentsCount = await prisma.workItem.count({
            where: { parentId: null },
        });

        const childrenCount = await prisma.workItem.count({
            where: { parentId: { not: null } },
        });

        console.log(`📊 Parent Items (no parent): ${parentsCount}`);
        console.log(`📊 Child Items (with parent): ${childrenCount}`);

        // Sample hierarchy
        console.log('\n📋 Sample Hierarchy:\n');

        const sampleParents = await prisma.workItem.findMany({
            where: {
                parentId: null,
                type: 'Product Backlog Item',
            },
            include: {
                children: {
                    select: {
                        azureId: true,
                        type: true,
                        title: true,
                        state: true,
                    },
                },
            },
            take: 3,
        });

        for (const parent of sampleParents) {
            console.log(`📋 PBI #${parent.azureId}: ${parent.title.substring(0, 60)}${parent.title.length > 60 ? '...' : ''}`);
            console.log(`   State: ${parent.state} | Children: ${parent.children.length}`);

            if (parent.children.length > 0) {
                for (const child of parent.children.slice(0, 3)) {
                    const icon = child.type === 'Task' ? '✓' : child.type === 'Bug' ? '🐛' : '🧪';
                    console.log(`     ${icon} ${child.type} #${child.azureId}: ${child.title.substring(0, 50)}${child.title.length > 50 ? '...' : ''}`);
                    console.log(`        State: ${child.state}`);
                }

                if (parent.children.length > 3) {
                    console.log(`     ... and ${parent.children.length - 3} more`);
                }
            }
            console.log('');
        }

    } catch (error) {
        console.error('\n❌ Hierarchy sync failed:');
        console.error(error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

syncWorkItemHierarchy();
