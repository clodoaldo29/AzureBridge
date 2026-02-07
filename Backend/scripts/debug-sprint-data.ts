
import { prisma } from '../src/database/client';

async function main() {
    const sprintName = 'AV-NAV SP11';
    const sprint = await prisma.sprint.findFirst({
        where: { name: { contains: sprintName } },
        include: { project: true }
    });

    if (!sprint) {
        console.log(`Sprint '${sprintName}' not found.`);
        return;
    }

    console.log(`Found Sprint: ${sprint.name} (ID: ${sprint.id})`);
    console.log(`Project: ${sprint.project.name}`);

    const items = await prisma.workItem.findMany({
        where: { sprintId: sprint.id, isRemoved: false },
        select: {
            id: true,
            azureId: true,
            title: true,
            remainingWork: true,
            initialRemainingWork: true,
            state: true,
            type: true
        }
    });

    console.log(`Found ${items.length} items in sprint.`);

    let totalPlanned = 0;
    let totalRemaining = 0;
    let countDiscrepancy = 0;
    let countMissingInitial = 0;

    console.log('--- Discrepant Items (Remaining > Initial) ---');
    for (const item of items) {
        const planned = item.initialRemainingWork || 0;
        const remaining = item.remainingWork || 0;

        // Logic from Service
        const calculatedPlanned = planned > 0 ? planned : remaining;

        totalPlanned += calculatedPlanned;
        totalRemaining += remaining;

        if (remaining > planned && planned > 0) {
            console.log(`[#${item.azureId}] ${item.title.substring(0, 30)}... | Initial: ${planned} | Remaining: ${remaining} (Diff: ${remaining - planned})`);
            countDiscrepancy++;
        }

        if (planned === 0 && remaining > 0) {
            console.log(`[#${item.azureId}] ${item.title.substring(0, 30)}... | NO INITIAL | Remaining: ${remaining}`);
            countMissingInitial++;
        }
    }

    console.log('--- Summary ---');
    console.log(`Total Items: ${items.length}`);
    console.log(`Items with Remaining > Initial: ${countDiscrepancy}`);
    console.log(`Items with NO Initial (using fallback): ${countMissingInitial}`);
    console.log(`Calculated Total Planned: ${totalPlanned}`);
    console.log(`Calculated Total Remaining: ${totalRemaining}`);
}

main();
