import { prisma } from '../../src/database/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';

const WORK_ITEM_TYPES = ['Product Backlog Item', 'Bug', 'Task', 'Feature'];
const BATCH_SIZE = Math.max(1, Number(process.env.ACTIVE_SPRINT_SYNC_BATCH_SIZE || 100));
const PERSIST_REVISIONS = ['true', '1', 'yes', 'sim', 'on']
    .includes(String(process.env.ACTIVE_SPRINT_SYNC_PERSIST_REVISIONS || 'true').trim().toLowerCase());

function normalizeRevisionChanges(fields: unknown): Record<string, unknown> {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
    return fields as Record<string, unknown>;
}

function isDoneState(state: string): boolean {
    const s = String(state || '').trim().toLowerCase();
    return s === 'done' || s === 'closed' || s === 'completed';
}

function toDate(value: unknown): Date | null {
    if (!value) return null;
    const dt = new Date(String(value));
    return Number.isNaN(dt.getTime()) ? null : dt;
}

async function resolveAssignedToMemberId(
    assignedRaw: unknown,
    projectId: string
): Promise<string | null> {
    if (!assignedRaw) return null;

    if (typeof assignedRaw === 'object') {
        const assigned = assignedRaw as Record<string, unknown>;
        const uniqueName = assigned.uniqueName ? String(assigned.uniqueName) : null;
        const displayName = assigned.displayName
            ? String(assigned.displayName)
            : (uniqueName || 'Unknown');
        const azureIdentityId = assigned.id
            ? String(assigned.id)
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
                    imageUrl: assigned.imageUrl ? String(assigned.imageUrl) : null,
                    projectId,
                    isActive: true
                },
                update: {
                    displayName,
                    uniqueName: uniqueName || displayName,
                    imageUrl: assigned.imageUrl ? String(assigned.imageUrl) : null,
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
                        ...(displayName ? [{ displayName }] : [])
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

async function persistRevisions(workItemId: number, revisions: any[]): Promise<number> {
    if (!Array.isArray(revisions) || revisions.length === 0) return 0;
    let persisted = 0;
    for (const rev of revisions) {
        if (typeof rev?.rev !== 'number') continue;
        const fields = normalizeRevisionChanges(rev.fields);
        const changedFields = Object.keys(fields);
        const revisedDateRaw = (fields['System.ChangedDate'] || fields['System.RevisedDate']) as string | undefined;
        const revisedDate = revisedDateRaw ? new Date(revisedDateRaw) : new Date();
        const revisedByObj = fields['System.ChangedBy'] as { displayName?: string; uniqueName?: string } | undefined;
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
                changes: fields as any,
                changedFields,
            },
            update: {
                revisedDate,
                revisedBy,
                changes: fields as any,
                changedFields,
            },
        });
        persisted++;
    }
    return persisted;
}

