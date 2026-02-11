// Sync Capacity Script (Standalone)
const { PrismaClient } = require('@prisma/client');
const azdev = require('azure-devops-node-api');
require('dotenv/config');

const prisma = new PrismaClient();

function mergeDayOffRanges(memberDaysOff, teamDaysOff) {
    const merged = [...(memberDaysOff || []), ...(teamDaysOff || [])];
    const seen = new Set();
    return merged.filter(r => {
        if (!r?.start || !r?.end) return false;
        const key = `${new Date(r.start).toISOString()}|${new Date(r.end).toISOString()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function syncCapacity() {
    console.log('SYNCING CAPACITY');
    console.log('='.repeat(60));

    try {
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
        const token = process.env.AZURE_DEVOPS_PAT;

        if (!orgUrl || !token) {
            throw new Error('Missing Azure DevOps credentials in .env');
        }

        const authHandler = azdev.getPersonalAccessTokenHandler(token);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        const workApi = await connection.getWorkApi();
        const coreApi = await connection.getCoreApi();

        console.log('Fetching sprints from database...');

        let targetSprints = [];
        try {
            targetSprints = await prisma.sprint.findMany({
                where: {
                    timeFrame: { in: ['current', 'future'] }
                },
                include: { project: true }
            });
        } catch (err) {
            console.log(`WARN: Error querying by timeFrame: ${err.message}`);
        }

        if (targetSprints.length === 0) {
            console.log('WARN: No current/future sprints found. Fetching recent past sprints for demo...');
            targetSprints = await prisma.sprint.findMany({
                take: 5,
                orderBy: { endDate: 'desc' },
                include: { project: true }
            });
        }

        console.log(`Found ${targetSprints.length} sprints to sync\n`);

        let sprintIndex = 0;
        for (const sprint of targetSprints) {
            sprintIndex++;
            console.log(`Sprint (${sprintIndex}/${targetSprints.length}): ${sprint.name} (${sprint.project.name})`);

            try {
                const teams = await coreApi.getTeams(sprint.project.azureId);
                if (teams.length === 0) {
                    console.log('  WARN: No teams found');
                    continue;
                }
                const team = teams[0];

                const teamContext = {
                    project: sprint.project.name,
                    projectId: sprint.project.azureId,
                    team: team.name,
                    teamId: team.id
                };

                let capacityData;
                if (typeof workApi.getCapacitiesWithIdentityRefAndTotals === 'function') {
                    capacityData = await workApi.getCapacitiesWithIdentityRefAndTotals(teamContext, sprint.azureId);
                } else {
                    console.log('  ERROR: API method getCapacitiesWithIdentityRefAndTotals not found');
                    continue;
                }

                let teamDaysOffData = null;
                try {
                    if (typeof workApi.getTeamDaysOff === 'function') {
                        teamDaysOffData = await workApi.getTeamDaysOff(teamContext, sprint.azureId);
                    }
                } catch (err) {
                    console.log(`  WARN: Could not fetch Team Days Off: ${err.message}`);
                }

                if (!capacityData || (!capacityData.teamMembers && !teamDaysOffData)) {
                    console.log('  INFO: No capacity data found');
                    continue;
                }

                const memberCount = capacityData.teamMembers ? capacityData.teamMembers.length : 0;
                console.log(`  Members: ${memberCount}`);

                const sprintStart = new Date(sprint.startDate);
                const sprintEnd = new Date(sprint.endDate);
                const totalSprintDays = getBusinessDays(sprintStart, sprintEnd);

                let teamDaysOffCount = 0;
                const teamDaysOff = (teamDaysOffData && teamDaysOffData.daysOff) ? teamDaysOffData.daysOff : [];

                if (teamDaysOff.length > 0) {
                    console.log(`  Team days off ranges: ${teamDaysOff.length}`);
                    for (const d of teamDaysOff) {
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
                console.log(`  Sprint days: ${totalSprintDays} - ${teamDaysOffCount} (Team Off) = ${netSprintDays} Net Days`);

                let syncedCount = 0;

                if (capacityData.teamMembers) {
                    let memberIndex = 0;
                    for (const cap of capacityData.teamMembers) {
                        memberIndex++;
                        if (!cap.teamMember || !cap.teamMember.id) continue;

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

                        const availableDays = Math.max(0, netSprintDays - individualDaysOffCount);
                        const totalHours = capacityPerDay * netSprintDays;
                        const availableHours = capacityPerDay * availableDays;
                        const mergedDaysOff = mergeDayOffRanges(cap.daysOff || [], teamDaysOff || []);

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
                                daysOff: mergedDaysOff,
                                activitiesPerDay: cap.activities || []
                            },
                            update: {
                                totalHours: totalHours,
                                availableHours: availableHours,
                                daysOff: mergedDaysOff,
                                activitiesPerDay: cap.activities || []
                            }
                        });
                        syncedCount++;

                        if (memberIndex % 10 === 0 || memberIndex === memberCount) {
                            console.log(`  Member progress: ${memberIndex}/${memberCount}`);
                        }
                    }
                }
                console.log(`  Synced capacity for ${syncedCount} members\n`);

            } catch (sprintErr) {
                console.log(`  ERROR: ${sprintErr.message}`);
            }
        }

        console.log('='.repeat(60));
        console.log('CAPACITY SYNC COMPLETED');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('\nERROR: Capacity sync failed:');
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

function getBusinessDays(startDate, endDate) {
    let count = 0;
    const curDate = new Date(startDate);
    while (curDate <= endDate) {
        const dayOfWeek = curDate.getUTCDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) count++;
        curDate.setUTCDate(curDate.getUTCDate() + 1);
    }
    return count;
}

syncCapacity();
