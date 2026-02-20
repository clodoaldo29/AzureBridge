import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';
import type { ApiResponse, Document } from '../../../types';
import type { AxiosProgressEvent } from 'axios';

export const documentKeys = {
    all: ['documents'] as const,
    lists: () => [...documentKeys.all, 'list'] as const,
    list: (projectId: string) => [...documentKeys.lists(), projectId] as const,
};

/**
 * Lista documentos de um projeto
 */
export const useDocuments = (projectId: string) => {
    return useQuery({
        queryKey: documentKeys.list(projectId),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<Document[]>>('/rda/documents', {
                params: { projectId },
            });
            return data.data;
        },
        enabled: !!projectId,
    });
};

/**
 * Upload de documento (multipart/form-data)
 */
export const useUploadDocument = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (params: {
            projectId: string;
            file: File;
            uploadedBy: string;
            onProgress?: (percentage: number) => void;
        }) => {
            const formData = new FormData();
            formData.append('projectId', params.projectId);
            formData.append('uploadedBy', params.uploadedBy);
            formData.append('file', params.file);

            const { data } = await api.post<ApiResponse<Document>>('/rda/documents', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 600000, // 10 min para upload + extracao de texto
                onUploadProgress: (event: AxiosProgressEvent) => {
                    if (!params.onProgress) {
                        return;
                    }

                    if (!event.total || event.total <= 0) {
                        params.onProgress(0);
                        return;
                    }

                    const percentage = Math.round((event.loaded / event.total) * 100);
                    params.onProgress(percentage);
                },
            });
            return data.data;
        },
        onSuccess: (_data, variables) => {
            queryClient.invalidateQueries({
                queryKey: documentKeys.list(variables.projectId),
            });
        },
    });
};

/**
 * Deletar documento
 */
export const useDeleteDocument = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (id: string) => {
            const { data } = await api.delete<ApiResponse<{ deleted: string }>>(`/rda/documents/${id}`);
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: documentKeys.all });
        },
    });
};
