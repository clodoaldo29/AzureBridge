// Debug Capacity JSON structure
const azdev = require('azure-devops-node-api');
require('dotenv/config');

async function debugCapacity() {
    try {
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
        const token = process.env.AZURE_DEVOPS_PAT;
        const authHandler = azdev.getPersonalAccessTokenHandler(token);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        const workApi = await connection.getWorkApi();
        const coreApi = await connection.getCoreApi();

        // Hardcoded for the specific sprint shown in user image: "AV-NAV SP11"
        const projects = await coreApi.getProjects();
        const project = projects.find(p => p.name === 'GIGA - Tempos e Movimentos');

        if (!project) throw new Error('Project not found');
        console.log(`Project: ${project.name}`);

        const teams = await coreApi.getTeams(project.id);
        const team = teams[0];
        console.log(`Team: ${team.name}`);

        const teamContext = { project: project.name, projectId: project.id, team: team.name, teamId: team.id };

        // Find the iteration
        const iterations = await workApi.getTeamIterations(teamContext);
        const iteration = iterations.find(i => i.name === 'AV-NAV SP11');

        if (!iteration) {
            console.log('Sprint AV-NAV SP11 not found in iterations list. Listing available ones:');
            iterations.forEach(i => console.log(`- ${i.name}`));
            return;
        }

        console.log(`Found Iteration: ${iteration.name} (${iteration.id})`);

        // Fetch capacity
        console.log('Fetching capacity...');
        const capacity = await workApi.getCapacitiesWithIdentityRefAndTotals(teamContext, iteration.id);

        console.log('--- CAPACITY RAW DATA START ---');
        console.log(JSON.stringify(capacity, null, 2));
        console.log('--- CAPACITY RAW DATA END ---');

        console.log('\nFetching Team Days Off explicitly...');
        if (typeof workApi.getTeamDaysOff === 'function') {
            const teamDaysOff = await workApi.getTeamDaysOff(teamContext, iteration.id);
            console.log('--- TEAM DAYS OFF START ---');
            console.log(JSON.stringify(teamDaysOff, null, 2));
            console.log('--- TEAM DAYS OFF END ---');
        } else {
            console.log('Method getTeamDaysOff not found on workApi');
        }

    } catch (error) {
        console.error(error);
    }
}

debugCapacity();
