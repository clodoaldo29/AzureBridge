// ============================================
// TIPOS DO AZURE DEVOPS
// ============================================

export interface AzureDevOpsConfig {
    orgUrl: string;
    pat: string;
    project: string;
    team?: string;
}

export interface AzureWorkItem {
    id: number;
    rev: number;
    fields: {
        'System.Id': number;
        'System.WorkItemType': string;
        'System.State': string;
        'System.Reason'?: string;
        'System.Title': string;
        'System.Description'?: string;
        'System.AcceptanceCriteria'?: string;
        'Microsoft.VSTS.Common.AcceptanceCriteria'?: string;
        'Microsoft.VSTS.TCM.ReproSteps'?: string;
        'System.AssignedTo'?: AzureIdentity;
        'Microsoft.VSTS.Scheduling.OriginalEstimate'?: number;
        'Microsoft.VSTS.Scheduling.CompletedWork'?: number;
        'Microsoft.VSTS.Scheduling.RemainingWork'?: number;
        'Microsoft.VSTS.Scheduling.StoryPoints'?: number;
        'Microsoft.VSTS.Common.Priority'?: number;
        'Microsoft.VSTS.Common.Severity'?: string;
        'System.CreatedDate': string;
        'System.ChangedDate': string;
        'System.ClosedDate'?: string;
        'Microsoft.VSTS.Common.ClosedDate'?: string;
        'System.ResolvedDate'?: string;
        'Microsoft.VSTS.Common.ResolvedDate'?: string;
        'System.StateChangeDate'?: string;
        'Microsoft.VSTS.Common.ActivatedDate'?: string;
        'Microsoft.VSTS.Common.Blocked'?: string | boolean;
        'System.BoardColumn'?: string;
        'System.BoardColumnDone'?: boolean;
        'System.CreatedBy': AzureIdentity;
        'System.ChangedBy': AzureIdentity;
        'System.ClosedBy'?: AzureIdentity;
        'System.ResolvedBy'?: AzureIdentity;
        'System.Tags'?: string;
        'System.AreaPath': string;
        'System.IterationPath': string;
        'System.Parent'?: number;
        [key: string]: any;
    };
    url: string;
    _links?: any;
    relations?: AzureWorkItemRelation[];
    commentCount?: number;
}

export interface AzureIdentity {
    displayName: string;
    uniqueName: string;
    id?: string;
    imageUrl?: string;
}

export interface AzureWorkItemRelation {
    rel: string;
    url: string;
    attributes?: any;
}

export interface AzureSprint {
    id: string;
    name: string;
    path: string;
    attributes: {
        startDate?: string;
        finishDate?: string;
        timeFrame?: 'past' | 'current' | 'future';
    };
    url: string;
}

export interface AzureTeamMember {
    identity: AzureIdentity;
    isTeamAdmin?: boolean;
}

export interface AzureCapacity {
    teamMember: AzureIdentity;
    activities: Array<{
        capacityPerDay: number;
        name: string;
    }>;
    daysOff: Array<{
        start: string;
        end: string;
    }>;
}

export interface AzureProject {
    id: string;
    name: string;
    description?: string;
    url: string;
    state: string;
    visibility: string;
}

export interface AzureWorkItemUpdate {
    id: number;
    rev: number;
    revisedBy: AzureIdentity;
    revisedDate: string;
    fields?: {
        [key: string]: {
            oldValue?: any;
            newValue?: any;
        };
    };
}

export interface AzureWorkItemRevision {
    id: number;
    rev: number;
    fields?: Record<string, unknown>;
    revisedBy?: AzureIdentity;
}

export interface AzureComment {
    id: number;
    text: string;
    createdBy: AzureIdentity;
    createdDate: string;
    modifiedBy?: AzureIdentity;
    modifiedDate?: string;
}

// Opcoes de consulta
export interface WorkItemQueryOptions {
    ids?: number[];
    wiql?: string;
    fields?: string[];
    asOf?: Date;
    expand?: 'all' | 'relations' | 'none';
}

export interface SprintQueryOptions {
    timeFrame?: 'past' | 'current' | 'future';
}
