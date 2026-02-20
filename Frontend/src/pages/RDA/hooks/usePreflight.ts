import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';

export interface MonthPeriod {
    month: number;
    year: number;
}

export interface PlaceholderInfo {
    name: string;
    type: 'simple' | 'loop' | 'nested_loop';
    required: boolean;
    section: string;
    guideType?: string;
    description?: string;
    sourceHint?: string;
    rules?: string[];
    loopVariable?: string;
    childPlaceholders?: PlaceholderInfo[];
}

export interface PreflightCheck {
    name: string;
    key: string;
    status: 'pass' | 'fail' | 'warn' | 'skip';
    severity: 'critical' | 'warning' | 'info';
    message: string;
    details?: Record<string, unknown>;
    action?: string;
    duration?: number;
}

export interface PreflightConfig {
    projectId: string;
    period: MonthPeriod;
    templateId?: string;
    options?: {
        skipWikiCheck?: boolean;
        allowPartialData?: boolean;
        dryRun?: boolean;
    };
}

export interface PreflightResult {
    projectId: string;
    period: string;
    status: 'approved' | 'blocked' | 'warning';
    checks: PreflightCheck[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        warnings: number;
        skipped: number;
    };
    blockers: string[];
    warnings: string[];
    generationReady?: {
        generationId: string;
        templateId: string;
        templatePath: string;
        periodKey: string;
        context: Record<string, unknown>;
    };
    duration: number;
}

interface ApiResponse<T> {
    success: boolean;
    data: T;
    error?: string;
}

const preflightKeys = {
    dryRun: (projectId: string, period: MonthPeriod) => ['preflight-dryrun', projectId, period.year, period.month] as const,
    readiness: (projectId: string, period: string) => ['preflight-readiness', projectId, period] as const,
    templateInfo: (projectId: string) => ['preflight-template', projectId] as const,
    fillingGuide: (projectId: string) => ['preflight-guide', projectId] as const,
};

export function useRunPreflight() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (config: PreflightConfig) => {
            const { data } = await api.post<ApiResponse<PreflightResult>>('/rda/preflight/run', config);
            return data.data;
        },
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: preflightKeys.readiness(result.projectId, result.period) });
        },
    });
}

export function useDryRun(projectId: string, period: MonthPeriod, enabled = false) {
    return useQuery({
        queryKey: preflightKeys.dryRun(projectId, period),
        queryFn: async () => {
            const { data } = await api.post<ApiResponse<PreflightResult>>('/rda/preflight/dry-run', {
                projectId,
                period,
            });
            return data.data;
        },
        enabled: enabled && Boolean(projectId),
        staleTime: 30_000,
    });
}

export function useReadiness(projectId: string, period: string, enabled = true, refetchInterval?: number | false) {
    return useQuery({
        queryKey: preflightKeys.readiness(projectId, period),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<{ ready: boolean; issues: string[]; warnings: string[] }>>(
                `/rda/preflight/readiness/${projectId}/${period}`,
            );
            return data.data;
        },
        enabled: enabled && Boolean(projectId) && Boolean(period),
        staleTime: 60_000,
        refetchInterval,
    });
}

export function useTemplateInfo(projectId: string) {
    return useQuery({
        queryKey: preflightKeys.templateInfo(projectId),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<{ template: Record<string, unknown>; placeholders: PlaceholderInfo[] }>>(
                `/rda/preflight/template-info/${projectId}`,
            );
            return data.data;
        },
        enabled: Boolean(projectId),
        retry: false,
    });
}

export function useFillingGuide(projectId: string) {
    return useQuery({
        queryKey: preflightKeys.fillingGuide(projectId),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<{ content: string; placeholderCount: number }>>(
                `/rda/preflight/filling-guide/${projectId}`,
            );
            return data.data;
        },
        enabled: Boolean(projectId),
    });
}
