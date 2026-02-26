import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Sprint, ApiResponse, ApiListResponse, SprintSnapshot, ScopeChangesResult } from '@/types';

// Chaves de query
export const sprintKeys = {
    all: ['sprints'] as const,
    lists: () => [...sprintKeys.all, 'list'] as const,
    list: (filters: Record<string, any>) => [...sprintKeys.lists(), filters] as const,
    details: () => [...sprintKeys.all, 'detail'] as const,
    detail: (id: string) => [...sprintKeys.details(), id] as const,
    burndown: (id: string) => [...sprintKeys.detail(id), 'burndown'] as const,
    scopeChanges: (id: string, date: string) => [...sprintKeys.detail(id), 'scope-changes', date] as const,
};

// Busca lista de sprints
export const useSprints = (params?: {
    projectId?: string;
    state?: string;
    limit?: number;
}) => {
    return useQuery({
        queryKey: sprintKeys.list(params || {}),
        queryFn: async () => {
            const { data } = await api.get<ApiListResponse<Sprint>>('/sprints', { params });
            return data.data;
        },
        refetchInterval: 30000,
    });
};

// Busca detalhes de uma sprint
export const useSprint = (id: string) => {
    return useQuery({
        queryKey: sprintKeys.detail(id),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<Sprint>>(`/sprints/${id}`);
            return data.data;
        },
        enabled: !!id,
    });
};

// Busca work items com mudanca de escopo em um dia especifico
export const useScopeChanges = (sprintId: string, date: string | null) => {
    return useQuery({
        queryKey: sprintKeys.scopeChanges(sprintId, date || ''),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<ScopeChangesResult>>(
                `/sprints/${sprintId}/scope-changes`,
                { params: { date } }
            );
            return data.data;
        },
        enabled: !!sprintId && !!date,
        staleTime: 5 * 60 * 1000,
    });
};

// Busca dados de burndown da sprint
export const useSprintBurndown = (id: string) => {
    return useQuery({
        queryKey: sprintKeys.burndown(id),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<{
                labels: string[];
                series: Array<{ name: string; data: number[] }>;
                raw: SprintSnapshot[];
                plannedInitialBeforeD1?: number | null;
                plannedInitialD1Date?: string | null;
                plannedInitialContributingItems?: number;
            }>>(`/sprints/${id}/burndown`);
            return data.data;
        },
        enabled: !!id,
        refetchOnMount: 'always',
        refetchInterval: 60000,
    });
};
