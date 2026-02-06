// Sync Capacity Script (Standalone)
const { PrismaClient } = require('@prisma/client');
const azdev = require('azure-devops-node-api');
require('dotenv/config');

const prisma = new PrismaClient();

async function syncCapacity() {
    console.log('🔗 SYNCING CAPACITY');
    console.log('═══════════════════════════════════════════════════════════\n');

    try {
        // 1. Get credentials
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
        const token = process.env.AZURE_DEVOPS_PAT;

        if (!orgUrl || !token) {
            throw new Error('Missing Azure DevOps credentials in .env');
        }

        const authHandler = azdev.getPersonalAccessTokenHandler(token);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        const workApi = await connection.getWorkApi();
        const coreApi = await connection.getCoreApi();

        // 2. Discover Sprints to sync
        console.log('📊 Fetching sprints from database...');

        let targetSprints = [];
        try {
            targetSprints = await prisma.sprint.findMany({
                where: {
                    timeFrame: { in: ['current', 'future'] }
                },
                include: { project: true }
            });
        } catch (err) {
            console.log(`   ⚠️ Error querying by timeFrame: ${err.message}`);
        }

        if (targetSprints.length === 0) {
            console.log('   ⚠️ No current/future sprints found (or query failed). Fetching recent past sprints for demo...');
            try {
                targetSprints = await prisma.sprint.findMany({
                    take: 5,
                    orderBy: { endDate: 'desc' },
                    include: { project: true }
                });
            } catch (err) {
                console.log(`   ❌ Error fetching fallback sprints: ${err.message}`);
                throw err;
            }
        }

        console.log(`✅ Found ${targetSprints.length} sprints to sync\n`);

        for (const sprint of targetSprints) {
            console.log(`🔄 Syncing Sprint: ${sprint.name} (${sprint.project.name})`);

            try {
                const teams = await coreApi.getTeams(sprint.project.azureId);
                if (teams.length === 0) {
                    console.log(`   ⚠️ No teams found`);
                    continue;
                }
                const team = teams[0];

                const teamContext = {
                    project: sprint.project.name,
                    projectId: sprint.project.azureId,
                    team: team.name,
                    teamId: team.id
                };

                // Fetch Capacities
                let capacityData;
                try {
                    if (typeof workApi.getCapacitiesWithIdentityRefAndTotals === 'function') {
                        capacityData = await workApi.getCapacitiesWithIdentityRefAndTotals(teamContext, sprint.azureId);
                    } else {
                        console.log('   ❌ API Error: Method getCapacitiesWithIdentityRefAndTotals not found');
                        continue;
                    }
                } catch (err) {
                    console.log(`   ❌ API Error calling Azure (getCapacities): ${err.message}`);
                    continue;
                }

                // Fetch Team Days Off explicitly
                let teamDaysOffData = null;
                try {
                    if (typeof workApi.getTeamDaysOff === 'function') {
                        teamDaysOffData = await workApi.getTeamDaysOff(teamContext, sprint.azureId);
                    }
                } catch (err) {
                    console.log(`   ⚠️ Warning: Could not fetch Team Days Off: ${err.message}`);
                }

                if (!capacityData || (!capacityData.teamMembers && !teamDaysOffData)) {
                    console.log(`   ℹ️ No capacity data found`);
                    continue;
                }

                const memberCount = capacityData.teamMembers ? capacityData.teamMembers.length : 0;
                console.log(`   👥 Processing ${memberCount} members...`);

                const sprintStart = new Date(sprint.startDate);
                const sprintEnd = new Date(sprint.endDate);
                const totalSprintDays = getBusinessDays(sprintStart, sprintEnd);

                // Calculate Team Days Off (Business Days only)
                let teamDaysOffCount = 0;
                const teamDaysOff = (teamDaysOffData && teamDaysOffData.daysOff) ? teamDaysOffData.daysOff : [];

                if (teamDaysOff.length > 0) {
                    console.log(`   🏖️ Found ${teamDaysOff.length} team days off ranges via getTeamDaysOff`);
                    for (const d of teamDaysOff) {
                        const start = new Date(d.start);
                        const end = new Date(d.end);
                        // Iterate checking business days overlap with sprint (UTC logic)
                        // We assume start/end are UTC compatible strings
                        for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                            // Check overlap
                            if (dt >= sprintStart && dt <= sprintEnd) {
                                const dayOfWeek = dt.getUTCDay();
                                if (dayOfWeek !== 0 && dayOfWeek !== 6) teamDaysOffCount++;
                            }
                        }
                    }
                } else if (capacityData.teamDaysOff && capacityData.teamDaysOff.length > 0) {
                    console.log(`   🏖️ Found ${capacityData.teamDaysOff.length} team days off ranges via capacityData`);
                    for (const d of capacityData.teamDaysOff) {
                        const start = new Date(d.start);
                        const end = new Date(d.end);
                        for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                            if (dt >= sprintStart && dt <= sprintEnd) {
                                const dayOfWeek = dt.getUTCDay();
                                if (dayOfWeek !== 0 && dayOfWeek !== 6) teamDaysOffCount++;
                            }
                        }
                    }
                }

                const netSprintDays = Math.max(0, totalSprintDays - teamDaysOffCount);
                console.log(`   📅 Sprint Days: ${totalSprintDays} - ${teamDaysOffCount} (Team Off) = ${netSprintDays} Net Days`);

                let syncdCount = 0;

                if (capacityData.teamMembers) {
                    for (const cap of capacityData.teamMembers) {
                        if (!cap.teamMember || !cap.teamMember.id) continue;

                        // Sync Member
                        try {
                            const existingMember = await prisma.teamMember.findFirst({
                                where: {
                                    azureId: cap.teamMember.id,
                                    projectId: sprint.projectId
                                }
                            });

                            let member;
                            if (existingMember) {
                                member = await prisma.teamMember.update({
                                    where: { id: existingMember.id },
                                    data: {
                                        displayName: cap.teamMember.displayName,
                                        imageUrl: cap.teamMember.imageUrl
                                    }
                                });
                            } else {
                                member = await prisma.teamMember.create({
                                    data: {
                                        azureId: cap.teamMember.id,
                                        displayName: cap.teamMember.displayName,
                                        uniqueName: cap.teamMember.uniqueName || cap.teamMember.displayName,
                                        imageUrl: cap.teamMember.imageUrl,
                                        projectId: sprint.projectId
                                    }
                                });
                            }

                            // Calculations
                            const capacityPerDay = cap.activities.reduce((acc, act) => acc + (act.capacityPerDay || 0), 0) || 0;

                            let individualDaysOffCount = 0;
                            if (cap.daysOff) {
                                for (const d of cap.daysOff) {
                                    const start = new Date(d.start);
                                    const end = new Date(d.end);
                                    for (let dt = new Date(start); dt <= end; dt.setUTCDate(dt.getUTCDate() + 1)) {
                                        if (dt >= sprintStart && dt <= sprintEnd) {
                                            const dayOfWeek = dt.getUTCDay();
                                            if (dayOfWeek !== 0 && dayOfWeek !== 6) individualDaysOffCount++;
                                        }
                                    }
                                }
                            }

                            // Subtract individual days off from the Net Sprint Days
                            const availableDays = Math.max(0, netSprintDays - individualDaysOffCount);

                            const totalHours = capacityPerDay * netSprintDays;
                            const availableHours = capacityPerDay * availableDays;

                            // Upsert Capacity
                            await prisma.teamCapacity.upsert({
                                where: {
                                    memberId_sprintId: {
                                        memberId: member.id,
                                        sprintId: sprint.id
                                    }
                                },
                                create: {
                                    memberId: member.id,
                                    sprintId: sprint.id,
                                    totalHours: totalHours,
                                    availableHours: availableHours,
                                    allocatedHours: 0,
                                    daysOff: cap.daysOff || [],
                                    activitiesPerDay: cap.activities || []
                                },
                                update: {
                                    totalHours: totalHours,
                                    availableHours: availableHours,
                                    daysOff: cap.daysOff || [],
                                    activitiesPerDay: cap.activities || []
                                }
                            });
                            syncdCount++;
                        } catch (memberErr) {
                            console.log(`   ⚠️ Error syncing member/capacity: ${memberErr.message}`);
                        }
                    }
                }
                console.log(`   ✅ Synced capacity for ${syncdCount} members in ${sprint.name}\n`);

            } catch (sprintErr) {
                console.log(`   ❌ Error fetching details for sprint ${sprint.name}: ${sprintErr.message}`);
            }
        }

        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ CAPACITY SYNC COMPLETED!');
        console.log('═══════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('\n❌ Capacity sync failed:');
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

function getBusinessDays(startDate, endDate) {
    let count = 0;
    const curDate = new Date(startDate);
    while (curDate <= endDate) {
        const dayOfWeek = curDate.getUTCDay(); // Use UTC
        if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
        curDate.setUTCDate(curDate.getUTCDate() + 1); // Use UTC
    }
    return count;
}

syncCapacity();
