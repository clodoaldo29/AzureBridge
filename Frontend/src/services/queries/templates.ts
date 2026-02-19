import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { ApiResponse, RDATemplate } from '@/types';

export const templateKeys = {
    all: ['rdaTemplates'] as const,
    details: (id: string) => [...templateKeys.all, 'detail', id] as const,
};

export const useTemplates = () => {
    return useQuery({
        queryKey: templateKeys.all,
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<RDATemplate[]>>('/rda/templates');
            return data.data;
        },
    });
};

export const useUploadTemplate = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: {
            projectId: string;
            file: File;
            name: string;
            description?: string;
            uploadedBy: string;
        }) => {
            const formData = new FormData();
            formData.append('projectId', payload.projectId);
            formData.append('name', payload.name);
            if (payload.description) {
                formData.append('description', payload.description);
            }
            formData.append('uploadedBy', payload.uploadedBy);
            formData.append('file', payload.file);

            const { data } = await api.post<ApiResponse<RDATemplate>>('/rda/templates/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: templateKeys.all });
        },
    });
};

export const useActivateTemplate = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const { data } = await api.put<ApiResponse<RDATemplate>>(`/rda/templates/${id}/activate`);
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: templateKeys.all });
        },
    });
};

export const useDeleteTemplate = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            await api.delete<ApiResponse<{ success: boolean }>>(`/rda/templates/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: templateKeys.all });
        },
    });
};
