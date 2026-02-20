import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import type { ApiResponse } from '@/types';
import { templateKeys } from '@/services/queries/templates';
import type { GenerateTemplateResponse, PlaceholderDefinition } from '../types';

interface GenerateTemplatePayload {
    analysisId?: string;
    projectId?: string;
    name?: string;
    placeholderOverrides?: PlaceholderDefinition[];
    files?: File[];
}

export const useGenerateTemplate = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: GenerateTemplatePayload) => {
            if (payload.files && payload.files.length > 0) {
                const formData = new FormData();
                payload.files.forEach((file) => {
                    formData.append('file', file);
                });

                if (payload.analysisId) {
                    formData.append('analysisId', payload.analysisId);
                }

                if (payload.projectId) {
                    formData.append('projectId', payload.projectId);
                }

                if (payload.name) {
                    formData.append('name', payload.name);
                }

                if (payload.placeholderOverrides) {
                    formData.append('placeholderOverrides', JSON.stringify(payload.placeholderOverrides));
                }

                const { data } = await api.post<ApiResponse<GenerateTemplateResponse>>('/rda/template-factory/generate', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    timeout: 600000,
                });

                return data.data;
            }

            const { data } = await api.post<ApiResponse<GenerateTemplateResponse>>('/rda/template-factory/generate', {
                analysisId: payload.analysisId,
                projectId: payload.projectId,
                name: payload.name,
                placeholderOverrides: payload.placeholderOverrides,
            });

            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: templateKeys.all });
        },
    });
};
