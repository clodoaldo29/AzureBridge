import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';

interface ApiResponse<T> {
    success: boolean;
    data: T;
}

export interface RAGSearchResult {
    id: string;
    content: string;
    metadata: Record<string, unknown>;
    sourceType: string;
    score: number;
    matchType: 'vector' | 'fulltext' | 'hybrid';
}

export interface ChunkStats {
    totalChunks: number;
    chunksBySourceType: Record<string, number>;
    avgTokensPerChunk: number;
    totalTokens: number;
}

export const ragKeys = {
    all: ['rda-rag'] as const,
    chunkStats: (projectId: string) => [...ragKeys.all, 'chunk-stats', projectId] as const,
};

export function useRAGSearch() {
    return useMutation({
        mutationFn: async (payload: {
            projectId: string;
            query: string;
            topK?: number;
            sourceTypes?: string[];
            minScore?: number;
        }) => {
            const { data } = await api.post<ApiResponse<RAGSearchResult[]>>('/rda/search', payload);
            return data.data;
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Falha ao executar busca no RAG.';
            toast({
                title: 'Busca RAG falhou',
                description: message,
                variant: 'destructive',
            });
        },
    });
}

export function useChunkStats(projectId: string, enabled = true) {
    return useQuery({
        queryKey: ragKeys.chunkStats(projectId),
        queryFn: async () => {
            const { data } = await api.get<ApiResponse<ChunkStats>>(`/rda/chunks/stats/${projectId}`);
            return data.data;
        },
        enabled: Boolean(projectId) && enabled,
    });
}
