import { useSprints } from '@/services/queries/sprints';
import { useCapacityComparison } from '@/services/queries/capacity';
import { useBlockedWorkItems, useWorkItems } from '@/services/queries/workItems';
import { useSprintBurndown } from '@/services/queries/sprints';
import { StatCard } from '@/components/dashboard/StatCard';
import { SprintHealthCard } from '@/components/dashboard/SprintHealthCard';
import { CapacityTable } from '@/components/dashboard/CapacityTable';
import { MemberCapacityProgress } from '@/components/dashboard/MemberCapacityProgress';
import { WorkItemAgingCard } from '../components/WorkItemAgingCard';
import { BurndownChart } from '@/components/charts/BurndownChart';
import { CumulativeFlowChart } from '../charts/CumulativeFlowChart';
import { WorkItemsByStateChart } from '../charts/WorkItemsByStateChart';
import { WorkItemsByTypeChart } from '../charts/WorkItemsByTypeChart';
import { WorkItemsByMemberChart } from '../charts/WorkItemsByMemberChart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Target, Users, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { calculateSprintHealthDetails } from '@/utils/calculations';
import { useAppStore } from '@/stores/appStore';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Project, Sprint } from '@/types';
import { useEffect, useMemo } from 'react';

function toUtcDayMs(value: string | Date): number {
    const d = new Date(value);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function toIsoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

function getIdealRemainingToday(params: {
    snapshots: Array<{ snapshotDate: string; totalWork: number; idealRemaining?: number | null }>;
    sprintStartDate?: string;
    sprintEndDate?: string;
    plannedInitial: number;
    plannedCurrent: number;
    dayOffDates: string[];
}): number {
    const { snapshots, sprintStartDate, sprintEndDate, plannedInitial, plannedCurrent, dayOffDates } = params;
    if (!snapshots.length || !sprintStartDate || !sprintEndDate) return plannedCurrent;

    const sorted = [...snapshots].sort((a, b) => toUtcDayMs(a.snapshotDate) - toUtcDayMs(b.snapshotDate));
    const snapshotByDay = new Map<number, { totalWork: number }>();
    sorted.forEach((s) => snapshotByDay.set(toUtcDayMs(s.snapshotDate), { totalWork: Number(s.totalWork || 0) }));

    const offSet = new Set(dayOffDates);
    const startMs = toUtcDayMs(sprintStartDate);
    const endMs = toUtcDayMs(sprintEndDate);

    const businessDays: number[] = [];
    for (let ms = startMs; ms <= endMs; ms += 24 * 60 * 60 * 1000) {
        const d = new Date(ms);
        const wd = d.getUTCDay();
        if (wd === 0 || wd === 6) continue;
        if (offSet.has(toIsoDate(ms))) continue;
        businessDays.push(ms);
    }
    if (!businessDays.length) return plannedCurrent;

    const totalWorkSeries: number[] = businessDays.map((ms) => {
        const exact = snapshotByDay.get(ms);
        if (exact) return Math.round(exact.totalWork);

        for (let i = sorted.length - 1; i >= 0; i--) {
            const snapMs = toUtcDayMs(sorted[i].snapshotDate);
            if (snapMs <= ms) return Math.round(Number(sorted[i].totalWork || 0));
        }
        return 0;
    });

    const baseInitial = Math.max(
        0,
        Math.round(plannedInitial || sorted[0]?.totalWork || totalWorkSeries[0] || plannedCurrent || 0)
    );

    const idealSeries: number[] = new Array(businessDays.length).fill(0);
    idealSeries[0] = baseInitial;
    let idealCursor = baseInitial;

    for (let i = 1; i < businessDays.length; i++) {
        const scopeAdded = Math.max(0, Math.round(totalWorkSeries[i] - totalWorkSeries[i - 1]));
        idealCursor += scopeAdded;
        const stepsRemaining = businessDays.length - i;
        const burnStep = stepsRemaining > 0 ? idealCursor / stepsRemaining : idealCursor;
        idealCursor = Math.max(0, idealCursor - burnStep);
        idealSeries[i] = Math.round(idealCursor);
    }

    const todayMs = toUtcDayMs(new Date());
    let todayIdx = -1;
    for (let i = businessDays.length - 1; i >= 0; i--) {
        if (businessDays[i] <= todayMs) {
            todayIdx = i;
            break;
        }
    }

    if (todayIdx < 0) return baseInitial;
    return Math.max(0, idealSeries[todayIdx] ?? baseInitial);
}

export function Dashboard() {
    const { selectedProjectId, setSelectedProjectId } = useAppStore();

    // Fetch all projects to get project name
    const { data: projectsResponse } = useQuery<{ data: Project[] }>({
        queryKey: ['projects'],
        queryFn: async () => {
            const response = await api.get('/projects');
            return response.data;
        },
    });
    const projects = projectsResponse?.data || [];

    // Fetch current sprints (Active)
    const {
        data: sprints,
        isLoading: sprintsLoading,
        isError: sprintsError,
    } = useSprints({ state: 'Active' });

    const activeProjectIds = useMemo(
        () => new Set((sprints || []).map((sprint: Sprint) => sprint.projectId)),
        [sprints]
    );
    const activeProjects = useMemo(
        () => projects.filter((project) => activeProjectIds.has(project.id)),
        [projects, activeProjectIds]
    );
    const selectedProject = activeProjects.find((p) => p.id === selectedProjectId);

    useEffect(() => {
        if (!activeProjects.length) {
            if (selectedProjectId) setSelectedProjectId('');
            return;
        }

        const hasValidSelection = activeProjects.some((p) => p.id === selectedProjectId);
        if (!hasValidSelection) {
            setSelectedProjectId(activeProjects[0].id);
        }
    }, [activeProjects, selectedProjectId, setSelectedProjectId]);

    // Filter sprints by selected project ID (more reliable than path comparison)
    const currentSprint = selectedProject
        ? sprints?.find((sprint: Sprint) => sprint.projectId === selectedProject.id)
        : sprints?.[0];

    // Fetch capacity data for current sprint
    const {
        data: capacityData,
        isLoading: capacityLoading,
        isError: capacityError,
    } = useCapacityComparison(currentSprint?.id || '');

    // Fetch burndown data
    const { data: burndownData } = useSprintBurndown(currentSprint?.id || '');

    // Fetch blocked work items
    const { data: blockedItems } = useBlockedWorkItems();

    // Fetch all work items for the current sprint (donuts)
    const { data: workItemsResponse } = useWorkItems(
        currentSprint ? { sprintId: currentSprint.id, limit: 500 } : undefined
    );
    const sprintWorkItems = workItemsResponse?.data || [];

    // Calculate sprint health score
    const healthDetails = currentSprint
        ? calculateSprintHealthDetails(currentSprint, capacityData, burndownData?.raw)
        : null;
    const healthScore = healthDetails ? healthDetails.score : null;

    if (sprintsLoading || capacityLoading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-muted-foreground">Carregando...</div>
            </div>
        );
    }

    if ((sprintsError || capacityError) && !sprints?.length && !capacityData) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center text-muted-foreground">
                    <div className="text-lg font-semibold">Não foi possível carregar os dados.</div>
                    <p className="mt-2 text-sm">
                        Verifique sua conexão com a API e tente novamente.
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-4 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
                    >
                        Tentar novamente
                    </button>
                </div>
            </div>
        );
    }

    const formatSprintDate = (date: string) =>
        new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

    const burndownRaw = burndownData?.raw || [];
    const sortedBurndown = [...burndownRaw].sort(
        (a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime()
    );
    const firstSnapshot = sortedBurndown[0];
    const lastSnapshot = sortedBurndown[sortedBurndown.length - 1];

    const dayOneNetScope = Math.round(
        Number(firstSnapshot?.addedCount || 0) - Number(firstSnapshot?.removedCount || 0)
    );
    const burndownInitial = Math.max(0, Math.round(Number(firstSnapshot?.totalWork || 0) - dayOneNetScope));
    const burndownCurrent = Math.max(0, Math.round(Number(lastSnapshot?.totalWork || 0)));
    const burndownDelta = burndownCurrent - burndownInitial;
    const burndownRemaining = Math.max(0, Math.round(Number(lastSnapshot?.remainingWork || 0)));
    const burndownCompleted = Math.max(0, Math.round(Number(lastSnapshot?.completedWork || 0)));

    const plannedInitial = sortedBurndown.length
        ? burndownInitial
        : (capacityData?.summary.totalPlannedInitial ?? 0);
    const plannedCurrent = sortedBurndown.length
        ? burndownCurrent
        : (capacityData?.summary.totalPlannedCurrent ?? capacityData?.summary.totalPlanned ?? 0);
    const plannedDelta = sortedBurndown.length
        ? burndownDelta
        : (capacityData?.summary.totalPlannedDelta ?? (plannedCurrent - plannedInitial));
    const remainingHours = sortedBurndown.length
        ? burndownRemaining
        : (capacityData?.summary.totalRemaining ?? 0);
    const completedHours = sortedBurndown.length
        ? burndownCompleted
        : Math.max(0, plannedCurrent - remainingHours);
    const progressPct = plannedCurrent > 0 ? Math.min(100, Math.max(0, (completedHours / plannedCurrent) * 100)) : 0;

    const idealRemainingToday = getIdealRemainingToday({
        snapshots: burndownData?.raw || [],
        sprintStartDate: currentSprint?.startDate,
        sprintEndDate: currentSprint?.endDate,
        plannedInitial,
        plannedCurrent,
        dayOffDates: capacityData?.summary.dayOffDates || [],
    });
    const idealCompletedToday = Math.max(0, plannedCurrent - idealRemainingToday);
    const idealPctToday = plannedCurrent > 0
        ? Math.min(100, Math.max(0, (idealCompletedToday / plannedCurrent) * 100))
        : 0;

    const deviationHours = Math.round(remainingHours - idealRemainingToday);
    const deviationPct = plannedCurrent > 0 ? (deviationHours / plannedCurrent) * 100 : 0;

    let progressStatusLabel = 'No Prazo';
    let progressStatusClass = 'bg-blue-50 text-blue-700 border-blue-200';
    if (deviationPct <= -5) {
        progressStatusLabel = 'Adiantado';
        progressStatusClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    } else if (deviationPct > 5 && deviationPct <= 15) {
        progressStatusLabel = 'Em Risco';
        progressStatusClass = 'bg-amber-50 text-amber-700 border-amber-200';
    } else if (deviationPct > 15) {
        progressStatusLabel = 'Atrasado';
        progressStatusClass = 'bg-red-50 text-red-700 border-red-200';
    }

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">
                        {currentSprint ? currentSprint.name : 'Dashboard'}
                    </h1>
                    {currentSprint ? (
                        <p className="text-muted-foreground text-sm mt-1">
                            {formatSprintDate(currentSprint.startDate)} - {formatSprintDate(currentSprint.endDate)}
                        </p>
                    ) : (
                        <p className="text-muted-foreground text-sm mt-1">
                            Selecione um projeto com sprint ativa para visualizar os indicadores.
                        </p>
                    )}
                </div>
                <Select
                    value={selectedProjectId || ''}
                    onValueChange={(value: string) => setSelectedProjectId(value)}
                >
                    <SelectTrigger className="w-[280px]">
                        <SelectValue placeholder="Selecione um projeto..." />
                    </SelectTrigger>
                    <SelectContent>
                        {activeProjects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                                {project.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {currentSprint ? (
                <>
                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                        <StatCard
                            title="Capacidade Total"
                            value={`${capacityData?.summary.totalAvailable || 0}h`}
                            icon={Users}
                        />
                        <StatCard
                            title="Planejamento"
                            value={`${plannedCurrent}h`}
                            icon={Target}
                            description={
                                <span className="text-muted-foreground text-xs">
                                    Inicial: {plannedInitial}h | Final: {plannedCurrent}h | Delta {plannedDelta >= 0 ? '+' : ''}{plannedDelta}h
                                </span>
                            }
                        />
                        <StatCard title="Restante" value={`${remainingHours}h`} icon={Clock} />
                        <StatCard
                            title="Concluído"
                            value={`${completedHours}h`}
                            icon={CheckCircle2}
                        />
                        <StatCard
                            title="Impedimentos"
                            value={`${blockedItems?.length || 0}`}
                            icon={AlertTriangle}
                        />
                    </div>

                    {/* Sprint Progress Bar based on Planned vs Remaining */}
                    {capacityData && plannedCurrent > 0 && (
                        <div className="bg-card rounded-lg shadow p-4 border border-border">
                            <div className="flex justify-between items-start gap-3 mb-3">
                                <div>
                                    <div className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                        Progresso da Sprint (Baseado em Horas)
                                        {plannedDelta > 0 && (
                                            <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50">
                                                Escopo +{plannedDelta}h
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                        Ideal hoje: {idealCompletedToday}h ({idealPctToday.toFixed(0)}%)
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className={progressStatusClass}>
                                        {progressStatusLabel}
                                    </Badge>
                                    <span className="text-lg font-bold text-foreground">
                                        {Math.round(progressPct)}%
                                    </span>
                                </div>
                            </div>
                            <div className="relative w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                                <div
                                    className={`h-3 rounded-full transition-all duration-500 ${remainingHours > plannedCurrent
                                        ? 'bg-red-500' // Red if over planned
                                        : 'bg-blue-600'
                                        }`}
                                    style={{ width: `${progressPct}%` }}
                                ></div>
                                <div
                                    className="absolute top-0 h-3 w-0.5 bg-slate-700/70"
                                    style={{ left: `${idealPctToday}%` }}
                                    title={`Ideal do dia: ${idealPctToday.toFixed(0)}%`}
                                />
                            </div>
                            <div className="flex flex-wrap justify-between items-start gap-2 mt-2">
                                <p className="text-xs text-muted-foreground font-medium">
                                    {completedHours}h concluídas de {plannedCurrent}h planejadas
                                </p>
                                <p className={`text-xs font-medium ${deviationHours > 0 ? 'text-red-600' : deviationHours < 0 ? 'text-emerald-600' : 'text-blue-600'}`}>
                                    {deviationHours > 0 ? '+' : ''}{deviationHours}h vs ideal de hoje
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Sprint Health + Work Item Aging */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {healthScore !== null && (
                            <SprintHealthCard
                                score={healthScore}
                                reasons={healthDetails?.penalties}
                            />
                        )}
                        <WorkItemAgingCard
                            workItems={sprintWorkItems}
                            capacityData={capacityData}
                            sprintStartDate={currentSprint.startDate}
                            sprintEndDate={currentSprint.endDate}
                            dayOffDates={capacityData?.summary.dayOffDates || []}
                            projectName={selectedProject?.name}
                        />
                    </div>

                    {/* Work Items Distribution Donuts */}
                    {sprintWorkItems.length > 0 && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <WorkItemsByStateChart workItems={sprintWorkItems} />
                            <WorkItemsByTypeChart workItems={sprintWorkItems} />
                            <WorkItemsByMemberChart workItems={sprintWorkItems} />
                        </div>
                    )}

                    {/* Main Content */}
                    <div className="space-y-6">
                        {/* Capacity Table */}
                        {capacityData && <CapacityTable data={capacityData} plannedCurrent={plannedCurrent} />}
                        {capacityData && <MemberCapacityProgress data={capacityData} />}

                        {/* Cumulative Flow Diagram */}
                        {burndownData && (
                            <div className="pt-2">
                                <CumulativeFlowChart
                                    data={burndownData.raw}
                                    sprintStartDate={currentSprint.startDate}
                                    sprintEndDate={currentSprint.endDate}
                                    dayOffDates={capacityData?.summary.dayOffDates || []}
                                />
                            </div>
                        )}

                        {/* Burndown Chart */}
                        {burndownData && (
                            <div className="pt-2">
                                <BurndownChart
                                    data={burndownData.raw}
                                    plannedInitial={plannedInitial}
                                    plannedCurrent={plannedCurrent}
                                    plannedDelta={plannedDelta}
                                    currentRemaining={remainingHours}
                                    sprintStartDate={currentSprint.startDate}
                                    sprintEndDate={currentSprint.endDate}
                                    dayOffDates={capacityData?.summary.dayOffDates || []}
                                />
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-card py-16 text-muted-foreground">
                    Nenhuma sprint ativa encontrada no momento.
                </div>
            )}
        </div>
    );
}