async function main() {
    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    if (!orgUrl || !pat) {
        throw new Error('Missing AZURE_DEVOPS_ORG_URL or AZURE_DEVOPS_PAT');
    }

    const activeSprints = await prisma.sprint.findMany({
        where: { state: { in: ['active', 'Active'] } },
        include: { project: { select: { name: true } } },
        orderBy: [{ project: { name: 'asc' } }, { startDate: 'asc' }]
    });

    if (!activeSprints.length) {
        console.log('[SYNC ACTIVE SPRINTS] No active sprints found.');
        return;
    }

    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const witApi = await connection.getWorkItemTrackingApi();

    console.log('[SYNC ACTIVE SPRINTS] Starting...');
    console.log(`[SYNC ACTIVE SPRINTS] Active sprints: ${activeSprints.length}`);
    console.log(`[SYNC ACTIVE SPRINTS] Persist revisions: ${PERSIST_REVISIONS ? 'yes' : 'no'}`);

    let totalUpserted = 0;
    let totalMarkedRemoved = 0;
    let totalRevisions = 0;

    for (const sprint of activeSprints) {
        console.log(`\n[SYNC ACTIVE SPRINTS] ${sprint.project.name} / ${sprint.name}`);
        const wiql = {
            query: `
                SELECT [System.Id]
                FROM WorkItems
                WHERE [System.IterationPath] = '${sprint.path.replace(/'/g, "''")}'
                AND [System.WorkItemType] IN (${WORK_ITEM_TYPES.map((t) => `'${t}'`).join(', ')})
                ORDER BY [System.Id]
            `
        };

        const queryResult = await witApi.queryByWiql(wiql, { project: sprint.project.name });
        const azureIds = (queryResult.workItems || [])
            .map((wi) => wi.id)
            .filter((id): id is number => typeof id === 'number');

        const azureIdSet = new Set<number>(azureIds);
        const localItems = await prisma.workItem.findMany({
            where: { sprintId: sprint.id },
            select: { id: true, azureId: true, isRemoved: true }
        });

        const toMarkRemoved = localItems
            .filter((w) => !w.isRemoved && !azureIdSet.has(w.azureId))
            .map((w) => w.id);

        if (toMarkRemoved.length) {
            const removedRes = await prisma.workItem.updateMany({
                where: { id: { in: toMarkRemoved } },
                data: { isRemoved: true, lastSyncAt: new Date() }
            });
            totalMarkedRemoved += removedRes.count;
        }

        if (!azureIds.length) {
            console.log('[SYNC ACTIVE SPRINTS] Azure returned 0 items for this sprint.');
            continue;
        }

        let sprintUpserts = 0;
        let sprintRevisions = 0;

        for (let i = 0; i < azureIds.length; i += BATCH_SIZE) {
            const batch = azureIds.slice(i, i + BATCH_SIZE);
            const details = await witApi.getWorkItems(batch);
            const existingRows = await prisma.workItem.findMany({
                where: { id: { in: batch } },
                select: {
                    id: true,
                    assignedToId: true,
                    initialRemainingWork: true,
                    lastRemainingWork: true,
                    doneRemainingWork: true,
                    completedWork: true,
                    closedDate: true,
                    resolvedDate: true,
                    stateChangeDate: true,
                    activatedDate: true
                }
            });
            const existingById = new Map(existingRows.map((row) => [row.id, row]));

            for (const wi of details) {
                if (!wi?.id || !wi.fields) continue;
                const id = wi.id;
                const f = wi.fields as Record<string, any>;
                const existing = existingById.get(id);

                const state = String(f['System.State'] || '');
                const done = isDoneState(state);
                const remainingWork = Number(f['Microsoft.VSTS.Scheduling.RemainingWork'] || 0);
                const completedWorkIncoming = Number(f['Microsoft.VSTS.Scheduling.CompletedWork'] || 0);
                const historicalFallback = Math.max(
                    Number(existing?.doneRemainingWork || 0),
                    Number(existing?.lastRemainingWork || 0),
                    Number(existing?.initialRemainingWork || 0),
                    Number(f['Microsoft.VSTS.Scheduling.OriginalEstimate'] || 0),
                    completedWorkIncoming
                );
                const lastRemainingWork = remainingWork > 0
                    ? remainingWork
                    : Math.max(Number(existing?.lastRemainingWork || 0), done ? historicalFallback : 0);
                const doneRemainingWork = done
                    ? (remainingWork > 0
                        ? remainingWork
                        : (completedWorkIncoming > 0 ? completedWorkIncoming : (historicalFallback > 0 ? historicalFallback : null)))
                    : (existing?.doneRemainingWork ?? null);
                const completedWork = completedWorkIncoming > 0
                    ? completedWorkIncoming
                    : (done ? Math.max(Number(existing?.completedWork || 0), Number(doneRemainingWork || 0)) : 0);
                const initialRemainingWork = Number(existing?.initialRemainingWork || 0) > 0
                    ? Number(existing?.initialRemainingWork || 0)
                    : (remainingWork > 0 ? remainingWork : Number(f['Microsoft.VSTS.Scheduling.OriginalEstimate'] || 0));
                const assignedToId = await resolveAssignedToMemberId(f['System.AssignedTo'], sprint.projectId);

                await prisma.workItem.upsert({
                    where: { id },
                    create: {
                        id,
                        azureId: id,
                        type: String(f['System.WorkItemType'] || 'Task'),
                        state: state || 'To Do',
                        reason: f['System.Reason'] ? String(f['System.Reason']) : null,
                        title: String(f['System.Title'] || `Work Item #${id}`),
                        description: f['System.Description'] ? String(f['System.Description']) : null,
                        acceptanceCriteria: f['Microsoft.VSTS.Common.AcceptanceCriteria']
                            ? String(f['Microsoft.VSTS.Common.AcceptanceCriteria'])
                            : null,
                        reproSteps: f['Microsoft.VSTS.TCM.ReproSteps'] ? String(f['Microsoft.VSTS.TCM.ReproSteps']) : null,
                        originalEstimate: Number(f['Microsoft.VSTS.Scheduling.OriginalEstimate'] || 0),
                        completedWork,
                        remainingWork,
                        initialRemainingWork,
                        lastRemainingWork,
                        doneRemainingWork,
                        storyPoints: Number(f['Microsoft.VSTS.Scheduling.StoryPoints'] || 0) || null,
                        effort: Number(f['Microsoft.VSTS.Scheduling.Effort'] || 0) || null,
                        priority: Number(f['Microsoft.VSTS.Common.Priority'] || 3) || 3,
                        severity: f['Microsoft.VSTS.Common.Severity'] ? String(f['Microsoft.VSTS.Common.Severity']) : null,
                        createdDate: toDate(f['System.CreatedDate']) || new Date(),
                        changedDate: toDate(f['System.ChangedDate']) || new Date(),
                        closedDate: toDate(f['System.ClosedDate']) || toDate(f['Microsoft.VSTS.Common.ClosedDate']),
                        resolvedDate: toDate(f['System.ResolvedDate']) || toDate(f['Microsoft.VSTS.Common.ResolvedDate']),
                        stateChangeDate: toDate(f['System.StateChangeDate']),
                        activatedDate: toDate(f['Microsoft.VSTS.Common.ActivatedDate']),
                        createdBy: f['System.CreatedBy']?.displayName || f['System.CreatedBy']?.uniqueName || 'Unknown',
                        changedBy: f['System.ChangedBy']?.displayName || f['System.ChangedBy']?.uniqueName || 'Unknown',
                        closedBy: f['System.ClosedBy']?.displayName || null,
                        resolvedBy: f['System.ResolvedBy']?.displayName || null,
                        isBlocked: false,
                        isRemoved: false,
                        tags: f['System.Tags']
                            ? String(f['System.Tags']).split(';').map((t: string) => t.trim()).filter(Boolean)
                            : [],
                        areaPath: String(f['System.AreaPath'] || sprint.project.name),
                        iterationPath: String(f['System.IterationPath'] || sprint.path),
                        url: String(wi.url || ''),
                        rev: Number(wi.rev || 1),
                        commentCount: Number(wi.commentCount || 0),
                        projectId: sprint.projectId,
                        sprintId: sprint.id,
                        assignedToId,
                        lastSyncAt: new Date()
                    },
                    update: {
                        type: String(f['System.WorkItemType'] || 'Task'),
                        state: state || 'To Do',
                        reason: f['System.Reason'] ? String(f['System.Reason']) : null,
                        title: String(f['System.Title'] || `Work Item #${id}`),
                        description: f['System.Description'] ? String(f['System.Description']) : null,
                        acceptanceCriteria: f['Microsoft.VSTS.Common.AcceptanceCriteria']
                            ? String(f['Microsoft.VSTS.Common.AcceptanceCriteria'])
                            : null,
                        reproSteps: f['Microsoft.VSTS.TCM.ReproSteps'] ? String(f['Microsoft.VSTS.TCM.ReproSteps']) : null,
                        originalEstimate: Number(f['Microsoft.VSTS.Scheduling.OriginalEstimate'] || 0),
                        completedWork,
                        remainingWork,
                        initialRemainingWork,
                        lastRemainingWork,
                        doneRemainingWork,
                        storyPoints: Number(f['Microsoft.VSTS.Scheduling.StoryPoints'] || 0) || null,
                        effort: Number(f['Microsoft.VSTS.Scheduling.Effort'] || 0) || null,
                        priority: Number(f['Microsoft.VSTS.Common.Priority'] || 3) || 3,
                        severity: f['Microsoft.VSTS.Common.Severity'] ? String(f['Microsoft.VSTS.Common.Severity']) : null,
                        changedDate: toDate(f['System.ChangedDate']) || new Date(),
                        closedDate: toDate(f['System.ClosedDate']) || toDate(f['Microsoft.VSTS.Common.ClosedDate']) || existing?.closedDate || null,
                        resolvedDate: toDate(f['System.ResolvedDate']) || toDate(f['Microsoft.VSTS.Common.ResolvedDate']) || existing?.resolvedDate || null,
                        stateChangeDate: toDate(f['System.StateChangeDate']) || existing?.stateChangeDate || null,
                        activatedDate: toDate(f['Microsoft.VSTS.Common.ActivatedDate']) || existing?.activatedDate || null,
                        changedBy: f['System.ChangedBy']?.displayName || f['System.ChangedBy']?.uniqueName || 'Unknown',
                        closedBy: f['System.ClosedBy']?.displayName || null,
                        resolvedBy: f['System.ResolvedBy']?.displayName || null,
                        isRemoved: false,
                        tags: f['System.Tags']
                            ? String(f['System.Tags']).split(';').map((t: string) => t.trim()).filter(Boolean)
                            : [],
                        areaPath: String(f['System.AreaPath'] || sprint.project.name),
                        iterationPath: String(f['System.IterationPath'] || sprint.path),
                        url: String(wi.url || ''),
                        rev: Number(wi.rev || 1),
                        commentCount: Number(wi.commentCount || 0),
                        projectId: sprint.projectId,
                        sprintId: sprint.id,
                        assignedToId,
                        lastSyncAt: new Date()
                    }
                });

                sprintUpserts++;

                if (PERSIST_REVISIONS) {
                    try {
                        const revisions = await witApi.getRevisions(id);
                        sprintRevisions += await persistRevisions(id, revisions as any[]);
                    } catch (error) {
                        console.log(`[SYNC ACTIVE SPRINTS] WARN revisions item ${id}: ${error instanceof Error ? error.message : String(error)}`);
                    }
                }
            }
        }

        totalUpserted += sprintUpserts;
        totalRevisions += sprintRevisions;
        console.log(
            `[SYNC ACTIVE SPRINTS] Azure=${azureIds.length} | Upserted=${sprintUpserts} | MarkedRemoved=${toMarkRemoved.length} | Revisions=${sprintRevisions}`
        );
    }

    console.log('\n[SYNC ACTIVE SPRINTS] DONE', {
        activeSprints: activeSprints.length,
        totalUpserted,
        totalMarkedRemoved,
        totalRevisions
    });
}

main()
    .catch((error) => {
        console.error('[SYNC ACTIVE SPRINTS] Failed:', error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
