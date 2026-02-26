// Sync only target projects, then backfill history and run smart-sync
const { PrismaClient } = require('@prisma/client');
const azdev = require('azure-devops-node-api');
const { spawnSync } = require('child_process');
require('dotenv/config');

const prisma = new PrismaClient();

const DEFAULT_TARGETS = ['GIGA - Retrabalho', 'GIGA - Tempos e Movimentos'];
const ENABLE_REVISION_PERSISTENCE = ['true', '1', 'yes', 'sim', 'on']
    .includes(String(process.env.ENABLE_REVISION_PERSISTENCE || 'false').trim().toLowerCase());
const REVISION_SYNC_MAX_ITEMS_PER_RUN = Math.max(1, Number(process.env.REVISION_SYNC_MAX_ITEMS_PER_RUN || 100));

function getTargets() {
    const env = process.env.TARGET_PROJECTS;
    if (!env) return DEFAULT_TARGETS;
    return env.split(',').map(p => p.trim()).filter(Boolean);
}

function isDoneState(state) {
    const s = (state || '').toString().toLowerCase();
    return s === 'done' || s === 'closed' || s === 'completed';
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

function normalizeRevisionChanges(fields) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
    return fields;
}

async function persistWorkItemRevisions(workItemId, witApi) {
    const revisions = await witApi.getRevisions(workItemId);
    if (!Array.isArray(revisions) || revisions.length === 0) return 0;

    let persisted = 0;
    for (const rev of revisions) {
        if (typeof rev?.rev !== 'number') continue;
        const fields = normalizeRevisionChanges(rev.fields);
        const changedFields = Object.keys(fields);
        const revisedDateRaw = fields['System.ChangedDate'] || fields['System.RevisedDate'];
        const revisedDate = revisedDateRaw ? new Date(revisedDateRaw) : new Date();
        const revisedByObj = fields['System.ChangedBy'];
        const revisedBy = revisedByObj?.displayName || revisedByObj?.uniqueName || rev.revisedBy?.displayName || 'Unknown';

        await prisma.workItemRevision.upsert({
            where: {
                workItemId_rev: {
                    workItemId,
                    rev: rev.rev,
                },
            },
            create: {
                workItemId,
                rev: rev.rev,
                revisedDate,
                revisedBy,
                changes: fields,
                changedFields,
            },
            update: {
                revisedDate,
                revisedBy,
                changes: fields,
                changedFields,
            },
        });
        persisted++;
    }

    return persisted;
}

async function resolveAssignedToMemberId(assignedRaw, projectId) {
    if (!assignedRaw) return null;

    if (typeof assignedRaw === 'object') {
        const uniqueName = assignedRaw.uniqueName ? String(assignedRaw.uniqueName) : null;
        const displayName = assignedRaw.displayName
            ? String(assignedRaw.displayName)
            : (uniqueName || 'Unknown');
        const azureIdentityId = assignedRaw.id
            ? String(assignedRaw.id)
            : (uniqueName ? String(uniqueName) : null);

        if (azureIdentityId) {
            const member = await prisma.teamMember.upsert({
                where: {
                    azureId_projectId: {
                        azureId: azureIdentityId,
                        projectId
                    }
                },
                create: {
                    azureId: azureIdentityId,
                    displayName,
                    uniqueName: uniqueName || displayName,
                    imageUrl: assignedRaw.imageUrl || null,
                    projectId,
                    isActive: true
                },
                update: {
                    displayName,
                    uniqueName: uniqueName || displayName,
                    imageUrl: assignedRaw.imageUrl || null,
                    isActive: true
                }
            });
            return member.id;
        }

        if (uniqueName || displayName) {
            const byIdentity = await prisma.teamMember.findFirst({
                where: {
                    projectId,
                    OR: [
                        ...(uniqueName ? [{ uniqueName }] : []),
                        ...(displayName ? [{ displayName }] : []),
                    ]
                },
                select: { id: true }
            });
            return byIdentity?.id || null;
        }

        return null;
    }

    const assignedText = String(assignedRaw).trim();
    if (!assignedText) return null;

    const byText = await prisma.teamMember.findFirst({
        where: {
            projectId,
            OR: [
                { uniqueName: assignedText },
                { displayName: assignedText }
            ]
        },
        select: { id: true }
    });
    return byText?.id || null;
}

