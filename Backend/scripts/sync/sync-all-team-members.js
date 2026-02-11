const { PrismaClient } = require('@prisma/client');
const azdev = require('azure-devops-node-api');
require('dotenv/config');

const prisma = new PrismaClient();

async function main() {
    console.log('SYNC TEAM MEMBERS (ALL PROJECTS)');
    console.log('='.repeat(60));

    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (!orgUrl || !pat) throw new Error('Missing Azure DevOps credentials');

    const startedAt = Date.now();
    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const coreApi = await connection.getCoreApi();

    const azureProjects = await coreApi.getProjects();
    if (!azureProjects || azureProjects.length === 0) {
        console.log('❌ No projects found in Azure DevOps.');
        return;
    }

    console.log(`Found ${azureProjects.length} projects in Azure DevOps\n`);

    let totalMembers = 0;
    let totalProjects = 0;

    for (const azProject of azureProjects) {
        console.log(`PROJECT: ${azProject.name}`);

        const dbProject = await prisma.project.findFirst({
            where: { azureId: azProject.id }
        });

        if (!dbProject) {
            console.log('  WARN: Project not found in DB. Run sync-all-projects first.');
            continue;
        }

        const teams = await coreApi.getTeams(azProject.id);
        if (teams.length === 0) {
            console.log('  WARN: No teams found');
            continue;
        }

        let upserts = 0;
        const seen = new Set();

        for (const team of teams) {
            console.log(`  Team: ${team.name}`);
            const members = await coreApi.getTeamMembersWithExtendedProperties(azProject.id, team.id);
            for (const m of members) {
                const azureId = m.identity?.id || m.identity?.uniqueName;
                if (!azureId) continue;
                if (seen.has(azureId)) continue;
                seen.add(azureId);

                await prisma.teamMember.upsert({
                    where: {
                        azureId_projectId: {
                            azureId,
                            projectId: dbProject.id
                        }
                    },
                    create: {
                        azureId,
                        displayName: m.identity?.displayName || m.identity?.uniqueName || 'Unknown',
                        uniqueName: m.identity?.uniqueName || m.identity?.displayName || 'Unknown',
                        imageUrl: m.identity?.imageUrl || null,
                        projectId: dbProject.id
                    },
                    update: {
                        displayName: m.identity?.displayName || m.identity?.uniqueName || 'Unknown',
                        imageUrl: m.identity?.imageUrl || null
                    }
                });
                upserts++;
            }
        }

        totalMembers += upserts;
        totalProjects++;
        console.log(`  Synced ${upserts} unique team members\n`);
    }

    const duration = Math.floor((Date.now() - startedAt) / 1000);
    console.log('='.repeat(60));
    console.log(`Completed. Projects: ${totalProjects} | Members: ${totalMembers} | Duration: ${duration}s`);
}

main()
    .catch(err => {
        console.error('❌ Failed:', err.message || err);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
