import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { Sprint, ApiResponse, ApiListResponse, SprintSnapshot } from '@/types';

// Chaves de query
export const sprintKeys = {
    all: ['sprints'] as const,
    lists: () => [...sprintKeys.all, 'list'] as const,
    list: (filters: Record<string, any>) => [...sprintKeys.lists(), filters] as const,
    details: () => [...sprintKeys.all, 'detail'] as const,
    detail: (id: string) => [...sprintKeys.details(), id] as const,
    burndown: (id: string) => [...sprintKeys.detail(id), 'burndown'] as const,
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

// Busca dados de burndown da sprint
export const useSprintBurndown = (id: string) => {
    return useQuery({
        queryKey: sprintKeys.burndown(id),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<{
                labels: string[];
                series: Array<{ name: string; data: number[] }>;
                raw: SprintSnapshot[];
            }>>(`/sprints/${id}/burndown`);
            return data.data;
        },
        enabled: !!id,
        refetchOnMount: 'always',
        refetchInterval: 60000,
    });
};
