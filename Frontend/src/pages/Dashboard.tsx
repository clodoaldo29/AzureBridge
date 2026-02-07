import { useSprints } from '@/services/queries/sprints';
import { useCapacityComparison } from '@/services/queries/capacity';
import { useBlockedWorkItems } from '@/services/queries/workItems';
import { useSprintBurndown } from '@/services/queries/sprints';
import { StatCard } from '@/components/dashboard/StatCard';
import { SprintHealthCard } from '@/components/dashboard/SprintHealthCard';
import { CapacityTable } from '@/components/dashboard/CapacityTable';
import { BlockersAlert } from '@/components/dashboard/BlockersAlert';
import { BurndownChart } from '@/components/charts/BurndownChart';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Target, Users, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { calculateSprintHealth } from '@/utils/calculations';
import { useAppStore } from '@/stores/appStore';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Project } from '@/types';

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
    const selectedProject = projects.find(p => p.id === selectedProjectId);

    // Fetch current sprints (Active)
    const {
        data: sprints,
        isLoading: sprintsLoading,
        isError: sprintsError,
    } = useSprints({ state: 'Active' });

    // Filter sprints by selected project ID (more reliable than path comparison)
    const currentSprint = selectedProject
        ? sprints?.find(sprint => sprint.projectId === selectedProject.id)
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

    // Calculate sprint health score
    const healthScore = currentSprint
        ? calculateSprintHealth(currentSprint, capacityData, burndownData?.raw)
        : null;

    if (sprintsLoading || capacityLoading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-gray-500">Carregando...</div>
            </div>
        );
    }

    if (sprintsError || capacityError) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center text-gray-500">
                    <div className="text-lg font-semibold">Não foi possível carregar os dados.</div>
                    <p className="mt-2 text-sm">
                        Verifique sua conexão com a API e tente novamente.
                    </p>
                </div>
            </div>
        );
    }

    const formatSprintDate = (date: string) =>
        new Date(date).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">
                        {currentSprint ? currentSprint.name : 'Dashboard'}
                    </h1>
                    {currentSprint ? (
                        <p className="text-gray-500 text-sm mt-1">
                            {formatSprintDate(currentSprint.startDate)} - {formatSprintDate(currentSprint.endDate)}
                        </p>
                    ) : (
                        <p className="text-gray-500 text-sm mt-1">
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
                        {projects.map((project) => (
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
                            title="Planejado"
                            value={`${capacityData?.summary.totalPlanned || 0}h`}
                            icon={Target}
                        />
                        <StatCard
                            title="Restante"
                            value={`${capacityData?.summary.totalRemaining || 0}h`}
                            icon={Clock}
                            description={
                                (capacityData?.summary.totalAddedScope || 0) > 0 ? (
                                    <span className="text-orange-600 font-medium text-xs flex items-center">
                                        <AlertTriangle className="w-3 h-3 mr-1" />
                                        +{capacityData?.summary.totalAddedScope}h Adicionado
                                    </span>
                                ) : undefined
                            }
                        />
                        <StatCard
                            title="Concluído"
                            value={`${currentSprint.totalCompletedHours || 0}h`}
                            icon={CheckCircle2}
                        />
                        <StatCard
                            title="Impedimentos"
                            value={`${blockedItems?.length || 0}`}
                            icon={AlertTriangle}
                        />
                    </div>

                    {/* Sprint Progress Bar based on Planned vs Remaining */}
                    {capacityData && capacityData.summary.totalPlanned > 0 && (
                        <div className="bg-white rounded-lg shadow p-4 border border-gray-100">
                            <div className="flex justify-between items-end mb-2">
                                <h3 className="text-sm font-medium text-gray-500">Progresso da Sprint (Baseado em Horas)</h3>
                                <span className="text-sm font-bold text-gray-900">
                                    {Math.max(0, Math.round(((capacityData.summary.totalPlanned - (capacityData.summary.totalRemaining || 0)) / capacityData.summary.totalPlanned) * 100))}%
                                </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                                <div
                                    className={`h-2.5 rounded-full transition-all duration-500 ${(capacityData.summary.totalRemaining || 0) > capacityData.summary.totalPlanned
                                        ? 'bg-red-500' // Red if over planned
                                        : 'bg-blue-600'
                                        }`}
                                    style={{ width: `${Math.min(100, Math.max(0, ((capacityData.summary.totalPlanned - (capacityData.summary.totalRemaining || 0)) / capacityData.summary.totalPlanned) * 100))}%` }}
                                ></div>
                            </div>
                            <div className="flex justify-between items-start mt-2">
                                <p className="text-xs text-gray-400">
                                    {Math.max(0, capacityData.summary.totalPlanned - (capacityData.summary.totalRemaining || 0))}h concluídas de {capacityData.summary.totalPlanned}h planejadas
                                </p>
                                {/* Scope Creep Warning Message */}
                                {(capacityData.summary.totalRemaining || 0) > capacityData.summary.totalPlanned && (
                                    <p className="text-xs text-red-600 font-medium flex items-center">
                                        <AlertTriangle className="w-3 h-3 mr-1" />
                                        Atenção: O escopo aumentou {((capacityData.summary.totalRemaining || 0) - capacityData.summary.totalPlanned)}h além do planejado.
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Sprint Health + Blocked Items */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {healthScore !== null && <SprintHealthCard score={healthScore} />}
                        {blockedItems && <BlockersAlert blockedItems={blockedItems} />}
                    </div>

                    {/* Main Content */}
                    <div className="space-y-6">
                        {/* Capacity Table */}
                        {capacityData && <CapacityTable data={capacityData} />}

                        {/* Burndown Chart */}
                        {burndownData && <BurndownChart data={burndownData.raw} />}
                    </div>
                </>
            ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white py-16 text-gray-500">
                    Nenhuma sprint ativa encontrada no momento.
                </div>
            )}
        </div>
    );
}
