import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';

interface SetupStartPayload {
    documentTypeMappings?: Array<{ documentId: string; documentType: string }>;
    includeWiki?: boolean;
    forceReprocess?: boolean;
    syncOperationalData?: boolean;
    syncMode?: 'none' | 'incremental' | 'full';
}

interface SetupStartResponse {
    setupId: string;
    status: 'processing';
}

interface SetupStatusResponse {
    projectId: string;
    isSetupComplete: boolean;
    hasDocuments: boolean;
    documentsChunked: number;
    documentsTotal: number;
    hasWikiSync: boolean;
    wikiPagesChunked: number;
    hasProjectContext: boolean;
    operationalData?: {
        workItemsTotal: number;
        sprintsTotal: number;
        teamMembersTotal: number;
        capacitiesTotal: number;
    };
    totalChunks: number;
    progress?: {
        phase: string;
        currentStep: string;
        overallProgress: number;
        details?: Record<string, unknown>;
    } | null;
    jobStatus?: 'processing' | 'completed' | 'failed' | null;
    lastError?: string | null;
    lastResult?: unknown;
}

interface ApiResponse<T> {
    success: boolean;
    data: T;
    error?: string;
    message?: string;
}

export const setupKeys = {
    all: ['rda-setup'] as const,
    status: (projectId: string) => [...setupKeys.all, 'status', projectId] as const,
};

export function useSetupProject(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: SetupStartPayload) => {
            const { data } = await api.post<ApiResponse<SetupStartResponse>>(`/rda/setup/${projectId}`, payload);
            return data.data;
        },
        onSuccess: () => {
            toast({
                title: 'Setup iniciado',
                description: 'O processamento inicial do RAG foi iniciado para este projeto.',
            });
            queryClient.invalidateQueries({ queryKey: setupKeys.status(projectId) });
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Nao foi possivel iniciar o setup.';
            toast({
                title: 'Falha no setup',
                description: message,
                variant: 'destructive',
            });
        },
    });
}

export function useSetupStatus(projectId: string, pollWhileProcessing = true) {
    return useQuery({
        queryKey: setupKeys.status(projectId),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<SetupStatusResponse>>(`/rda/setup/${projectId}/status`);
            return data.data;
        },
        enabled: Boolean(projectId),
        refetchInterval: (query) => {
            if (!pollWhileProcessing) {
                return false;
            }

            const status = query.state.data?.jobStatus;
            return status === 'processing' ? 5000 : false;
        },
    });
}

export function useResetProject(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async () => {
            const { data } = await api.post<ApiResponse<{ chunksDeleted: number }>>(`/rda/setup/${projectId}/reset`);
            return data.data;
        },
        onSuccess: (result) => {
            toast({
                title: 'Setup resetado',
                description: `${result.chunksDeleted} chunk(s) removido(s).`,
            });
            queryClient.invalidateQueries({ queryKey: setupKeys.status(projectId) });
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Nao foi possivel resetar o setup.';
            toast({
                title: 'Falha ao resetar',
                description: message,
                variant: 'destructive',
            });
        },
    });
}