async function syncTargets() {
    console.log('SYNC TARGET PROJECTS');
    console.log('='.repeat(60));
    const targets = getTargets();
    console.log(`Targets: ${targets.join(', ')}\n`);

    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (!orgUrl || !pat) {
        throw new Error('Missing Azure DevOps credentials');
    }

    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const coreApi = await connection.getCoreApi();
    const witApi = await connection.getWorkItemTrackingApi();

    const azureProjects = await coreApi.getProjects();
    const targetProjects = azureProjects.filter(p => targets.includes(p.name));

    if (targetProjects.length === 0) {
        console.log('WARN: No target projects found in Azure DevOps.');
        return;
    }

    const stats = {};
    let projectIndex = 0;
    let revisionBudget = REVISION_SYNC_MAX_ITEMS_PER_RUN;
    let revisionsPersisted = 0;

    for (const azProject of targetProjects) {
        projectIndex++;
        console.log('='.repeat(60));
        console.log(`PROJECT (${projectIndex}/${targetProjects.length}): ${azProject.name}`);
        console.log('='.repeat(60));

        let dbProject = await prisma.project.findFirst({
            where: { name: azProject.name }
        });

        if (!dbProject) {
            dbProject = await prisma.project.create({
                data: {
                    azureId: azProject.id,
                    name: azProject.name,
                    description: azProject.description || null,
                    state: azProject.state || 'wellFormed',
                    visibility: azProject.visibility === 'private' ? 0 : 1,
                }
            });
        }

        stats[azProject.name] = { sprints: 0, workItems: 0 };

        // Sync team members first (to enable assignedToId mapping)
        try {
            const teams = await coreApi.getTeams(azProject.id);
            if (teams.length > 0) {
                const team = teams[0];
                const members = await coreApi.getTeamMembersWithExtendedProperties(azProject.id, team.id);
                for (const m of members) {
                    const azureId = m.identity?.id || m.identity?.uniqueName;
                    if (!azureId) continue;
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
                }
                console.log(`Team members synced: ${members.length}\n`);
            }
        } catch (err) {
            console.log(`WARN: Failed to sync team members: ${err.message}`);
        }

        // Get iterations (sprints)
        const iterationNode = await witApi.getClassificationNode(
            azProject.name,
            1,
            undefined,
            4
        );

        if (!iterationNode || !iterationNode.children || iterationNode.children.length === 0) {
            console.log('WARN: No iterations found for this project\n');
            continue;
        }

        const sprints = [];
        const now = new Date();

        const extractIterations = (node, parentPath = azProject.name) => {
            if (!node) return;
            const nodePath = `${parentPath}\\${node.name}`;

            if (node.attributes) {
                const startDate = node.attributes.startDate ? new Date(node.attributes.startDate) : null;
                const endDate = node.attributes.finishDate ? new Date(node.attributes.finishDate) : null;
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

        // Sprint name filter rules:
        // - "GIGA - Retrabalho": all sprints
        // - "GIGA - Tempos e Movimentos": only sprints with "AV-NAV" in the name
        const sprintNameFilter = (sprintName) => {
            if (azProject.name === 'GIGA - Retrabalho') return true;
            if (azProject.name === 'GIGA - Tempos e Movimentos') {
                return sprintName.toUpperCase().includes('AV-NAV');
            }
            return true;
        };

        const filteredSprints = sprints.filter(s => sprintNameFilter(s.name));

        if (filteredSprints.length === 0) {
            console.log('WARN: No sprints with dates found\n');
            continue;
        }

        // Sync sprints
        console.log(`Sprints found: ${sprints.length} | After filter: ${filteredSprints.length}\n`);

        for (const sprint of filteredSprints) {
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
                    projectId: dbProject.id,
                },
                update: {
                    name: sprint.name,
                    path: sprint.path,
                    startDate: sprint.startDate,
                    endDate: sprint.endDate,
                    state: sprint.state,
                    timeFrame: sprint.timeFrame,
                    projectId: dbProject.id,
                }
            });

            stats[azProject.name].sprints++;
        }

        console.log(`Sprints synced: ${filteredSprints.length}\n`);

        // Sync work items for each sprint
        let projectWorkItems = 0;
        let sprintIndex = 0;

        for (const sprint of filteredSprints) {
            sprintIndex++;
            console.log(`Sprint (${sprintIndex}/${filteredSprints.length}): ${sprint.name} (${sprint.timeFrame})`);

            const wiql = {
                query: `
          SELECT [System.Id]
          FROM WorkItems
          WHERE [System.IterationPath] = '${sprint.path}'
          AND [System.WorkItemType] IN ('Product Backlog Item', 'Bug', 'Task', 'Feature')
          ORDER BY [System.WorkItemType]
        `
            };

            const result = await witApi.queryByWiql(wiql, azProject.name);
            const ids = result.workItems?.map(wi => wi.id) || [];

            if (ids.length === 0) {
                console.log('  WARN: No work items found\n');
                continue;
            }

            console.log(`  Work items: ${ids.length}`);

            const dbSprint = await prisma.sprint.findFirst({ where: { azureId: sprint.id } });
            if (!dbSprint) continue;

            const batchSize = 100;
            let sprintCount = 0;

            for (let i = 0; i < ids.length; i += batchSize) {
                const batch = ids.slice(i, i + batchSize);
                const batchNum = Math.floor(i / batchSize) + 1;
                const totalBatches = Math.ceil(ids.length / batchSize);
                console.log(`  Batch ${batchNum}/${totalBatches}: ${batch.length} items`);
                const workItems = await witApi.getWorkItems(batch);

                for (const wi of workItems) {
                    const f = wi.fields;
                    const remainingWork = f['Microsoft.VSTS.Scheduling.RemainingWork'] || 0;
                    const completedWork = f['Microsoft.VSTS.Scheduling.CompletedWork'] || 0;
                    const state = (f['System.State'] || '').toString();
                    const doneRemainingWork = isDoneState(state)
                        ? (remainingWork > 0 ? remainingWork : completedWork)
                        : null;

                    const assignedToId = await resolveAssignedToMemberId(
                        f['System.AssignedTo'],
                        dbProject.id
                    );

                    await prisma.workItem.upsert({
                        where: { id: wi.id },
                        create: {
                            id: wi.id,
                            azureId: wi.id,
                            type: f['System.WorkItemType'],
                            state: f['System.State'],
                            reason: f['System.Reason'] || null,
                            title: f['System.Title'],
                            description: f['System.Description'] || null,
                            acceptanceCriteria: f['System.AcceptanceCriteria'] || null,
                            reproSteps: f['Microsoft.VSTS.TCM.ReproSteps'] || null,
                            originalEstimate: f['Microsoft.VSTS.Scheduling.OriginalEstimate'] || null,
                            completedWork,
                            remainingWork,
                            lastRemainingWork: remainingWork,
                            doneRemainingWork,
                            storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
                            priority: f['Microsoft.VSTS.Common.Priority'] || 3,
                            severity: f['Microsoft.VSTS.Common.Severity'] || null,
                            createdDate: new Date(f['System.CreatedDate']),
                            changedDate: new Date(f['System.ChangedDate']),
                            closedDate: f['System.ClosedDate'] ? new Date(f['System.ClosedDate']) : null,
                            resolvedDate: f['System.ResolvedDate'] ? new Date(f['System.ResolvedDate']) : null,
                            stateChangeDate: f['System.StateChangeDate'] ? new Date(f['System.StateChangeDate']) : null,
                            activatedDate: f['Microsoft.VSTS.Common.ActivatedDate'] ? new Date(f['Microsoft.VSTS.Common.ActivatedDate']) : null,
                            createdBy: f['System.CreatedBy'].displayName,
                            changedBy: f['System.ChangedBy'].displayName,
                            closedBy: f['System.ClosedBy']?.displayName || null,
                            resolvedBy: f['System.ResolvedBy']?.displayName || null,
                            tags: f['System.Tags'] ? f['System.Tags'].split(';').map(t => t.trim()) : [],
                            areaPath: f['System.AreaPath'],
                            iterationPath: f['System.IterationPath'],
                            url: wi.url,
                            rev: wi.rev,
                            commentCount: wi.commentCount || 0,
                            projectId: dbProject.id,
                            sprintId: dbSprint.id,
                            assignedToId: assignedToId,
                        },
                        update: {
                            state: f['System.State'],
                            title: f['System.Title'],
                            changedDate: new Date(f['System.ChangedDate']),
                            changedBy: f['System.ChangedBy'].displayName,
                            completedWork,
                            remainingWork,
                            lastRemainingWork: remainingWork,
                            doneRemainingWork,
                            sprintId: dbSprint.id,
                            assignedToId: assignedToId,
                        }
                    });

                    if (ENABLE_REVISION_PERSISTENCE && revisionBudget > 0) {
                        try {
                            revisionsPersisted += await persistWorkItemRevisions(wi.id, witApi);
                            revisionBudget--;
                        } catch (err) {
                            console.log(`  WARN: Failed to persist revisions for WI ${wi.id}: ${err.message}`);
                        }
                    }

                    sprintCount++;
                }

                console.log(`  Progress: ${Math.min(sprintCount, ids.length)}/${ids.length}`);

                if (i + batchSize < ids.length) {
                    await sleep(500);
                }
            }

            projectWorkItems += sprintCount;
            console.log(`  Sprint completed: ${sprintCount} items\n`);
        }

        stats[azProject.name].workItems = projectWorkItems;
        console.log(`PROJECT COMPLETED: ${projectWorkItems} work items\n`);
    }

    console.log('Summary:');
    Object.entries(stats).forEach(([projectName, data]) => {
        console.log(`  ${projectName}: ${data.sprints} sprints, ${data.workItems} work items`);
    });
    if (ENABLE_REVISION_PERSISTENCE) {
        console.log(`Revisions persisted: ${revisionsPersisted} (budget used: ${REVISION_SYNC_MAX_ITEMS_PER_RUN - revisionBudget}/${REVISION_SYNC_MAX_ITEMS_PER_RUN})`);
    }
    console.log('='.repeat(60));
}

