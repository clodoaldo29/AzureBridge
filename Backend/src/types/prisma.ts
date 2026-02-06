// Re-export dos tipos do Prisma para facilitar imports
export type {
    Project,
    TeamMember,
    TeamCapacity,
    Sprint,
    SprintSnapshot,
    WorkItem,
    WorkItemRevision,
    WorkItemComment,
    MetricSnapshot,
    Report,
    ReportTemplate,
    Alert,
    UserPreference,
    SyncLog,
} from '@prisma/client';

// Tipos auxiliares
import { Prisma } from '@prisma/client';

// Work Item com relações
export type WorkItemWithRelations = Prisma.WorkItemGetPayload<{
    include: {
        project: true;
        sprint: true;
        parent: true;
        children: true;
        assignedTo: true;
        revisions: true;
        comments: true;
    };
}>;

// Sprint com relações
export type SprintWithRelations = Prisma.SprintGetPayload<{
    include: {
        project: true;
        workItems: true;
        capacities: {
            include: {
                member: true;
            };
        };
        snapshots: true;
    };
}>;

// Project com relações
export type ProjectWithRelations = Prisma.ProjectGetPayload<{
    include: {
        sprints: true;
        workItems: true;
        teamMembers: true;
        reports: true;
        alerts: true;
    };
}>;
