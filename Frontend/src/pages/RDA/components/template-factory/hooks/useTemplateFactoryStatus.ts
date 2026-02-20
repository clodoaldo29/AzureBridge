import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { ApiResponse } from '@/types';
import type { TemplateFactoryStatusResponse } from '../types';

export const templateFactoryKeys = {
    all: ['templateFactory'] as const,
    status: (id: string) => [...templateFactoryKeys.all, 'status', id] as const,
};

export const useTemplateFactoryStatus = (
    id: string | null,
    options?: {
        enabled?: boolean;
        refetchInterval?: number | false;
    },
) => {
    return useQuery({
        queryKey: templateFactoryKeys.status(id || ''),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<TemplateFactoryStatusResponse>>(`/rda/template-factory/${id}/status`);
            return data.data;
        },
        enabled: Boolean(id) && (options?.enabled ?? true),
        refetchInterval: options?.refetchInterval ?? false,
    });
};
