export interface Project {
    id: string;
    azureId: string;
    name: string;
    description?: string;
    state: string;
    visibility: number;
    createdAt: string;
    updatedAt: string;
    lastSyncAt?: string;
}

export interface TeamMember {
    id: string;
    azureId: string;
    displayName: string;
    uniqueName: string;
    imageUrl?: string;
    role?: string;
    isActive: boolean;
}

export interface Sprint {
    id: string;
    azureId: string;
    name: string;
    path: string;
    projectId: string;
    startDate: string;
    endDate: string;
    state: 'Active' | 'Past' | 'Future';
    timeFrame: 'current' | 'past' | 'future';
    totalPlannedHours?: number;
    totalCompletedHours?: number;
    totalRemainingHours?: number;
    totalStoryPoints?: number;
    completedStoryPoints?: number;
    teamCapacityHours?: number;
    commitmentHours?: number;
    isOnTrack: boolean;
    riskLevel?: 'low' | 'medium' | 'high' | 'critical';
    createdAt: string;
    updatedAt: string;
    project?: Project;
}

export interface WorkItem {
    id: number;
    azureId: number;
    type: string;
    state: string;
    title: string;
    url?: string;
    description?: string;
    assignedToId?: string;
    assignedTo?: TeamMember;
    originalEstimate?: number;
    initialRemainingWork?: number;
    lastRemainingWork?: number;
    completedWork?: number;
    remainingWork?: number;
    storyPoints?: number;
    priority?: number;
    isBlocked: boolean;
    isDelayed: boolean;
    tags: string[];
    createdDate: string;
    activatedDate?: string;
    changedDate: string;
    closedDate?: string;
    projectId: string;
    sprintId?: string;
}

export interface SprintSnapshot {
    id: string;
    sprintId: string;
    snapshotDate: string;
    remainingWork: number;
    completedWork: number;
    totalWork: number;
    remainingPoints: number;
    completedPoints: number;
    totalPoints: number;
    todoCount: number;
    inProgressCount: number;
    doneCount: number;
    blockedCount: number;
    addedCount?: number;
    removedCount?: number;
    idealRemaining?: number;
}

export interface MemberCapacity {
    member: {
        id: string;
        displayName: string;
        imageUrl?: string;
        uniqueName: string;
    };
    capacity:
        | number
        | {
              total: number;
              available: number;
              daysOffCount: number;
          };
    planned:
        | number
        | {
              total: number;
              itemsCount: number;
          };
    completed?: number;
    completionPct?: number;
    remainingToCapacity?: number;
    overCapacity?: number;
    balance: number;
    utilization: number;
}

export interface CapacityComparison {
    sprint: {
        id: string;
        name: string;
        startDate: string;
        endDate: string;
    };
    summary: {
        totalAvailable: number;
        totalPlanned: number;
        totalPlannedInitial?: number;
        totalPlannedCurrent?: number;
        totalPlannedDelta?: number;
        totalRemaining: number;
        totalCompleted?: number;
        totalAddedScope: number;
        dayOffDates?: string[];
        totalMembers: number;
        unassigned: {
            totalHours: number;
            items: number;
        };
        balance: number;
        utilization: number;
    };
    byMember: MemberCapacity[];
}

export interface ApiResponse<T> {
    success: boolean;
    data: T;
    error?: string;
}

export interface ApiListResponse<T> extends ApiResponse<T[]> {
    meta?: {
        total: number;
        limit: number;
        offset: number;
    };
}

export interface Document {
    id: string;
    projectId?: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    uploadedBy: string;
    extractedText?: string;
    createdAt: string;
    updatedAt: string;
}

export interface WikiPage {
    id: string;
    projectId?: string;
    azureId?: number;
    path: string;
    title: string;
    content?: string;
    parentPath?: string;
    order: number;
    remoteUrl?: string;
    lastSyncAt?: string;
    createdAt: string;
    updatedAt: string;
}

export type RDAPeriodType = 'monthly' | 'general';
export type RDAGenerationStatus = 'processing' | 'completed' | 'failed' | 'cancelled';

export interface GenerateRDARequest {
    projectId: string;
    templateId?: string;
    periodType: RDAPeriodType;
    periodStart: string;
    periodEnd: string;
    documentIds: string[];
    wikiPageIds: string[];
    generatedBy: string;
}

export interface RDAGeneration {
    id: string;
    projectId: string;
    templateId: string;
    status: RDAGenerationStatus;
    progress: number;
    currentStep?: string;
    periodType: RDAPeriodType;
    periodStart: string;
    periodEnd: string;
    outputFilePath?: string;
    fileSize?: number;
    tokensUsed?: number;
    errorMessage?: string;
    partialResults?: Array<{
        agentName: string;
        success: boolean;
        durationMs?: number;
        tokensUsed?: number;
    }>;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
}

export interface RDATemplate {
    id: string;
    projectId?: string;
    name: string;
    description?: string;
    filePath: string;
    placeholders: string[];
    isActive: boolean;
    version?: number;
    createdAt?: string;
    updatedAt?: string;
}