async function backfillHistoryForTargets() {
    const targets = getTargets();
    console.log('BACKFILL HISTORY');
    console.log('='.repeat(60));
    console.log(`Targets: ${targets.join(', ')}\n`);

    const projects = await prisma.project.findMany({
        where: { name: { in: targets } }
    });
    if (projects.length === 0) {
        console.log('WARN: No target projects found in DB.');
        return;
    }

    const projectIds = projects.map(p => p.id);

    const workItems = await prisma.workItem.findMany({
        where: {
            projectId: { in: projectIds },
            OR: [
                { initialRemainingWork: null },
                { initialRemainingWork: 0 },
                { lastRemainingWork: null },
                { lastRemainingWork: 0 },
                { doneRemainingWork: null },
                { doneRemainingWork: 0 }
            ],
            isRemoved: false
        },
        orderBy: { azureId: 'desc' }
    });

    if (workItems.length === 0) {
        console.log('Nothing to backfill.');
        return;
    }

    console.log(`Items to backfill: ${workItems.length}`);

    const client = getAzureDevOpsClient();
    const witApi = await client.getWorkItemTrackingApi();

    let processed = 0;

    for (const item of workItems) {
        try {
            const revisions = await witApi.getRevisions(item.azureId);
            let initialRemainingWork = 0;
            let lastRemainingWork = 0;
            let doneRemainingWork = 0;
            let foundInitial = false;
            let lastSeenRemaining = 0;

            for (const rev of revisions) {
                const remaining = rev.fields?.['Microsoft.VSTS.Scheduling.RemainingWork'];
                const state = (rev.fields?.['System.State'] || '').toString().toLowerCase();

                if (remaining !== undefined) {
                    lastRemainingWork = remaining;
                    lastSeenRemaining = remaining;
                }

                if (!foundInitial && remaining !== undefined && remaining > 0) {
                    initialRemainingWork = remaining;
                    foundInitial = true;
                }

                if (isDoneState(state) && doneRemainingWork === 0) {
                    doneRemainingWork = remaining !== undefined ? remaining : lastSeenRemaining;
                }
            }

            if (!foundInitial) {
                initialRemainingWork = (item.remainingWork || 0) + (item.completedWork || 0);
            }
            if (!lastRemainingWork) {
                lastRemainingWork = item.remainingWork || 0;
            }
            if (!doneRemainingWork && isDoneState(item.state)) {
                doneRemainingWork = (item.remainingWork || 0) > 0
                    ? (item.remainingWork || 0)
                    : (item.completedWork || 0);
            }

            await prisma.workItem.update({
                where: { id: item.id },
                data: {
                    initialRemainingWork,
                    lastRemainingWork,
                    doneRemainingWork
                }
            });

            processed++;
            if (processed % 50 === 0) {
                console.log(`Progress: ${processed}/${workItems.length}`);
            }
        } catch (err) {
            // ignore individual errors
        }
    }

    console.log(`Backfill completed. Updated ${processed} items.\n`);
}

function runSmartSync() {
    if (process.env.RUN_SMART_SYNC === 'false') {
        console.log('Skipping smart-sync.');
        return;
    }
    console.log('Running smart-sync...\n');
    const result = spawnSync('npx', ['tsx', 'scripts/sync/smart-sync.ts'], {
        stdio: 'inherit',
        cwd: process.cwd(),
        shell: true
    });
    if (result.status !== 0) {
        console.log('WARN: smart-sync finished with non-zero exit code.');
    }
}

async function main() {
    try {
        await syncTargets();
        await backfillHistoryForTargets();
        runSmartSync();
    } catch (error) {
        console.error('ERROR: Sync failed:', error.message || error);
    } finally {
        await prisma.$disconnect();
    }
}

function getAzureDevOpsClient() {
    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (!orgUrl || !pat) {
        throw new Error('Missing Azure DevOps credentials');
    }
    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    return new azdev.WebApi(orgUrl, authHandler);
}

main();
