import { useSprints } from '@/services/queries/sprints';
import { useCapacityComparison } from '@/services/queries/capacity';
import { useBlockedWorkItems, useWorkItems } from '@/services/queries/workItems';
import { useSprintBurndown } from '@/services/queries/sprints';
import { StatCard } from '@/components/dashboard/StatCard';
import { SprintHealthCard } from '@/components/dashboard/SprintHealthCard';
import { BlockedItemsCard } from '../components/BlockedItemsCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Target, Users, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { calculateSprintHealthDetails } from '@/utils/calculations';
import { useAppStore } from '@/stores/appStore';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Project, Sprint } from '@/types';
import { Suspense, lazy, useEffect, useMemo } from 'react';

const CapacityTable = lazy(() => import('@/components/dashboard/CapacityTable').then((module) => ({ default: module.CapacityTable })));
const MemberCapacityProgress = lazy(() => import('@/components/dashboard/MemberCapacityProgress').then((module) => ({ default: module.MemberCapacityProgress })));
const WorkItemAgingCard = lazy(() => import('../components/WorkItemAgingCard').then((module) => ({ default: module.WorkItemAgingCard })));
const BurndownChart = lazy(() => import('@/components/charts/BurndownChart').then((module) => ({ default: module.BurndownChart })));
const CumulativeFlowChart = lazy(() => import('../charts/CumulativeFlowChart').then((module) => ({ default: module.CumulativeFlowChart })));
const WorkItemsByStateChart = lazy(() => import('../charts/WorkItemsByStateChart').then((module) => ({ default: module.WorkItemsByStateChart })));
const WorkItemsByTypeChart = lazy(() => import('../charts/WorkItemsByTypeChart').then((module) => ({ default: module.WorkItemsByTypeChart })));
const WorkItemsByMemberChart = lazy(() => import('../charts/WorkItemsByMemberChart').then((module) => ({ default: module.WorkItemsByMemberChart })));

