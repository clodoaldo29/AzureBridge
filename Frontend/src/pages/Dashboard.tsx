import { useSprints } from '@/services/queries/sprints';
import { useCapacityComparison } from '@/services/queries/capacity';
import { useBlockedWorkItems } from '@/services/queries/workItems';
import { useSprintBurndown } from '@/services/queries/sprints';
import { StatCard } from '@/components/dashboard/StatCard';
import { SprintHealthCard } from '@/components/dashboard/SprintHealthCard';
import { CapacityTable } from '@/components/dashboard/CapacityTable';
import { BlockersAlert } from '@/components/dashboard/BlockersAlert';
import { BurndownChart } from '@/components/charts/BurndownChart';
import { Target, Users, CheckCircle2, AlertTriangle } from 'lucide-react';
import { calculateSprintHealth } from '@/utils/calculations';
import { useAppStore } from '@/stores/appStore';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Project } from '@/types';

export function Dashboard() {
    const { selectedProjectId } = useAppStore();

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

    // Filter sprints by selected project name in path, or show first sprint if no project selected
    const currentSprint = selectedProject
        ? sprints?.find(sprint => sprint.path.startsWith(selectedProject.name))
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

    if (!currentSprint) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-gray-500">Nenhuma sprint ativa encontrada no momento.</div>
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900">{currentSprint.name}</h1>
                <p className="text-gray-500 text-sm mt-1">
                    {new Date(currentSprint.startDate).toLocaleDateString('pt-BR')} -{' '}
                    {new Date(currentSprint.endDate).toLocaleDateString('pt-BR')}
                </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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

            {/* Sprint Health + Blocked Items */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {healthScore !== null && <SprintHealthCard score={healthScore} />}
                {blockedItems && <BlockersAlert blockedItems={blockedItems} />}
            </div>

            {/* Main Content */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Capacity Table */}
                {capacityData && <CapacityTable data={capacityData} />}

                {/* Burndown Chart */}
                {burndownData && (
                    <BurndownChart
                        data={burndownData.raw}
                    />
                )}
            </div>
        </div>
    );
}
