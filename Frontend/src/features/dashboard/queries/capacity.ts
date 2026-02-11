import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { CapacityComparison, ApiResponse } from '@/types';

export const capacityKeys = {
    all: ['capacity'] as const,
    comparison: (sprintId: string) => [...capacityKeys.all, 'comparison', sprintId] as const,
};

export const useCapacityComparison = (sprintId: string) => {
    return useQuery({
        queryKey: capacityKeys.comparison(sprintId),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<CapacityComparison>>(
                `/sprints/${sprintId}/capacity/comparison`
            );
            return data.data;
        },
        enabled: !!sprintId,
        refetchInterval: 60000, // Atualizar a cada 1 minuto
    });
};
