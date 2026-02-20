import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import axios from 'axios';

interface ApiResponse<T> {
    success: boolean;
    data: T;
    error?: string;
    message?: string;
}

export interface MonthPeriod {
    month: number;
    year: number;
}

export interface MonthlyPreparationConfig {
    projectId: string;
    period: MonthPeriod;
    includeWiki?: boolean;
    includeOperationalSync?: boolean;
    syncMode?: 'none' | 'incremental' | 'full';
    forceReprocessChunks?: boolean;
    forceReprocess?: boolean;
    refreshProjectContext?: boolean;
}

export interface MonthlyPreparationStatus {
    snapshotId: string;
    projectId: string;
    period: string;
    status: 'collecting' | 'ready' | 'failed';
    step: string;
    progress: number;
    updatedAt: string;
    workItemsStatus: 'pending' | 'collecting' | 'done' | 'error';
    sprintsStatus: 'pending' | 'collecting' | 'done' | 'error';
    wikiStatus: 'pending' | 'collecting' | 'done' | 'error';
    documentsStatus: 'pending' | 'collecting' | 'done' | 'error';
    contextStatus: 'pending' | 'collecting' | 'done' | 'error';
    counters: {
        workItemsTotal: number;
        workItemsNew: number;
        workItemsClosed: number;
        workItemsActive: number;
        sprintsCount: number;
        wikiPagesUpdated: number;
        documentsUploaded: number;
        chunksCreated: number;
    };
    errors: Array<{ source: string; message: string; timestamp: string }>;
}

export interface MonthlyWorkItemFilters {
    type?: string;
    state?: string;
    assignedTo?: string;
    page?: number;
    pageSize?: number;
}

const monthlyKeys = {
    snapshots: (projectId: string) => ['monthly-snapshots', projectId] as const,
    status: (projectId: string, period: string) => ['monthly-status', projectId, period] as const,
    snapshot: (projectId: string, period: string) => ['monthly-snapshot', projectId, period] as const,
    workItems: (projectId: string, period: string, filters: MonthlyWorkItemFilters) => ['monthly-workitems', projectId, period, filters] as const,
    sprints: (projectId: string, period: string) => ['monthly-sprints', projectId, period] as const,
};

export function toPeriodKey(period: MonthPeriod): string {
    return `${period.year}-${String(period.month).padStart(2, '0')}`;
}

export function useStartPreparation() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (config: MonthlyPreparationConfig) => {
            const { data } = await api.post<ApiResponse<{ snapshotId: string; periodKey: string }>>('/rda/monthly/prepare', config, {
                timeout: 120000,
            });
            return data.data;
        },
        onSuccess: (result, variables) => {
            queryClient.invalidateQueries({ queryKey: monthlyKeys.snapshots(variables.projectId) });
            queryClient.invalidateQueries({ queryKey: monthlyKeys.status(variables.projectId, result.periodKey) });
            queryClient.invalidateQueries({ queryKey: monthlyKeys.snapshot(variables.projectId, result.periodKey) });
        },
    });
}

export function usePreparationStatus(projectId: string, period: string, enabled = false) {
    return useQuery({
        queryKey: monthlyKeys.status(projectId, period),
        queryFn: async () => {
            try {
                const { data } = await api.get<ApiResponse<MonthlyPreparationStatus>>(`/rda/monthly/status/${projectId}/${period}`);
                return data.data;
            } catch (error: unknown) {
                const statusCode = (error as { response?: { status?: number } })?.response?.status;
                if (statusCode === 404) {
                    return null;
                }
                throw error;
            }
        },
        enabled: enabled && Boolean(projectId) && Boolean(period),
        refetchInterval: (query) => {
            const status = query.state.data?.status;
            if (query.state.data == null) {
                return 2000;
            }
            return status === 'collecting' ? 2000 : false;
        },
    });
}

export function getApiErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
        const payload = error.response?.data as { error?: string; message?: string } | undefined;
        return payload?.error || payload?.message || error.message || 'Erro inesperado na requisicao.';
    }
    if (error instanceof Error) {
        return error.message;
    }
    return 'Erro inesperado na requisicao.';
}

export function useMonthlySnapshots(projectId: string) {
    return useQuery({
        queryKey: monthlyKeys.snapshots(projectId),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<Array<Record<string, unknown>>>>(`/rda/monthly/snapshots/${projectId}`);
            return data.data;
        },
        enabled: Boolean(projectId),
    });
}

export function useSnapshotDetail(projectId: string, period: string) {
    return useQuery({
        queryKey: monthlyKeys.snapshot(projectId, period),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<Record<string, unknown>>>(`/rda/monthly/snapshot/${projectId}/${period}`);
            return data.data;
        },
        enabled: Boolean(projectId) && Boolean(period),
    });
}

export function useMonthlyWorkItems(projectId: string, period: string, filters: MonthlyWorkItemFilters) {
    return useQuery({
        queryKey: monthlyKeys.workItems(projectId, period, filters),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<Record<string, unknown>>>(`/rda/monthly/workitems/${projectId}/${period}`, {
                params: filters,
            });
            return data.data;
        },
        enabled: Boolean(projectId) && Boolean(period),
    });
}

export function useMonthlySprints(projectId: string, period: string) {
    return useQuery({
        queryKey: monthlyKeys.sprints(projectId, period),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<Array<Record<string, unknown>>>>(`/rda/monthly/sprints/${projectId}/${period}`);
            return data.data;
        },
        enabled: Boolean(projectId) && Boolean(period),
    });
}

export function useDeletePreparation(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ period }: { period: string }) => {
            const { data } = await api.delete<ApiResponse<{ deleted: boolean; chunksRemoved: number }>>(`/rda/monthly/${projectId}/${period}`);
            return data.data;
        },
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: monthlyKeys.snapshots(projectId) });
            queryClient.invalidateQueries({ queryKey: monthlyKeys.status(projectId, variables.period) });
            queryClient.invalidateQueries({ queryKey: monthlyKeys.snapshot(projectId, variables.period) });
        },
    });
}