function toUtcDayMs(value: string | Date): number {
    const d = new Date(value);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function toIsoDate(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
}

function getIdealRemainingToday(params: {
    snapshots: Array<{
        snapshotDate: string;
        totalWork: number;
        idealRemaining?: number | null;
        addedCount?: number;
        removedCount?: number;
    }>;
    sprintStartDate?: string;
    sprintEndDate?: string;
    plannedInitialD1Date?: string | null;
    plannedInitial: number;
    plannedCurrent: number;
    dayOffDates: string[];
}): number {
    const { snapshots, sprintStartDate, sprintEndDate, plannedInitialD1Date, plannedInitial, plannedCurrent, dayOffDates } = params;
    if (!snapshots.length || !sprintStartDate || !sprintEndDate) return plannedCurrent;

    const sorted = [...snapshots].sort((a, b) => toUtcDayMs(a.snapshotDate) - toUtcDayMs(b.snapshotDate));
    const snapshotByDay = new Map<number, { totalWork: number; addedCount: number; removedCount: number }>();
    sorted.forEach((s) =>
        snapshotByDay.set(toUtcDayMs(s.snapshotDate), {
            totalWork: Number(s.totalWork || 0),
            addedCount: Number(s.addedCount || 0),
            removedCount: Number(s.removedCount || 0),
        })
    );

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
    const d1Ms = plannedInitialD1Date ? toUtcDayMs(plannedInitialD1Date) : businessDays[0];
    let d1Idx = businessDays.findIndex((ms) => ms === d1Ms);
    if (d1Idx < 0) {
        d1Idx = businessDays.findIndex((ms) => ms >= d1Ms);
    }
    if (d1Idx < 0) d1Idx = 0;

    for (let i = 0; i <= d1Idx && i < businessDays.length; i++) {
        idealSeries[i] = baseInitial;
    }
    const d1Scope = snapshotByDay.get(businessDays[d1Idx]);
    const d1NetScope = Math.round(Number(d1Scope?.addedCount || 0) - Number(d1Scope?.removedCount || 0));
    let idealCursor = Math.max(0, baseInitial + d1NetScope);

    for (let i = d1Idx + 1; i < businessDays.length; i++) {
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

function SectionLoader({ label, minHeight = 'min-h-[280px]' }: { label: string; minHeight?: string }) {
    return (
        <div className={`flex items-center justify-center rounded-lg border border-border bg-card text-muted-foreground ${minHeight}`}>
            {label}
        </div>
    );
}

function SkeletonBlock({ className }: { className: string }) {
    return <div className={`animate-pulse rounded-md bg-muted/70 ${className}`} />;
}

function DashboardSkeleton({
    sprintName,
    sprintDates,
    projectName,
}: {
    sprintName?: string;
    sprintDates?: string;
    projectName?: string;
}) {
    return (
        <div className="p-8 max-w-[1600px] mx-auto animate-in fade-in-0 duration-200">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-2">
                    <div className="text-4xl font-bold tracking-tight text-foreground">
                        {sprintName || 'Carregando sprint ativa...'}
                    </div>
                    <div className="text-muted-foreground">
                        {sprintDates || 'Aguardando dados da sprint'}
                    </div>
                </div>

                <div className="w-full xl:w-auto">
                    <div className="w-full xl:w-[340px] rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                        {projectName || 'Selecionando projeto...'}
                    </div>
                </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
                {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                        <SkeletonBlock className="h-4 w-24" />
                        <SkeletonBlock className="mt-8 h-10 w-24" />
                        <SkeletonBlock className="mt-4 h-3 w-32" />
                    </div>
                ))}
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
                <SkeletonBlock className="h-5 w-56" />
                <SkeletonBlock className="mt-4 h-3 w-36" />
                <SkeletonBlock className="mt-6 h-4 w-full rounded-full" />
                <div className="mt-4 flex items-center justify-between gap-4">
                    <SkeletonBlock className="h-3 w-40" />
                    <SkeletonBlock className="h-6 w-24" />
                </div>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_1fr]">
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                    <SkeletonBlock className="h-7 w-52" />
                    <SkeletonBlock className="mt-8 h-12 w-20" />
                    <SkeletonBlock className="mt-6 h-4 w-full" />
                    <SkeletonBlock className="mt-6 h-4 w-40" />
                    <SkeletonBlock className="mt-3 h-3 w-64" />
                </div>
                <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                    <SkeletonBlock className="h-7 w-44" />
                    <div className="mt-8 grid gap-4 md:grid-cols-3">
                        {Array.from({ length: 3 }).map((_, index) => (
                            <div key={index} className="rounded-xl border border-border p-4">
                                <SkeletonBlock className="h-4 w-20" />
                                <SkeletonBlock className="mt-6 h-10 w-10" />
                                <SkeletonBlock className="mt-4 h-9 w-24" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                    <div key={index} className="rounded-2xl border border-border bg-card p-6 shadow-sm">
                        <SkeletonBlock className="h-6 w-44" />
                        <SkeletonBlock className="mt-6 h-56 w-full" />
                    </div>
                ))}
            </div>
        </div>
    );
}

