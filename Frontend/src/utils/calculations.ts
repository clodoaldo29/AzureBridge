import type { Sprint, CapacityComparison, SprintSnapshot } from '@/types';

export const calculateSprintHealth = (
    sprint: Sprint,
    capacity?: CapacityComparison,
    burndown?: SprintSnapshot[]
): number => {
    let score = 100;

    // Factor 1: Capacity Utilization (30 points)
    if (capacity) {
        const utilization = capacity.summary.utilization;
        if (utilization < 60) score -= 15; // Underutilized
        else if (utilization > 100) score -= 20; // Overloaded
        else if (utilization > 90) score -= 10; // High utilization
    }

    // Factor 2: Progress vs Timeline (40 points)
    const daysTotal = Math.max(
        1,
        Math.ceil(
            (new Date(sprint.endDate).getTime() - new Date(sprint.startDate).getTime()) /
            (1000 * 60 * 60 * 24)
        )
    );
    const daysPassed = Math.max(
        0,
        Math.ceil((Date.now() - new Date(sprint.startDate).getTime()) / (1000 * 60 * 60 * 24))
    );
    const progressRatio = daysPassed / daysTotal;

    const completionRatio =
        sprint.totalPlannedHours && sprint.totalPlannedHours > 0
            ? (sprint.totalCompletedHours || 0) / sprint.totalPlannedHours
            : 0;

    const deviation = Math.abs(completionRatio - progressRatio);
    if (deviation > 0.3) score -= 30;
    else if (deviation > 0.2) score -= 20;
    else if (deviation > 0.1) score -= 10;

    // Factor 3: Blockers (20 points)
    if (burndown) {
        const latest = burndown[burndown.length - 1];
        if (latest && latest.blockedCount > 0) {
            score -= Math.min(20, latest.blockedCount * 5);
        }
    }

    // Factor 4: Velocity Stability (10 points)
    if (!sprint.isOnTrack) {
        score -= 10;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
};

export const getHealthStatus = (
    score: number
): { label: string; color: string; icon: string } => {
    if (score >= 80)
        return {
            label: 'Excelente',
            color: 'text-green-600 bg-green-50',
            icon: 'CheckCircle2',
        };
    if (score >= 60)
        return {
            label: 'Bom',
            color: 'text-blue-600 bg-blue-50',
            icon: 'Info',
        };
    if (score >= 40)
        return {
            label: 'Atenção',
            color: 'text-amber-600 bg-amber-50',
            icon: 'AlertTriangle',
        };
    return {
        label: 'Crítico',
        color: 'text-red-600 bg-red-50',
        icon: 'XCircle',
    };
};
