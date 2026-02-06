import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSprintWork() {
    console.log('🔍 Analyzing Sprint Work Item Distribution (REFINED)...\n');

    try {
        const sprint = await prisma.teamCapacity.findFirst({
            select: { sprintId: true, sprint: { select: { name: true } } }
        });

        if (!sprint) {
            console.log('❌ No sprint found.');
            return;
        }

        console.log(`📅 Sprint: ${sprint.sprint.name}`);

        // Fetch ONLY Tasks or Bugs (usually where capacity matters)
        const workItems = await prisma.workItem.findMany({
            where: {
                sprintId: sprint.sprintId,
                isRemoved: false,
                // type: { in: ['Task', 'Bug'] } // Let's check all first to be sure
            },
            select: {
                id: true,
                title: true,
                remainingWork: true,
                originalEstimate: true,
                assignedToId: true,
                state: true,
                type: true
            }
        });

        console.log(`\n📋 Found ${workItems.length} items in sprint.`);

        // Buckets
        const stats = {
            assigned: { count: 0, remaining: 0, original: 0 },
            unassigned: { count: 0, remaining: 0, original: 0 }
        };

        workItems.forEach(item => {
            const isAssigned = !!item.assignedToId;
            const bucket = isAssigned ? stats.assigned : stats.unassigned;

            bucket.count++;
            bucket.remaining += (item.remainingWork || 0);
            bucket.original += (item.originalEstimate || 0);
        });

        console.log('\n📊 Statistics:');
        console.log('-------------------------------------------');
        console.log(`✅ ASSIGNED ITEMS (${stats.assigned.count}):`);
        console.log(`   - Remaining Work:   ${stats.assigned.remaining.toFixed(1)}h`);
        console.log(`   - Original Est.:    ${stats.assigned.original.toFixed(1)}h`);
        console.log('-------------------------------------------');
        console.log(`⚠️ UNASSIGNED ITEMS (${stats.unassigned.count}):`);
        console.log(`   - Remaining Work:   ${stats.unassigned.remaining.toFixed(1)}h`);
        console.log(`   - Original Est.:    ${stats.unassigned.original.toFixed(1)}h`);
        console.log('-------------------------------------------');

        // List top unassigned items with hours
        const unassignedWithHours = workItems
            .filter(i => !i.assignedToId && ((i.remainingWork || 0) > 0 || (i.originalEstimate || 0) > 0))
            .sort((a, b) => ((b.remainingWork || 0) - (a.remainingWork || 0)));

        if (unassignedWithHours.length > 0) {
            console.log(`\n📝 Top 5 Unassigned Items with Hours:`);
            unassignedWithHours.slice(0, 5).forEach(i => {
                console.log(`   - [${i.type}] ${i.title.substring(0, 50)}...`);
                console.log(`     State: ${i.state} | Rem: ${i.remainingWork} | Orig: ${i.originalEstimate}`);
            });
        } else {
            console.log('\n❌ No unassigned items have hours (Remaining or Original).');
        }

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        await prisma.$disconnect();
    }
}

checkSprintWork();
