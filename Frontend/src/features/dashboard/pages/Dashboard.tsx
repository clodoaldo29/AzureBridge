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
import { Target, Users, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { calculateSprintHealthDetails } from '@/utils/calculations';
import { useAppStore } from '@/stores/appStore';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Project, Sprint } from '@/types';
import { useEffect, useMemo } from 'react';

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

    const plannedInitial = capacityData?.summary.totalPlannedInitial ?? 0;
    const plannedCurrent = capacityData?.summary.totalPlannedCurrent ?? capacityData?.summary.totalPlanned ?? 0;
    const plannedDelta = capacityData?.summary.totalPlannedDelta ?? (plannedCurrent - plannedInitial);
    const remainingHours = capacityData?.summary.totalRemaining ?? 0;
    const completedHours = Math.max(0, plannedCurrent - remainingHours);

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
                        <StatCard
                            title="Restante"
                            value={`${capacityData?.summary.totalRemaining || 0}h`}
                            icon={Clock}
                        />
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
                            <div className="flex justify-between items-end mb-2">
                                <h3 className="text-sm font-medium text-muted-foreground">Progresso da Sprint (Baseado em Horas)</h3>
                                <span className="text-sm font-bold text-foreground">
                                    {Math.max(0, Math.round((completedHours / plannedCurrent) * 100))}%
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                                <div
                                    className={`h-2.5 rounded-full transition-all duration-500 ${remainingHours > plannedCurrent
                                        ? 'bg-red-500' // Red if over planned
                                        : 'bg-blue-600'
                                        }`}
                                    style={{ width: `${Math.min(100, Math.max(0, (completedHours / plannedCurrent) * 100))}%` }}
                                ></div>
                            </div>
                            <div className="flex justify-between items-start mt-2">
                                <p className="text-xs text-muted-foreground">
                                    {completedHours}h concluídas de {plannedCurrent}h planejadas
                                </p>
                                {/* Scope Creep Warning Message */}
                                {remainingHours > plannedCurrent && (
                                    <p className="text-xs text-red-600 font-medium flex items-center">
                                        <AlertTriangle className="w-3 h-3 mr-1" />
                                        Atenção: O escopo aumentou {(remainingHours - plannedCurrent)}h além do planejado.
                                    </p>
                                )}
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
                        {capacityData && <CapacityTable data={capacityData} />}
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


