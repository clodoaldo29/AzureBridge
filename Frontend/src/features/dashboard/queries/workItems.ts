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
    limit?: number;
    offset?: number;
}) => {
    return useQuery({
        queryKey: workItemKeys.list(params || {}),
        queryFn: async () => {
            const { data } = await api.get<ApiListResponse<WorkItem>>('/work-items', { params });
            return data;
        },
    });
};

export const useBlockedWorkItems = () => {
    return useQuery({
        queryKey: workItemKeys.blocked(),
        queryFn: async () => {
            const { data } = await api.get<ApiListResponse<WorkItem>>('/work-items/blocked');
            return data.data;
        },
        refetchInterval: 30000, // Atualizar a cada 30 segundos
    });
};
