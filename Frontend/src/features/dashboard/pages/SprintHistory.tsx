import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { useProjectSprintHistory } from '@/services/queries/sprints';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SprintHistoryPerformance } from '@/features/dashboard/components/SprintHistoryPerformance';
import type { Project, SprintHistorySummary } from '@/types';

const ALLOWED_PROJECT_NAMES = new Set([
    'GIGA - Retrabalho',
    'GIGA - Tempos e Movimentos',
    'Projeto Plataforma de Melhorias na Engenharia',
]);
const TM_PROJECT_NAME = 'GIGA - Tempos e Movimentos';

export function SprintHistory() {
    const [selectedProjectId, setSelectedProjectId] = useState<string>('');

    const { data: projectsResponse, isLoading: projectsLoading, isError: projectsError } = useQuery<{ data: Project[] }>({
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

    useEffect(() => {
        if (!filteredProjects.length) {
            if (selectedProjectId) setSelectedProjectId('');
            return;
        }

        const hasValidSelection = selectedProjectId && filteredProjects.some((project) => project.id === selectedProjectId);
        if (!hasValidSelection) {
            setSelectedProjectId(filteredProjects[0].id);
        }
    }, [filteredProjects, selectedProjectId]);

    const {
        data: historyRows,
        isLoading: historyLoading,
        isError: historyError,
    } = useProjectSprintHistory(selectedProjectId, 100);

    const selectedProject = filteredProjects.find((project) => project.id === selectedProjectId);
    const filteredHistory = useMemo(() => {
        const allSprints = historyRows || [];
        if (selectedProject?.name === TM_PROJECT_NAME) {
            return allSprints.filter((sprint: SprintHistorySummary) =>
                String(sprint.sprintName || '').toUpperCase().includes('AV-NAV')
            );
        }
        return allSprints;
    }, [historyRows, selectedProject?.name]);

    if (projectsLoading || (selectedProjectId && historyLoading)) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-muted-foreground">Carregando...</div>
            </div>
        );
    }

    if (projectsError || historyError) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-center text-muted-foreground">
                    <div className="text-lg font-semibold">Nao foi possivel carregar os dados de historico.</div>
                    <p className="mt-2 text-sm">Verifique a conexao com a API e tente novamente.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Historico de Sprints</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Comparativo de capacidade, planejamento e entrega por sprint.
                    </p>
                </div>

                <Select
                    value={selectedProjectId || ''}
                    onValueChange={(value: string) => setSelectedProjectId(value)}
                >
                    <SelectTrigger className="w-[320px]">
                        <SelectValue placeholder="Selecione um projeto..." />
                    </SelectTrigger>
                    <SelectContent>
                        {filteredProjects.map((project) => (
                            <SelectItem key={project.id} value={project.id}>
                                {project.name}
                            </SelectItem>
                        ))}
                        {!filteredProjects.length && (
                            <SelectItem value="__none" disabled>
                                Nenhum projeto disponivel
                            </SelectItem>
                        )}
                    </SelectContent>
                </Select>
            </div>

            {selectedProject ? (
                <SprintHistoryPerformance
                    summaries={filteredHistory}
                    projectName={selectedProject.name}
                />
            ) : (
                <div className="flex items-center justify-center rounded-lg border border-dashed border-border bg-card py-16 text-muted-foreground">
                    Selecione um projeto para visualizar o historico.
                </div>
            )}
        </div>
    );
}
