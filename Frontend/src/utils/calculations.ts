import type { Sprint, CapacityComparison, SprintSnapshot } from '@/types';

export const calculateSprintHealth = (
    sprint: Sprint,
    capacity?: CapacityComparison,
    burndown?: SprintSnapshot[]
): number => {
    return calculateSprintHealthDetails(sprint, capacity, burndown).score;
};

export const calculateSprintHealthDetails = (
    sprint: Sprint,
    capacity?: CapacityComparison,
    burndown?: SprintSnapshot[]
): {
    score: number;
    penalties: string[];
    utilization: number;
    progressRatio: number;
    completionRatio: number;
} => {
    let score = 100;
    const penalties: string[] = [];

    // Factor 1: Capacity Utilization (30 points)
    const utilization = capacity ? capacity.summary.utilization : 0;
    if (capacity) {
        if (utilization < 60) {
            score -= 15; // Underutilized
            penalties.push('Capacidade baixa (<60%): -15');
        } else if (utilization > 100) {
            score -= 20; // Overloaded
            penalties.push('Capacidade sobrecarregada (>100%): -20');
        } else if (utilization > 90) {
            score -= 10; // High utilization
            penalties.push('Capacidade alta (>90%): -10');
        }
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

    const plannedHours = capacity?.summary.totalPlannedCurrent ?? capacity?.summary.totalPlanned ?? sprint.totalPlannedHours ?? 0;
    const completedHours = capacity?.summary.totalCompleted ?? sprint.totalCompletedHours ?? 0;
    const completionRatio =
        plannedHours > 0
            ? completedHours / plannedHours
            : 0;

    const deviation = Math.abs(completionRatio - progressRatio);
    if (deviation > 0.3) {
        score -= 30;
        penalties.push('Progresso x tempo (desvio > 0.3): -30');
    } else if (deviation > 0.2) {
        score -= 20;
        penalties.push('Progresso x tempo (desvio > 0.2): -20');
    } else if (deviation > 0.1) {
        score -= 10;
        penalties.push('Progresso x tempo (desvio > 0.1): -10');
    }

    // Factor 3: Blockers (20 points)
    if (burndown) {
        const latest = burndown[burndown.length - 1];
        if (latest && latest.blockedCount > 0) {
            const p = Math.min(20, latest.blockedCount * 5);
            score -= p;
            penalties.push(`Blockers (${latest.blockedCount}): -${p}`);
        }
    }

    // Factor 4: Velocity Stability (10 points)
    if (!sprint.isOnTrack) {
        score -= 10;
        penalties.push('Sprint fora do tracking: -10');
    }

    return {
        score: Math.max(0, Math.min(100, Math.round(score))),
        penalties,
        utilization,
        progressRatio,
        completionRatio
    };
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
