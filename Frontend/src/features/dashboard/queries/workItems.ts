import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { WorkItem, ApiListResponse } from '@/types';

export const workItemKeys = {
    all: ['workItems'] as const,
    lists: () => [...workItemKeys.all, 'list'] as const,
    list: (filters: Record<string, any>) => [...workItemKeys.lists(), filters] as const,
    blocked: () => [...workItemKeys.all, 'blocked'] as const,
};

export const useWorkItems = (params?: {
    sprintId?: string;
    projectId?: string;
    type?: string;
    state?: string;
    includeRemoved?: boolean;
    compact?: boolean;
    limit?: number;
    offset?: number;
}) => {
    const hasFilters = params !== undefined;

    return useQuery({
        queryKey: workItemKeys.list(params || {}),
        queryFn: async () => {
            const { data } = await api.get<ApiListResponse<WorkItem>>('/work-items', { params });
            return data;
        },
        enabled: hasFilters,
        refetchInterval: 30000,
    });
};

export const useBlockedWorkItems = (params?: {
    sprintId?: string;
    projectId?: string;
    compact?: boolean;
}) => {
    const hasFilters = params !== undefined;

    return useQuery({
        queryKey: [...workItemKeys.blocked(), params || {}],
        queryFn: async () => {
            const { data } = await api.get<ApiListResponse<WorkItem>>('/work-items/blocked', { params });
            return data.data;
        },
        enabled: hasFilters,
        refetchInterval: 30000, // Atualizar a cada 30 segundos
    });
};
