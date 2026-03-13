import { useSprints } from '@/services/queries/sprints';
import { useCapacityComparison } from '@/services/queries/capacity';
import { useWorkItems } from '@/services/queries/workItems';
import { useSprintBurndown } from '@/services/queries/sprints';
import { StatCard } from '@/components/dashboard/StatCard';
import { SprintHealthCard } from '@/components/dashboard/SprintHealthCard';
import { BlockedItemsCard } from '../components/BlockedItemsCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Target, Users, CheckCircle2, Clock } from 'lucide-react';
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

const ALLOWED_PROJECT_NAMES = new Set([
    'GIGA - Retrabalho',
    'GIGA - Tempos e Movimentos',
    'Projeto Plataforma de Melhorias na Engenharia',
]);
const TM_PROJECT_NAME = 'GIGA - Tempos e Movimentos';

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

function SprintPageSkeleton({
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
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-2">
                    <div className="text-4xl font-bold tracking-tight text-foreground">
                        {sprintName || 'Carregando sprint...'}
                    </div>
                    <div className="text-muted-foreground">
                        {sprintDates || 'Aguardando dados da sprint selecionada'}
                    </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:w-auto">
                    <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground min-w-[260px]">
                        {projectName || 'Selecionando projeto...'}
                    </div>
                    <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground min-w-[260px]">
                        {sprintName || 'Selecionando sprint...'}
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

export function Sprints() {
    const {
        selectedProjectId,
        selectedSprintId,
        setSelectedProjectId,
        setSelectedSprintId,
    } = useAppStore();

    const { data: projectsResponse } = useQuery<{ data: Project[] }>({
        queryKey: ['projects'],
        queryFn: async () => {
            const response = await api.get('/projects');
            return response.data;
        },
    });
    const projects = projectsResponse?.data || [];
    const filteredProjects = useMemo(
        () => projects.filter((project) => ALLOWED_PROJECT_NAMES.has(project.name)),
        [projects]
    );
    const effectiveSelectedProjectId = useMemo(() => {
        if (!filteredProjects.length) return null;
        const hasValidSelection = selectedProjectId && filteredProjects.some((project) => project.id === selectedProjectId);
        return hasValidSelection ? selectedProjectId : filteredProjects[0].id;
    }, [filteredProjects, selectedProjectId]);

    const sprintFilters = useMemo(
        () => ({
            state: 'Past',
            limit: 100,
            includeDetails: false,
            ...(effectiveSelectedProjectId ? { projectId: effectiveSelectedProjectId } : {}),
        }),
        [effectiveSelectedProjectId]
    );

    const {
        data: sprints,
        isLoading: sprintsLoading,
        isError: sprintsError,
    } = useSprints(sprintFilters);

    const selectedProject = filteredProjects.find((p) => p.id === effectiveSelectedProjectId);
    const filteredSprints = useMemo(() => {
        const allSprints = sprints || [];
        if (selectedProject?.name === TM_PROJECT_NAME) {
            return allSprints.filter((sprint: Sprint) =>
                String(sprint.name || '').toUpperCase().includes('AV-NAV')
            );
        }
        return allSprints;
    }, [sprints, selectedProject?.name]);

    const effectiveSelectedSprintId = useMemo(() => {
        if (!filteredSprints.length) return null;
        const hasValidSprint = selectedSprintId && filteredSprints.some((sprint: Sprint) => sprint.id === selectedSprintId);
        return hasValidSprint ? selectedSprintId : filteredSprints[0].id;
    }, [filteredSprints, selectedSprintId]);

    const currentSprint = effectiveSelectedSprintId
        ? filteredSprints.find((sprint: Sprint) => sprint.id === effectiveSelectedSprintId)
        : filteredSprints[0];

    useEffect(() => {
        if (!filteredProjects.length) {
            if (selectedProjectId) setSelectedProjectId(null);
            return;
        }

        if (selectedProjectId !== effectiveSelectedProjectId) {
            setSelectedProjectId(effectiveSelectedProjectId);
        }
    }, [effectiveSelectedProjectId, filteredProjects, selectedProjectId, setSelectedProjectId]);

    useEffect(() => {
        if (!filteredSprints.length) {
            if (selectedSprintId) setSelectedSprintId(null);
            return;
        }

        if (selectedSprintId !== effectiveSelectedSprintId) {
            setSelectedSprintId(effectiveSelectedSprintId);
        }
    }, [effectiveSelectedSprintId, filteredSprints, selectedSprintId, setSelectedSprintId]);

    const {
        data: capacityData,
        isError: capacityError,
    } = useCapacityComparison(currentSprint?.id || '');

    const {
        data: burndownData,
        isLoading: burndownLoading,
    } = useSprintBurndown(currentSprint?.id || '');

    const {
        data: workItemsResponse,
        isLoading: workItemsLoading,
    } = useWorkItems(
        currentSprint ? { sprintId: currentSprint.id, includeRemoved: true, compact: true, limit: 1000 } : undefined
    );
    const sprintWorkItems = workItemsResponse?.data || [];

    const healthDetails = currentSprint
        ? calculateSprintHealthDetails(currentSprint, capacityData, burndownData?.raw)
        : null;
    const healthScore = healthDetails ? healthDetails.score : null;
    const formatSprintDate = (date: string) =>
        new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

    const isSprintDashboardBootstrapping = sprintsLoading
        || !!currentSprint && burndownLoading;

    if (sprintsLoading) {
        return <SprintPageSkeleton projectName={selectedProject?.name} />;
    }

    if (isSprintDashboardBootstrapping && currentSprint) {
        return (
            <SprintPageSkeleton
                sprintName={currentSprint.name}
                sprintDates={`${formatSprintDate(currentSprint.startDate)} - ${formatSprintDate(currentSprint.endDate)}`}
                projectName={selectedProject?.name}
            />
        );
    }

    if ((sprintsError || capacityError) && !filteredSprints.length && !capacityData) {
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
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">
                        {currentSprint ? currentSprint.name : 'Sprints'}
                    </h1>
                    {currentSprint ? (
                        <p className="text-muted-foreground text-sm mt-1">
                            {formatSprintDate(currentSprint.startDate)} - {formatSprintDate(currentSprint.endDate)}
                        </p>
                    ) : (
                        <p className="text-muted-foreground text-sm mt-1">
                            Selecione um projeto e uma sprint passada para visualizar os indicadores.
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        value={selectedProjectId || ''}
                        onValueChange={(value: string) => setSelectedProjectId(value)}
                    >
                        <SelectTrigger className="w-[260px]">
                            <SelectValue placeholder="Selecione um projeto..." />
                        </SelectTrigger>
                        <SelectContent>
                            {filteredProjects.map((project) => (
                                <SelectItem key={project.id} value={project.id}>
                                    {project.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select
                        value={selectedSprintId || ''}
                        onValueChange={(value: string) => setSelectedSprintId(value)}
                    >
                        <SelectTrigger className="w-[260px]">
                            <SelectValue placeholder="Selecione uma sprint..." />
                        </SelectTrigger>
                        <SelectContent>
                            {filteredSprints.map((sprint: Sprint) => (
                                <SelectItem key={sprint.id} value={sprint.id}>
                                    {sprint.name}
                                </SelectItem>
                            ))}
                            {!filteredSprints.length && (
                                <SelectItem value="__none" disabled>
                                    Nenhuma sprint passada
                                </SelectItem>
                            )}
                        </SelectContent>
                    </Select>

                </div>
            </div>

            {currentSprint ? (
                <>
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
                        {workItemsLoading ? (
                            <StatCard title="Impedimentos" value="..." icon={Clock} />
                        ) : (
                            <BlockedItemsCard workItems={sprintWorkItems} projectName={selectedProject?.name} />
                        )}
                    </div>

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
                                        ? 'bg-red-500'
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

                    <div className="space-y-6">
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
                    Nenhuma sprint passada encontrada para o projeto selecionado.
                </div>
            )}
        </div>
    );
}
