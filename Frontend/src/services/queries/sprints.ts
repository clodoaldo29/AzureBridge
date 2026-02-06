import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { Sprint, ApiResponse, ApiListResponse, SprintSnapshot } from '@/types';

// Query Keys
export const sprintKeys = {
    all: ['sprints'] as const,
    lists: () => [...sprintKeys.all, 'list'] as const,
    list: (filters: Record<string, any>) => [...sprintKeys.lists(), filters] as const,
    details: () => [...sprintKeys.all, 'detail'] as const,
    detail: (id: string) => [...sprintKeys.details(), id] as const,
    burndown: (id: string) => [...sprintKeys.detail(id), 'burndown'] as const,
};

// Fetch Sprints List
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
    });
};

// Fetch Sprint Details
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

// Fetch Sprint Burndown
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
    });
};
