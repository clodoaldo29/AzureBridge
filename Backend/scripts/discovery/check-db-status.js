const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkStatus() {
    console.log('📊 DATABASE STATUS CHECK\n');

    try {
        // 1. Counts
        const workItems = await prisma.workItem.count();
        const workItemsWithParent = await prisma.workItem.count({ where: { parentId: { not: null } } });
        const sprints = await prisma.sprint.count();
        const capacities = await prisma.teamCapacity.count();
        const projects = await prisma.project.count();

        console.log(`📦 ENTITIES:`);
        console.log(`- Projects:    ${projects}`);
        console.log(`- Sprints:     ${sprints}`);
        console.log(`- Work Items:  ${workItems} (Synced Hierarchy: ${workItemsWithParent})`);
        console.log(`- Capacity:    ${capacities} records`);
        console.log('');

        // 2. Sync Logs
        console.log(`📝 RECENT SYNC LOGS:`);
        try {
            const logs = await prisma.syncLog.findMany({
                take: 5,
                orderBy: { startedAt: 'desc' }
            });

            if (logs.length === 0) {
                console.log('   (No logs found)');
            } else {
                logs.forEach(log => {
                    const dur = log.duration ? `${log.duration}s` : 'running/unknown';
                    console.log(`- [${log.status}] ${log.syncType} (Started: ${log.startedAt.toISOString()}, Duration: ${dur})`);
                    if (log.status === 'FAILED') console.log(`   ❌ Error: ${log.error}`);
                    if (log.itemsProcessed > 0) console.log(`   Stats: ${log.itemsProcessed} processed, ${log.itemsCreated} new, ${log.itemsUpdated} updated`);
                });
            }
        } catch (e) {
            console.log(`   ⚠️ Could not fetch logs (SyncLog table might be empty or missing): ${e.message}`);
        }

    } catch (err) {
        console.error('❌ Error checking status:', err);
    } finally {
        await prisma.$disconnect();
    }
}

checkStatus();
