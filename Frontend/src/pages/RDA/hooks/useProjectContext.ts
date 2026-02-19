import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';

interface ApiResponse<T> {
    success: boolean;
    data: T;
}

export interface ProjectContextData {
    projectName: string;
    projectScope: string;
    objectives: Array<{ description: string; priority: 'alta' | 'media' | 'baixa' }>;
    teamMembers: Array<{ name: string; role: string; area: string }>;
    technologies: Array<{ name: string; category: 'frontend' | 'backend' | 'database' | 'infrastructure' | 'tool' | 'other'; version?: string }>;
    keyMilestones: Array<{ name: string; date?: string; deliverable: string; status: 'planejado' | 'em_andamento' | 'concluido' | 'atrasado' }>;
    businessRules: Array<{ id: string; description: string; area: string; priority: 'alta' | 'media' | 'baixa' }>;
    deliveryPlan: Array<{ phase: string; startDate?: string; endDate?: string; objectives: string[]; deliverables: string[] }>;
    stakeholders: Array<{ name: string; role: string; organization: string; contact?: string }>;
    summary?: string;
}

export const contextKeys = {
    all: ['rda-context'] as const,
    byProject: (projectId: string) => [...contextKeys.all, projectId] as const,
};

export function useProjectContext(projectId: string) {
    return useQuery({
        queryKey: contextKeys.byProject(projectId),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<ProjectContextData | null>>(`/rda/context/${projectId}`);
            return data.data;
        },
        enabled: Boolean(projectId),
    });
}

export function useRebuildContext(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload?: {
            documentTypeMappings?: Array<{
                documentType: 'visao' | 'plano_trabalho' | 'delivery_plan' | 'requisitos' | 'regras_negocio' | 'prototipagem' | 'outro';
                fieldsToExtract?: string[];
                searchQueries?: string[];
            }>;
        }) => {
            const { data } = await api.post<ApiResponse<ProjectContextData>>(`/rda/context/${projectId}/rebuild`, payload ?? {});
            return data.data;
        },
        onSuccess: () => {
            toast({
                title: 'Contexto reconstruido',
                description: 'ProjectContext atualizado com sucesso.',
            });
            queryClient.invalidateQueries({ queryKey: contextKeys.byProject(projectId) });
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Falha ao reconstruir o contexto.';
            toast({
                title: 'Falha ao reconstruir',
                description: message,
                variant: 'destructive',
            });
        },
    });
}

export function useUpdateContext(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: Partial<ProjectContextData>) => {
            const { data } = await api.put<ApiResponse<ProjectContextData>>(`/rda/context/${projectId}`, payload);
            return data.data;
        },
        onSuccess: () => {
            toast({
                title: 'Contexto atualizado',
                description: 'Alteracoes salvas no ProjectContext.',
            });
            queryClient.invalidateQueries({ queryKey: contextKeys.byProject(projectId) });
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Falha ao atualizar contexto.';
            toast({
                title: 'Falha ao atualizar',
                description: message,
                variant: 'destructive',
            });
        },
    });
}
