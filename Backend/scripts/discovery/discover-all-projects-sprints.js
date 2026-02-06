// Discover sprints for ALL projects
const azdev = require('azure-devops-node-api');
require('dotenv/config');

async function discoverAllProjectsSprints() {
    console.log('🔍 Discovering Sprints for ALL Projects...\n');

    try {
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
        const pat = process.env.AZURE_DEVOPS_PAT;

        const authHandler = azdev.getPersonalAccessTokenHandler(pat);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        const coreApi = await connection.getCoreApi();
        const witApi = await connection.getWorkItemTrackingApi();

        // Get all projects
        const projects = await coreApi.getProjects();
        console.log(`✅ Found ${projects.length} projects in Azure DevOps\n`);

        const allSprints = {};

        // For each project, get iterations
        for (const project of projects) {
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
            console.log(`🏢 Project: ${project.name}`);
            console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

            try {
                // Get iteration classification nodes
                const iterationNode = await witApi.getClassificationNode(
                    project.name,
                    1, // TreeStructureGroup.Iterations
                    undefined,
                    4
                );

                if (!iterationNode || !iterationNode.children || iterationNode.children.length === 0) {
                    console.log(`⚠️  No iterations found\n`);
                    continue;
                }

                const sprints = [];
                const now = new Date();

                const extractIterations = (node, parentPath = project.name) => {
                    if (!node) return;

                    const nodePath = `${parentPath}\\${node.name}`;

                    if (node.attributes) {
                        const startDate = node.attributes.startDate ? new Date(node.attributes.startDate) : null;
                        const endDate = node.attributes.finishDate ? new Date(node.attributes.finishDate) : null;

                        let timeFrame = 'future';
                        if (startDate && endDate) {
                            if (now >= startDate && now <= endDate) {
                                timeFrame = 'current';
                            } else if (now > endDate) {
                                timeFrame = 'past';
                            }
                        }

                        sprints.push({
                            name: node.name,
                            path: nodePath,
                            timeFrame,
                            startDate: startDate?.toISOString().split('T')[0],
                            endDate: endDate?.toISOString().split('T')[0]
                        });
                    }

                    if (node.children && node.children.length > 0) {
                        node.children.forEach(child => extractIterations(child, nodePath));
                    }
                };

                iterationNode.children.forEach(child => extractIterations(child, project.name));

                if (sprints.length > 0) {
                    console.log(`✅ Found ${sprints.length} sprints:\n`);
                    sprints.forEach(sprint => {
                        const status = sprint.timeFrame === 'current' ? '▶️' :
                            sprint.timeFrame === 'past' ? '✅' : '⏳';
                        console.log(`   ${status} ${sprint.name} (${sprint.timeFrame})`);
                        if (sprint.startDate && sprint.endDate) {
                            console.log(`      ${sprint.startDate} → ${sprint.endDate}`);
                        }
                    });
                    console.log('');
                    allSprints[project.name] = sprints;
                } else {
                    console.log(`⚠️  No sprints with dates found\n`);
                }

            } catch (error) {
                console.error(`❌ Error getting iterations: ${error.message}\n`);
            }
        }

        console.log('═══════════════════════════════════════════════════════════');
        console.log('📊 Summary');
        console.log('═══════════════════════════════════════════════════════════\n');

        const projectsWithSprints = Object.keys(allSprints).length;
        const totalSprints = Object.values(allSprints).reduce((sum, sprints) => sum + sprints.length, 0);

        console.log(`Projects with sprints: ${projectsWithSprints}/${projects.length}`);
        console.log(`Total sprints: ${totalSprints}\n`);

        if (projectsWithSprints > 0) {
            console.log('Sprints by project:');
            Object.entries(allSprints).forEach(([projectName, sprints]) => {
                console.log(`  ${projectName}: ${sprints.length} sprints`);
            });
        }

    } catch (error) {
        console.error('\n❌ Error:');
        console.error(error);
    }
}

discoverAllProjectsSprints();
