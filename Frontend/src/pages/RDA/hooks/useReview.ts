import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';

interface ApiResponse<T> {
    success: boolean;
    data: T;
    error?: string;
}

export interface Evidence {
    sourceType: 'Document' | 'WikiPage' | 'WorkItem' | 'Sprint';
    sourceId: string;
    sourceName: string;
    location: string;
    snippet: string;
    url?: string;
    timestamp?: string;
}

export interface ValidationIssue {
    field: string;
    severity: 'error' | 'warning' | 'info';
    type: 'missing' | 'inconsistent' | 'low_confidence' | 'format' | 'contradiction' | 'out_of_period' | 'invalid_reference';
    message: string;
    suggestion: string;
    autoFixable: boolean;
}

export interface FieldOverride {
    fieldName: string;
    sectionName: string;
    activityIndex?: number;
    responsibleIndex?: number;
    originalValue: unknown;
    newValue: unknown;
    reason?: string;
    editedAt: string;
    editedBy?: string;
}

export interface ReviewField {
    fieldKey: string;
    fieldName: string;
    sectionName: 'dados_projeto' | 'atividades' | 'resultados';
    activityIndex?: number;
    responsibleIndex?: number;
    label: string;
    value: unknown;
    originalValue: unknown;
    confidence: number;
    status: 'filled' | 'pending' | 'no_data';
    evidence: Evidence[];
    issues: ValidationIssue[];
    hasOverride: boolean;
    override?: FieldOverride;
    isRequired: boolean;
    fieldType: 'simple' | 'activity' | 'responsible';
}

export interface ReviewSection {
    sectionName: 'dados_projeto' | 'atividades' | 'resultados';
    label: string;
    fields: ReviewField[];
    sectionScore: number;
    totalFields: number;
    filledFields: number;
    pendingFields: number;
    overriddenFields: number;
    issueCount: {
        errors: number;
        warnings: number;
        info: number;
    };
}

export interface ReviewData {
    generationId: string;
    projectId: string;
    period: { month: number; year: number };
    status: string;
    overallScore: number;
    sections: ReviewSection[];
    validationReport: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
    overrides: Record<string, FieldOverride>;
    hasDocx: boolean;
    docxPath?: string;
    qualityAlert: boolean;
    editPercentage: number;
    createdAt: string;
    updatedAt: string;
}

interface SaveOverrideInput {
    fieldKey: string;
    newValue: unknown;
    reason?: string;
}

interface ReprocessInput {
    sections: Array<'dados_projeto' | 'atividades' | 'resultados'>;
    reason?: string;
}

export function useReviewData(projectId: string, generationId: string | null, enabled = true) {
    return useQuery({
        queryKey: ['review-data', projectId, generationId],
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<ReviewData>>(`/rda/review/${projectId}/${generationId}`);
            return data.data;
        },
        enabled: Boolean(projectId) && Boolean(generationId) && enabled,
    });
}

export function useSaveOverride(projectId: string, generationId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (input: SaveOverrideInput) => {
            const { data } = await api.put<ApiResponse<ReviewData>>(`/rda/review/${projectId}/${generationId}/overrides`, input);
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-data', projectId, generationId] });
        },
    });
}

export function useRemoveOverride(projectId: string, generationId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (fieldKey: string) => {
            const encoded = encodeURIComponent(fieldKey);
            const { data } = await api.delete<ApiResponse<ReviewData>>(`/rda/review/${projectId}/${generationId}/overrides/${encoded}`);
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-data', projectId, generationId] });
        },
    });
}

export function useReprocessSections(projectId: string, generationId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (input: ReprocessInput) => {
            const { data } = await api.post<ApiResponse<{ generationId: string; sections: string[]; validationScore: number }>>(
                `/rda/review/${projectId}/${generationId}/reprocess`,
                input,
            );
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-data', projectId, generationId] });
            queryClient.invalidateQueries({ queryKey: ['generation-details', generationId] });
            queryClient.invalidateQueries({ queryKey: ['generation-progress', generationId] });
        },
    });
}

export function useFinalizeReview(projectId: string, generationId: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (saveAsExample: boolean) => {
            const { data } = await api.post<ApiResponse<{ generationId: string; filePath: string }>>(
                `/rda/review/${projectId}/${generationId}/finalize`,
                { saveAsExample },
            );
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['review-data', projectId, generationId] });
            queryClient.invalidateQueries({ queryKey: ['generation-details', generationId] });
            queryClient.invalidateQueries({ queryKey: ['generation-progress', generationId] });
        },
    });
}
