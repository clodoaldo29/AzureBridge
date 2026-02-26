const { PrismaClient } = require('@prisma/client');
const azdev = require('azure-devops-node-api');
require('dotenv/config');

const prisma = new PrismaClient();

function toDate(value) {
    if (!value) return null;
    const dt = new Date(value);
    return isNaN(dt.getTime()) ? null : dt;
}

function toUtcStartOfDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function toUtcEndOfDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function mapStateFromTimeFrame(timeFrame) {
    const tf = String(timeFrame || '').toLowerCase();
    if (tf === 'current') return 'Active';
    if (tf === 'future') return 'Future';
    if (tf === 'past') return 'Past';
    return null;
}

function mapTimeFrameByDateWindow(startDate, endDate, now = new Date()) {
    const start = toUtcStartOfDay(startDate);
    const end = toUtcEndOfDay(endDate);
    if (now >= start && now <= end) return 'current';
    if (now < start) return 'future';
    return 'past';
}

function resolveSprintState(timeFrame, startDate, endDate) {
    const byTimeFrame = mapStateFromTimeFrame(timeFrame);
    const byWindow = mapTimeFrameByDateWindow(startDate, endDate);
    if (byWindow === 'current') return 'Active';
    return byTimeFrame || mapStateFromTimeFrame(byWindow);
}

async function main() {
    console.log('SYNC ALL PROJECTS + SPRINTS');
    console.log('='.repeat(60));

    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (!orgUrl || !pat) throw new Error('Missing Azure DevOps credentials');

    const startedAt = Date.now();
    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const coreApi = await connection.getCoreApi();
    const witApi = await connection.getWorkItemTrackingApi();

    const azureProjects = await coreApi.getProjects();
    if (!azureProjects || azureProjects.length === 0) {
        console.log('❌ No projects found in Azure DevOps.');
        return;
    }

    console.log(`Found ${azureProjects.length} projects in Azure DevOps\n`);

    let totalSprints = 0;
    let totalProjects = 0;

    for (const azProject of azureProjects) {
        console.log(`PROJECT: ${azProject.name}`);

        const dbProject = await prisma.project.upsert({
            where: { azureId: azProject.id },
            create: {
                azureId: azProject.id,
                name: azProject.name,
                description: azProject.description || null,
                state: azProject.state || 'wellFormed',
                visibility: azProject.visibility === 'private' ? 0 : 1
            },
            update: {
                name: azProject.name,
                description: azProject.description || null,
                state: azProject.state || 'wellFormed',
                visibility: azProject.visibility === 'private' ? 0 : 1
            }
        });

        totalProjects++;

        const iterationNode = await witApi.getClassificationNode(
            azProject.name,
            1,
            undefined,
            4
        );

        if (!iterationNode || !iterationNode.children || iterationNode.children.length === 0) {
            console.log('  WARN: No iterations found');
            continue;
        }

        const sprints = [];
        const now = new Date();

        const extractIterations = (node, parentPath = azProject.name) => {
            if (!node) return;
            const nodePath = `${parentPath}\\${node.name}`;

            if (node.attributes) {
                const startDate = toDate(node.attributes.startDate);
                const endDate = toDate(node.attributes.finishDate);
                if (startDate && endDate) {
                    const timeFrame = mapTimeFrameByDateWindow(startDate, endDate, now);
                    const state = resolveSprintState(timeFrame, startDate, endDate);

                    sprints.push({
                        id: node.identifier || node.id?.toString(),
                        name: node.name,
                        path: nodePath,
                        startDate,
                        endDate,
                        timeFrame,
                        state
                    });
                }
            }

            if (node.children && node.children.length > 0) {
                node.children.forEach(child => extractIterations(child, nodePath));
            }
        };

        iterationNode.children.forEach(child => extractIterations(child, azProject.name));

        if (sprints.length === 0) {
            console.log('  WARN: No sprints with dates');
            continue;
        }

        console.log(`  Discovered ${sprints.length} sprints`);

        for (const sprint of sprints) {
            await prisma.sprint.upsert({
                where: { azureId: sprint.id },
                create: {
                    azureId: sprint.id,
                    name: sprint.name,
                    path: sprint.path,
                    startDate: sprint.startDate,
                    endDate: sprint.endDate,
                    state: sprint.state,
                    timeFrame: sprint.timeFrame,
                    projectId: dbProject.id
                },
                update: {
                    name: sprint.name,
                    path: sprint.path,
                    startDate: sprint.startDate,
                    endDate: sprint.endDate,
                    state: sprint.state,
                    timeFrame: sprint.timeFrame,
                    projectId: dbProject.id
                }
            });
        }

        totalSprints += sprints.length;
        console.log(`  Synced ${sprints.length} sprints\n`);
    }

    const duration = Math.floor((Date.now() - startedAt) / 1000);
    console.log('='.repeat(60));
    console.log(`Completed. Projects: ${totalProjects} | Sprints: ${totalSprints} | Duration: ${duration}s`);
}

main()
    .catch(err => {
        console.error('❌ Failed:', err.message || err);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
