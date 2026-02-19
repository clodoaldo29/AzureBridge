import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../services/api';
import type { ApiResponse, WikiPage } from '../../../types';

export const wikiKeys = {
    all: ['wiki'] as const,
    lists: () => [...wikiKeys.all, 'list'] as const,
    list: (projectId: string) => [...wikiKeys.lists(), projectId] as const,
    search: (projectId: string, query: string) => [...wikiKeys.all, 'search', projectId, query] as const,
};

/**
 * Lista páginas Wiki de um projeto
 */
export const useWikiPages = (projectId: string) => {
    return useQuery({
        queryKey: wikiKeys.list(projectId),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<WikiPage[]>>('/rda/wiki/pages', {
                params: { projectId },
            });
            return data.data;
        },
        enabled: !!projectId,
    });
};

/**
 * Sincroniza páginas Wiki do Azure DevOps
 */
export const useSyncWiki = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (projectId: string) => {
            const { data } = await api.post<ApiResponse<{ synced: number; total: number }>>(
                '/rda/wiki/sync',
                { projectId },
            );
            return data.data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: wikiKeys.all });
        },
    });
};

/**
 * Busca conteúdo nas páginas Wiki
 */
export const useSearchWiki = (projectId: string, query: string) => {
    return useQuery({
        queryKey: wikiKeys.search(projectId, query),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<WikiPage[]>>('/rda/wiki/search', {
                params: { projectId, query },
            });
            return data.data;
        },
        enabled: !!projectId && !!query && query.length >= 2,
    });
};
