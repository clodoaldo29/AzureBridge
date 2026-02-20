import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';

interface ApiResponse<T> {
    success: boolean;
    data: T;
    error?: string;
}

export interface GenerationProgress {
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    currentStep: string | null;
}

export interface GenerationListItem {
    id: string;
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    progress: number;
    currentStep: string | null;
    periodStart: string;
    periodEnd: string;
    tokensUsed: number;
    outputFilePath: string | null;
    createdAt: string;
    updatedAt: string;
    errorMessage: string | null;
}

export function useGenerationProgress(projectId: string, generationId: string | null) {
    return useQuery({
        queryKey: ['generation-progress', generationId],
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<GenerationProgress>>(`/rda/generations/${projectId}/${generationId}/progress`);
            return data.data;
        },
        enabled: Boolean(projectId) && Boolean(generationId),
        refetchInterval: (query) => {
            const state = query.state.data;
            if (!state) return 2000;
            if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
                return false;
            }
            return 2000;
        },
    });
}

export function useGenerationDetails(projectId: string, generationId: string | null) {
    return useQuery({
        queryKey: ['generation-details', generationId],
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<Record<string, unknown>>>(`/rda/generations/${projectId}/${generationId}`);
            return data.data;
        },
        enabled: Boolean(projectId) && Boolean(generationId),
    });
}

export function useGenerationsList(projectId: string, status?: string) {
    return useQuery({
        queryKey: ['generations-list', projectId, status ?? 'all'],
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<{ items: GenerationListItem[]; total: number }>>(
                `/rda/generations/${projectId}`,
                { params: { page: 1, limit: 50, status: status || undefined } },
            );
            return data.data;
        },
        enabled: Boolean(projectId),
    });
}

export function useCancelGeneration(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (generationId: string) => {
            await api.post(`/rda/generations/${projectId}/${generationId}/cancel`);
        },
        onSuccess: (_, generationId) => {
            queryClient.invalidateQueries({ queryKey: ['generation-progress', generationId] });
            queryClient.invalidateQueries({ queryKey: ['generation-details', generationId] });
            queryClient.invalidateQueries({ queryKey: ['generations-list', projectId] });
        },
    });
}

export function useRetryGeneration(projectId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (generationId: string) => {
            await api.post(`/rda/generations/${projectId}/${generationId}/retry`);
        },
        onSuccess: (_, generationId) => {
            queryClient.invalidateQueries({ queryKey: ['generation-progress', generationId] });
            queryClient.invalidateQueries({ queryKey: ['generation-details', generationId] });
            queryClient.invalidateQueries({ queryKey: ['generations-list', projectId] });
        },
    });
}
