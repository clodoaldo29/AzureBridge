// Test Hierarchical Queries
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testHierarchicalQueries() {
    console.log('🧪 Testing Hierarchical Queries\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    try {
        // 1. Test: Get all projects
        console.log('1️⃣ Getting all projects...');
        const projects = await prisma.project.findMany();
        console.log(`✅ Found ${projects.length} projects\n`);

        if (projects.length === 0) {
            console.log('⚠️  No projects found. Run sync first.');
            return;
        }

        // 2. Test: Get project with hierarchy
        const project = projects[0];
        console.log(`2️⃣ Testing Project Hierarchy: ${project.name}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        const projectWithHierarchy = await prisma.project.findUnique({
            where: { id: project.id },
            include: {
                sprints: {
                    include: {
                        workItems: {
                            where: { parentId: null },
                            include: {
                                children: {
                                    include: { assignedTo: true },
                                    orderBy: [{ type: 'asc' }, { priority: 'asc' }],
                                },
                                assignedTo: true,
                            },
                            orderBy: [{ type: 'asc' }, { priority: 'asc' }],
                        },
                    },
                    orderBy: { startDate: 'desc' },
                    take: 3, // Only first 3 sprints for testing
                },
            },
        });

        if (!projectWithHierarchy) {
            console.log('❌ Project not found');
            return;
        }

        console.log(`📁 Project: ${projectWithHierarchy.name}`);
        console.log(`📊 Total Sprints: ${projectWithHierarchy.sprints.length}\n`);

        // Display hierarchy
        for (const sprint of projectWithHierarchy.sprints) {
            console.log(`  📅 Sprint: ${sprint.name} (${sprint.state})`);
            console.log(`     Start: ${sprint.startDate.toISOString().split('T')[0]}`);
            console.log(`     End: ${sprint.endDate.toISOString().split('T')[0]}`);
            console.log(`     Parent Items: ${sprint.workItems.length}\n`);

            if (sprint.workItems.length === 0) {
                console.log(`     ⚠️  No work items found\n`);
                continue;
            }

            // Group by type
            const byType = sprint.workItems.reduce((acc, wi) => {
                acc[wi.type] = (acc[wi.type] || 0) + 1;
                return acc;
            }, {});

            console.log(`     Work Items by Type:`);
            Object.entries(byType).forEach(([type, count]) => {
                console.log(`       - ${type}: ${count}`);
            });
            console.log('');

            // Show first 3 parent items with children
            const itemsToShow = sprint.workItems.slice(0, 3);

            for (const wi of itemsToShow) {
                const icon = wi.type === 'Product Backlog Item' ? '📋' :
                    wi.type === 'Feature' ? '🎯' :
                        wi.type === 'Epic' ? '🏔️' : '📝';

                console.log(`     ${icon} ${wi.type}: ${wi.title.substring(0, 60)}${wi.title.length > 60 ? '...' : ''}`);
                console.log(`        ID: ${wi.azureId} | State: ${wi.state} | Priority: ${wi.priority || 'N/A'}`);

                if (wi.storyPoints) {
                    console.log(`        Story Points: ${wi.storyPoints}`);
                }

                if (wi.assignedTo) {
                    console.log(`        Assigned: ${wi.assignedTo.displayName}`);
                }

                if (wi.children && wi.children.length > 0) {
                    console.log(`        Children: ${wi.children.length}`);

                    // Group children by type
                    const childrenByType = wi.children.reduce((acc, child) => {
                        acc[child.type] = (acc[child.type] || 0) + 1;
                        return acc;
                    }, {});

                    Object.entries(childrenByType).forEach(([type, count]) => {
                        const childIcon = type === 'Task' ? '✓' :
                            type === 'Bug' ? '🐛' :
                                type === 'Test' ? '🧪' : '•';
                        console.log(`          ${childIcon} ${type}: ${count}`);
                    });

                    // Show first 3 children
                    const childrenToShow = wi.children.slice(0, 3);
                    for (const child of childrenToShow) {
                        const childIcon = child.type === 'Task' ? '✓' :
                            child.type === 'Bug' ? '🐛' :
                                child.type === 'Test' ? '🧪' : '•';
                        console.log(`            ${childIcon} ${child.title.substring(0, 50)}${child.title.length > 50 ? '...' : ''}`);
                        console.log(`               State: ${child.state} | Remaining: ${child.remainingWork || 0}h`);
                    }

                    if (wi.children.length > 3) {
                        console.log(`            ... and ${wi.children.length - 3} more`);
                    }
                } else {
                    console.log(`        Children: 0`);
                }
                console.log('');
            }

            if (sprint.workItems.length > 3) {
                console.log(`     ... and ${sprint.workItems.length - 3} more parent items\n`);
            }
        }

        // 3. Test: Statistics
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('3️⃣ Hierarchy Statistics');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        let totalParents = 0;
        let totalChildren = 0;
        let parentsWithChildren = 0;

        for (const sprint of projectWithHierarchy.sprints) {
            totalParents += sprint.workItems.length;

            for (const wi of sprint.workItems) {
                if (wi.children && wi.children.length > 0) {
                    parentsWithChildren++;
                    totalChildren += wi.children.length;
                }
            }
        }

        console.log(`📊 Total Parent Items: ${totalParents}`);
        console.log(`📊 Total Child Items: ${totalChildren}`);
        console.log(`📊 Parents with Children: ${parentsWithChildren}`);
        console.log(`📊 Average Children per Parent: ${parentsWithChildren > 0 ? (totalChildren / parentsWithChildren).toFixed(2) : 0}`);

        // 4. Test: Check for orphaned children (children without parents)
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('4️⃣ Data Integrity Check');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        const orphanedChildren = await prisma.workItem.findMany({
            where: {
                parentId: { not: null },
                parent: null,
            },
        });

        if (orphanedChildren.length > 0) {
            console.log(`⚠️  Found ${orphanedChildren.length} orphaned children (parentId set but parent doesn't exist)`);
            console.log(`   This is normal if parent items haven't been synced yet.\n`);
        } else {
            console.log(`✅ No orphaned children found\n`);
        }

        // Check for items with parentId but parent not in same sprint
        const childrenInDifferentSprint = await prisma.workItem.findMany({
            where: {
                parentId: { not: null },
            },
            include: {
                parent: true,
            },
        });

        const mismatchedSprints = childrenInDifferentSprint.filter(
            child => child.sprintId !== child.parent?.sprintId
        );

        if (mismatchedSprints.length > 0) {
            console.log(`⚠️  Found ${mismatchedSprints.length} children in different sprint than parent`);
            console.log(`   This can happen when items are moved between sprints.\n`);
        } else {
            console.log(`✅ All children are in same sprint as parent\n`);
        }

        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ HIERARCHY TEST COMPLETED!');
        console.log('═══════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('\n❌ Test failed:');
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

testHierarchicalQueries();
