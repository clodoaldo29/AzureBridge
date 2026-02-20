import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { ApiResponse, GenerateRDARequest, RDAGeneration } from '@/types';

export const rdaKeys = {
    all: ['rda'] as const,
    generation: (id: string) => [...rdaKeys.all, 'generation', id] as const,
    projectList: (projectId: string) => [...rdaKeys.all, 'project', projectId] as const,
};

export const useGenerateRDA = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: GenerateRDARequest) => {
            const { data } = await api.post<ApiResponse<RDAGeneration>>('/rda/generate', payload);
            return data.data;
        },
        onSuccess: (generation) => {
            queryClient.invalidateQueries({ queryKey: rdaKeys.projectList(generation.projectId) });
            queryClient.setQueryData(rdaKeys.generation(generation.id), generation);
        },
    });
};

export const useRDAGeneration = (
    id: string | null,
    options?: {
        enabled?: boolean;
        refetchInterval?: number | false;
    },
) => {
    return useQuery({
        queryKey: rdaKeys.generation(id || ''),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<RDAGeneration>>(`/rda/${id}`);
            return data.data;
        },
        enabled: Boolean(id) && (options?.enabled ?? true),
        refetchInterval: options?.refetchInterval ?? false,
    });
};

export const useRDAs = (projectId: string) => {
    return useQuery({
        queryKey: rdaKeys.projectList(projectId),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<RDAGeneration[]>>(`/rda/project/${projectId}`);
            return data.data;
        },
        enabled: !!projectId,
    });
};

export const useDownloadRDA = () => {
    return useMutation({
        mutationFn: async (id: string) => {
            const response = await api.get(`/rda/${id}/download`, {
                responseType: 'blob',
            });

            const blob = new Blob([response.data], {
                type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            });

            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `rda-${id}.docx`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        },
    });
};

export const useDeleteRDA = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const { data } = await api.delete<ApiResponse<{ success: boolean }>>(`/rda/${id}`);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: rdaKeys.all });
        },
    });
};

export const useRetryRDA = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const { data } = await api.post<ApiResponse<RDAGeneration>>(`/rda/${id}/retry`);
            return data.data;
        },
        onSuccess: (generation) => {
            queryClient.invalidateQueries({ queryKey: rdaKeys.projectList(generation.projectId) });
            queryClient.setQueryData(rdaKeys.generation(generation.id), generation);
        },
    });
};
