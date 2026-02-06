// Test Classification Nodes API
const azdev = require('azure-devops-node-api');
require('dotenv/config');

async function testClassificationNodes() {
    console.log('🧪 Testing Classification Nodes API...\n');

    try {
        const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
        const pat = process.env.AZURE_DEVOPS_PAT;
        const project = process.env.AZURE_DEVOPS_PROJECT;

        const authHandler = azdev.getPersonalAccessTokenHandler(pat);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        const witApi = await connection.getWorkItemTrackingApi();

        console.log('1️⃣  Fetching Iteration Classification Nodes...\n');

        const iterationNode = await witApi.getClassificationNode(
            project,
            1, // TreeStructureGroup.Iterations = 1
            undefined,
            4
        );

        if (!iterationNode) {
            console.log('❌ No iteration node found');
            return;
        }

        console.log(`✅ Root Node: ${iterationNode.name}`);
        console.log(`   ID: ${iterationNode.id}`);
        console.log(`   Identifier: ${iterationNode.identifier}`);
        console.log(`   Has Children: ${iterationNode.hasChildren}`);
        console.log(`   Children Count: ${iterationNode.children?.length || 0}\n`);

        if (!iterationNode.children || iterationNode.children.length === 0) {
            console.log('⚠️  No child iterations found');
            return;
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📋 Discovered Iterations:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        const sprints = [];
        const now = new Date();

        const extractIterations = (node, parentPath = project, level = 0) => {
            if (!node) return;

            const indent = '  '.repeat(level);
            const nodePath = `${parentPath}\\${node.name}`;

            console.log(`${indent}📁 ${node.name}`);

            if (node.attributes) {
                const startDate = node.attributes.startDate ? new Date(node.attributes.startDate) : null;
                const endDate = node.attributes.finishDate ? new Date(node.attributes.finishDate) : null;

                let timeFrame = 'future';
                let status = '⏳';

                if (startDate && endDate) {
                    if (now >= startDate && now <= endDate) {
                        timeFrame = 'current';
                        status = '▶️';
                    } else if (now > endDate) {
                        timeFrame = 'past';
                        status = '✅';
                    }
                }

                console.log(`${indent}   ${status} ${timeFrame.toUpperCase()}`);
                console.log(`${indent}   Path: ${nodePath}`);

                if (startDate && endDate) {
                    console.log(`${indent}   Start: ${startDate.toISOString().split('T')[0]}`);
                    console.log(`${indent}   End: ${endDate.toISOString().split('T')[0]}`);
                }

                sprints.push({
                    name: node.name,
                    path: nodePath,
                    timeFrame,
                    startDate: startDate?.toISOString(),
                    endDate: endDate?.toISOString()
                });
            }

            if (node.children && node.children.length > 0) {
                node.children.forEach(child => extractIterations(child, nodePath, level + 1));
            }

            console.log('');
        };

        iterationNode.children.forEach(child => extractIterations(child, project, 0));

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 Summary');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log(`Total Iterations Found: ${sprints.length}`);

        const current = sprints.filter(s => s.timeFrame === 'current');
        const past = sprints.filter(s => s.timeFrame === 'past');
        const future = sprints.filter(s => s.timeFrame === 'future');

        console.log(`  Current: ${current.length}`);
        console.log(`  Past: ${past.length}`);
        console.log(`  Future: ${future.length}`);

        if (current.length > 0) {
            console.log(`\n⭐ Current Sprint: ${current[0].name}`);
        }

        console.log('\n✅ Classification Nodes API test completed!');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

testClassificationNodes();
