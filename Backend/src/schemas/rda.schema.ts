import { z } from 'zod';

// Parâmetros de ID genérico
export const idParamsSchema = z.object({
    id: z.string().min(1),
});

// Query para listar documentos
export const documentQuerySchema = z.object({
    projectId: z.string().min(1, 'projectId é obrigatório'),
});

// Body do upload de documento (campos do multipart, exceto o arquivo)
export const documentUploadFieldsSchema = z.object({
    projectId: z.string().min(1, 'projectId é obrigatório'),
    uploadedBy: z.string().min(1, 'uploadedBy é obrigatório'),
});

// Body do sync de Wiki
export const wikiSyncSchema = z.object({
    projectId: z.string().min(1, 'projectId é obrigatório'),
});

// Query para listar páginas Wiki
export const wikiPagesQuerySchema = z.object({
    projectId: z.string().min(1, 'projectId é obrigatório'),
});

// Query para buscar conteúdo Wiki
export const wikiSearchQuerySchema = z.object({
    projectId: z.string().min(1, 'projectId é obrigatório'),
    query: z.string().min(1, 'query é obrigatório'),
});
