import { useMutation } from '@tanstack/react-query';
import type { AxiosProgressEvent } from 'axios';
import { api } from '@/services/api';
import type { ApiResponse } from '@/types';
import type { AnalyzeModelsResponse } from '../types';

interface AnalyzeModelsPayload {
    files: File[];
    projectId?: string;
    onUploadProgress?: (percentage: number) => void;
}

export const useAnalyzeModels = () => {
    return useMutation({
        mutationFn: async (payload: AnalyzeModelsPayload) => {
            const formData = new FormData();
            payload.files.forEach((file) => {
                formData.append('file', file);
            });

            if (payload.projectId) {
                formData.append('projectId', payload.projectId);
            }

            const { data } = await api.post<ApiResponse<AnalyzeModelsResponse>>('/rda/template-factory/analyze', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 600000,
                onUploadProgress: (event: AxiosProgressEvent) => {
                    if (!payload.onUploadProgress) {
                        return;
                    }

                    if (!event.total || event.total <= 0) {
                        payload.onUploadProgress(0);
                        return;
                    }

                    payload.onUploadProgress(Math.round((event.loaded / event.total) * 100));
                },
            });

            return data.data;
        },
    });
};
