// ============================================
// TYPE DEFINITIONS
// ============================================

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
    description?: string;
    assignedToId?: string;
    assignedTo?: TeamMember;
    originalEstimate?: number;
    completedWork?: number;
    remainingWork?: number;
    storyPoints?: number;
    priority?: number;
    isBlocked: boolean;
    isDelayed: boolean;
    tags: string[];
    createdDate: string;
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
    idealRemaining?: number;
}

export interface MemberCapacity {
    member: {
        id: string;
        displayName: string;
        imageUrl?: string;
        uniqueName: string;
    };
    capacity: {
        total: number;
        available: number;
        daysOffCount: number;
    };
    planned: {
        total: number;
        itemsCount: number;
    };
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
