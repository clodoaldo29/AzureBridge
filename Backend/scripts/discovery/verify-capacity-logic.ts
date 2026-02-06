import { capacityService } from '@/services/capacity.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verify() {
    console.log('🧪 Verifying Capacity vs Planned Logic (Unassigned Check)...\n');

    try {
        // 1. Get a sprint with capacity
        const sprint = await prisma.teamCapacity.findFirst({
            select: { sprintId: true }
        });

        if (!sprint) {
            console.log('❌ No sprint with capacity found. Please run sync-capacity first.');
            return;
        }

        const sprintId = sprint.sprintId;

        // 2. Call Service
        const result: any = await capacityService.getCapacityVsPlanned(sprintId);

        // 3. Print Result
        console.log('\n📊 RESULT:');
        console.log(`Sprint: ${result.sprint.name}`);
        console.log('--------------------------------------------------');
        console.log(`SUMMARY:`);
        console.log(`- Total Available: ${result.summary.totalAvailable.toFixed(1)}h`);
        console.log(`- Total Planned:   ${result.summary.totalPlanned.toFixed(1)}h (Includes Unassigned)`);
        console.log(`   - Assigned:     ${(result.summary.totalPlanned - result.summary.unassigned.totalHours).toFixed(1)}h`);
        console.log(`   - Unassigned:   ${result.summary.unassigned.totalHours.toFixed(1)}h (${result.summary.unassigned.items} items)`);
        console.log(`- Balance:         ${result.summary.balance.toFixed(1)}h`);
        console.log(`- Utilization:     ${result.summary.utilization}%`);
        console.log('--------------------------------------------------');
        console.log('MEMBERS (Top 3):');
        result.byMember.slice(0, 3).forEach((m: any) => {
            console.log(`👤 ${m.member.displayName}:`);
            console.log(`   Capacity: ${m.capacity.available.toFixed(1)}h`);
            console.log(`   Planned:  ${m.planned.total.toFixed(1)}h`);
            console.log(`   Balance:  ${m.balance.toFixed(1)}h`);
        });

    } catch (err) {
        console.error('❌ Error verifying logic:', err);
    } finally {
        await prisma.$disconnect();
    }
}

verify();
