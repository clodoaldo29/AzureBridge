import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { toast } from '@/hooks/use-toast';
import { documentKeys } from '@/features/rda/queries/documents';
import { wikiKeys } from '@/features/rda/queries/wiki';
import { ragKeys } from './useRAGSearch';

interface ApiResponse<T> {
    success: boolean;
    data: T;
}

interface IngestionResult {
    documentId: string;
    chunksCreated: number;
    embeddingsGenerated: number;
    extractionMethod: string;
    extractionQuality: number;
    warnings: string[];
    duration: number;
}

interface WikiSyncResult {
    pagesProcessed: number;
    pagesNew: number;
    pagesUpdated: number;
    pagesUnchanged: number;
    chunksCreated: number;
    embeddingsGenerated: number;
    duration: number;
}

export function useIngestDocument(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (payload: {
            documentId: string;
            documentType?: 'visao' | 'plano_trabalho' | 'delivery_plan' | 'requisitos' | 'regras_negocio' | 'prototipagem' | 'outro';
            forceReprocess?: boolean;
        }) => {
            const { data } = await api.post<ApiResponse<IngestionResult>>(`/rda/documents/${payload.documentId}/ingest`, {
                documentType: payload.documentType,
                forceReprocess: payload.forceReprocess,
            });
            return data.data;
        },
        onSuccess: (result) => {
            toast({
                title: 'Documento ingerido',
                description: `${result.chunksCreated} chunk(s) processado(s) no documento.`,
            });
            queryClient.invalidateQueries({ queryKey: documentKeys.list(projectId) });
            queryClient.invalidateQueries({ queryKey: ragKeys.chunkStats(projectId) });
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Falha ao ingerir documento.';
            toast({
                title: 'Falha na ingestao',
                description: message,
                variant: 'destructive',
            });
        },
    });
}

export function useIngestWiki(projectId: string) {
    const queryClient = useQueryClient();

    return useMutation<WikiSyncResult, Error, boolean | undefined>({
        mutationFn: async (forceReprocess = false) => {
            const { data } = await api.post<ApiResponse<WikiSyncResult>>('/rda/wiki/ingest', {
                projectId,
                forceReprocess,
            }, {
                timeout: 300000, // 5 min para ingestao de wiki/chunks
            });
            return data.data;
        },
        onSuccess: (result) => {
            toast({
                title: 'Wiki ingerida',
                description: `${result.pagesProcessed} pagina(s) processada(s).`,
            });
            queryClient.invalidateQueries({ queryKey: wikiKeys.list(projectId) });
            queryClient.invalidateQueries({ queryKey: ragKeys.chunkStats(projectId) });
        },
        onError: (error: unknown) => {
            const message = error instanceof Error ? error.message : 'Falha ao ingerir wiki.';
            toast({
                title: 'Falha na wiki',
                description: message,
                variant: 'destructive',
            });
        },
    });
}
