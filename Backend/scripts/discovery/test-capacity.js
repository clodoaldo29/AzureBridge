// Test Capacity Discovery
const fs = require('fs');
const path = require('path');
const azdev = require('azure-devops-node-api');
const { PrismaClient } = require('@prisma/client');
require('dotenv/config');

const prisma = new PrismaClient();

async function testCapacity() {
    console.log('🧪 Testing Capacity Discovery\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    try {
        // 1. Get credentials
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
        const token = process.env.AZURE_DEVOPS_PAT;

        if (!orgUrl || !token) {
            throw new Error('Missing Azure DevOps credentials in .env');
        }

        // 2. Connect to Azure DevOps
        const authHandler = azdev.getPersonalAccessTokenHandler(token);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        const workApi = await connection.getWorkApi();
        const coreApi = await connection.getCoreApi();

        // 3. Get Project and Team
        // We need a project and its default team
        const projects = await coreApi.getProjects();
        if (projects.length === 0) {
            throw new Error('No projects found');
        }

        const project = projects.find(p => p.name === 'GIGA - Tempos e Movimentos') || projects[0];
        console.log(`🏢 Project: ${project.name} (${project.id})`);

        const teams = await coreApi.getTeams(project.id);
        if (teams.length === 0) {
            throw new Error('No teams found');
        }

        // Usually the default team has the same name as the project + " Team"
        const team = teams[0];
        console.log(`👥 Team: ${team.name} (${team.id})`);

        // 4. Get Sprints (Iterations)
        // We need an iteration ID to fetch capacity
        const teamContext = {
            project: project.name,
            projectId: project.id,
            team: team.name,
            teamId: team.id
        };

        console.log(`Context:`, JSON.stringify(teamContext, null, 2));

        const iterations = await workApi.getTeamIterations(teamContext);
        console.log(`📅 Found ${iterations.length} iterations`);

        // Find current or a recent past iteration
        const iteration = iterations.find(i => i.attributes && i.attributes.timeFrame !== 'future') || iterations[iterations.length - 1];

        if (!iteration) {
            throw new Error('No valid iteration found');
        }

        console.log(`📅 Testing Iteration: ${iteration.name} (ID: ${iteration.id})`);
        console.log(`   TimeFrame: ${iteration.attributes?.timeFrame}`);
        console.log(`   Path: ${iteration.path}\n`);

        // 5. Fetch Capacities
        console.log('📊 Fetching Capacities...');
        console.log(`   Calling workApi.getCapacitiesWithIdentityRefAndTotals...`);

        try {
            // Try getting capacities with identity ref
            const capacities = await workApi.getCapacitiesWithIdentityRefAndTotals(teamContext, iteration.id);

            if (!capacities || !capacities.teamMembers || capacities.teamMembers.length === 0) {
                console.log('⚠️  No capacities found for this iteration');
            } else {
                console.log(`✅ Found ${capacities.teamMembers.length} capacity entries\n`);
                console.log(`📊 Team Total Capacity: ${capacities.totalCapacityPerDay}h/day`);
                console.log(`🏖️ Team Days Off: ${capacities.teamDaysOff ? capacities.teamDaysOff.length : 0}`);

                for (const cap of capacities.teamMembers) {
                    const memberName = cap.teamMember ? cap.teamMember.displayName : 'Unknown';
                    const memberId = cap.teamMember ? cap.teamMember.id : 'No ID';

                    console.log(`👤 User: ${memberName}`);
                    console.log(`   ID: ${memberId}`);

                    // Days Off
                    if (cap.daysOff && cap.daysOff.length > 0) {
                        console.log(`   🏖️ Days Off: ${cap.daysOff.length}`);
                        cap.daysOff.forEach(d => {
                            const start = d.start instanceof Date ? d.start.toISOString().split('T')[0] : d.start;
                            const end = d.end instanceof Date ? d.end.toISOString().split('T')[0] : d.end;
                            console.log(`      - ${start} to ${end}`);
                        });
                    } else {
                        console.log(`   🏖️ Days Off: 0`);
                    }

                    // Activities
                    if (cap.activities && cap.activities.length > 0) {
                        console.log(`   ⚡ Activities:`);
                        cap.activities.forEach(a => {
                            console.log(`      - ${a.name}: ${a.capacityPerDay}h/day`);
                        });
                    }
                    console.log('');
                }
            }
        } catch (apiError) {
            console.error('❌ API Error calling getCapacitiesWithIdentityRefAndTotals:', apiError.message);
            if (apiError.result) {
                console.error('   API Result:', JSON.stringify(apiError.result, null, 2));
            }
        }

        console.log('═══════════════════════════════════════════════════════════');
        console.log('✅ CAPACITY TEST COMPLETED!');
        console.log('═══════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('\n❌ Test failed:');
        console.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

testCapacity();