export function Dashboard() {
    const { selectedProjectId, setSelectedProjectId } = useAppStore();

    // Busca todos os projetos para obter o nome do projeto selecionado
    const { data: projectsResponse } = useQuery<{ data: Project[] }>({
        queryKey: ['projects'],
        queryFn: async () => {
            const response = await api.get('/projects');
            return response.data;
        },
    });
    const projects = projectsResponse?.data || [];

    // Busca as sprints ativas
    const {
        data: sprints,
        isLoading: sprintsLoading,
        isError: sprintsError,
    } = useSprints({ state: 'Active', includeDetails: false });

    const activeProjectIds = useMemo(
        () => new Set((sprints || []).map((sprint: Sprint) => sprint.projectId)),
        [sprints]
    );
    const activeProjects = useMemo(
        () => projects.filter((project) => activeProjectIds.has(project.id)),
        [projects, activeProjectIds]
    );
    const effectiveSelectedProjectId = useMemo(() => {
        if (!activeProjects.length) return '';
        const hasValidSelection = activeProjects.some((project) => project.id === selectedProjectId);
        return hasValidSelection ? (selectedProjectId || '') : activeProjects[0].id;
    }, [activeProjects, selectedProjectId]);
    const selectedProject = activeProjects.find((p) => p.id === effectiveSelectedProjectId);

    useEffect(() => {
        if (!activeProjects.length) {
            if (selectedProjectId) setSelectedProjectId('');
            return;
        }

        if (selectedProjectId !== effectiveSelectedProjectId) {
            setSelectedProjectId(effectiveSelectedProjectId);
        }
    }, [activeProjects, effectiveSelectedProjectId, selectedProjectId, setSelectedProjectId]);

    // Filtra sprints pelo projeto selecionado (mais confiável que comparar por path)
    const currentSprint = selectedProject
        ? sprints?.find((sprint: Sprint) => sprint.projectId === selectedProject.id)
        : sprints?.[0];

    // Busca dados de capacidade para a sprint atual
    const {
        data: capacityData,
        isError: capacityError,
    } = useCapacityComparison(currentSprint?.id || '');

    // Busca dados de burndown
    const {
        data: burndownData,
        isLoading: burndownLoading,
    } = useSprintBurndown(currentSprint?.id || '');

    // Busca work items bloqueados (fonte original do card de impedimentos)
    const {
        data: blockedItems,
        isLoading: blockedItemsLoading,
    } = useBlockedWorkItems(
        currentSprint
            ? { sprintId: currentSprint.id, projectId: selectedProject?.id, compact: true }
            : undefined
    );
    const scopedBlockedItems = blockedItems || [];

    // Busca todos os work items da sprint atual (para os gráficos donut)
    const {
        data: workItemsResponse,
        isLoading: workItemsLoading,
    } = useWorkItems(
        currentSprint ? { sprintId: currentSprint.id, includeRemoved: false, compact: true, limit: 1000 } : undefined
    );
    const sprintWorkItems = workItemsResponse?.data || [];

    // Calcula o score de saúde da sprint
    const healthDetails = currentSprint
        ? calculateSprintHealthDetails(currentSprint, capacityData, burndownData?.raw)
        : null;
    const healthScore = healthDetails ? healthDetails.score : null;
    const formatSprintDate = (date: string) =>
        new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

    const isDashboardBootstrapping = sprintsLoading
        || !!currentSprint && burndownLoading;

    if (sprintsLoading) {
        return <DashboardSkeleton projectName={selectedProject?.name} />;
    }

    if (isDashboardBootstrapping && currentSprint) {
        return (
            <DashboardSkeleton
                sprintName={currentSprint.name}
                sprintDates={`${formatSprintDate(currentSprint.startDate)} - ${formatSprintDate(currentSprint.endDate)}`}
                projectName={selectedProject?.name}
            />
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
    const burndownRemaining = Math.max(0, Math.round(Number(lastSnapshot?.remainingWork || 0)));
    const burndownCompleted = Math.max(0, Math.round(Number(lastSnapshot?.completedWork || 0)));
    const plannedInitialFromHistory = Number.isFinite(Number(burndownData?.plannedInitialBeforeD1))
        ? Math.max(0, Math.round(Number(burndownData?.plannedInitialBeforeD1 || 0)))
        : null;

    const plannedInitial = sortedBurndown.length
        ? (plannedInitialFromHistory ?? burndownInitial)
        : (capacityData?.summary.totalPlannedInitial ?? 0);
    const plannedCurrent = sortedBurndown.length
        ? burndownCurrent
        : (capacityData?.summary.totalPlannedCurrent ?? capacityData?.summary.totalPlanned ?? 0);
    const plannedDelta = plannedCurrent - plannedInitial;
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
        plannedInitialD1Date: burndownData?.plannedInitialD1Date,
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
            {/* Cabeçalho */}
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
                    {/* Cards de Métricas */}
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                        <StatCard
                            title="Capacidade Total"
                            value={capacityData ? `${capacityData.summary.totalAvailable}h` : '...'}
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
                        {blockedItemsLoading ? (
                            <StatCard title="Impedimentos" value="..." icon={AlertTriangle} />
                        ) : (
                            <BlockedItemsCard
                                workItems={scopedBlockedItems}
                                projectName={selectedProject?.name}
                                itemsArePreFiltered
                            />
                        )}
                    </div>

                    {/* Barra de Progresso da Sprint baseada em Planejado vs Restante */}
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
                                        ? 'bg-red-500' // Vermelho se ultrapassou o planejado
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

                    {/* Saúde da Sprint + Work Item Aging */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {healthScore !== null && (
                            <SprintHealthCard
                                score={healthScore}
                                reasons={healthDetails?.penalties}
                            />
                        )}
                        {workItemsLoading ? (
                            <SectionLoader label="Carregando aging..." />
                        ) : (
                            <Suspense fallback={<SectionLoader label="Carregando aging..." />}>
                                <WorkItemAgingCard
                                    workItems={sprintWorkItems}
                                    capacityData={capacityData}
                                    sprintStartDate={currentSprint.startDate}
                                    sprintEndDate={currentSprint.endDate}
                                    dayOffDates={capacityData?.summary.dayOffDates || []}
                                    projectName={selectedProject?.name}
                                />
                            </Suspense>
                        )}
                    </div>

                    {/* Distribuição de Work Items (Donuts) */}
                    {!workItemsLoading && sprintWorkItems.length > 0 && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            <Suspense fallback={<SectionLoader label="Carregando gráfico..." />}>
                                <WorkItemsByStateChart workItems={sprintWorkItems} />
                            </Suspense>
                            <Suspense fallback={<SectionLoader label="Carregando gráfico..." />}>
                                <WorkItemsByTypeChart workItems={sprintWorkItems} />
                            </Suspense>
                            <Suspense fallback={<SectionLoader label="Carregando gráfico..." />}>
                                <WorkItemsByMemberChart workItems={sprintWorkItems} />
                            </Suspense>
                        </div>
                    )}

                    {/* Conteúdo Principal */}
                    <div className="space-y-6">
                        {/* Tabela de Capacidade */}
                        {capacityData && (
                            <Suspense fallback={<SectionLoader label="Carregando capacidade..." minHeight="min-h-[320px]" />}>
                                <CapacityTable data={capacityData} plannedCurrent={plannedCurrent} projectName={selectedProject?.name} />
                            </Suspense>
                        )}
                        {capacityData && (
                            <Suspense fallback={<SectionLoader label="Carregando membros..." minHeight="min-h-[320px]" />}>
                                <MemberCapacityProgress data={capacityData} />
                            </Suspense>
                        )}

                        {/* Diagrama de Fluxo Cumulativo (CFD) */}
                        {burndownData && (
                            <div className="pt-2">
                                <Suspense fallback={<SectionLoader label="Carregando fluxo..." minHeight="min-h-[360px]" />}>
                                    <CumulativeFlowChart
                                        data={burndownData.raw}
                                        sprintStartDate={currentSprint.startDate}
                                        sprintEndDate={currentSprint.endDate}
                                        dayOffDates={capacityData?.summary.dayOffDates || []}
                                    />
                                </Suspense>
                            </div>
                        )}

                        {/* Gráfico de Burndown */}
                        {burndownData && (
                            <div className="pt-2">
                                <Suspense fallback={<SectionLoader label="Carregando burndown..." minHeight="min-h-[420px]" />}>
                                    <BurndownChart
                                        sprintId={currentSprint.id}
                                        data={burndownData.raw}
                                        plannedInitial={plannedInitial}
                                        plannedInitialD1Date={burndownData.plannedInitialD1Date}
                                        plannedCurrent={plannedCurrent}
                                        plannedDelta={plannedDelta}
                                        currentRemaining={remainingHours}
                                        lateCompletionHours={burndownData.lateCompletionHours}
                                        lateCompletionItems={burndownData.lateCompletionItems}
                                        lateScopeAddedHours={burndownData.lateScopeAddedHours}
                                        lateScopeRemovedHours={burndownData.lateScopeRemovedHours}
                                        sprintStartDate={currentSprint.startDate}
                                        sprintEndDate={currentSprint.endDate}
                                        dayOffDates={capacityData?.summary.dayOffDates || []}
                                    />
                                </Suspense>
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
