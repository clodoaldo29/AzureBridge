import { z } from 'zod';

export const SOURCE_TYPES = ['document', 'wiki', 'workitem', 'sprint'] as const;
export const CONTENT_TYPES = ['text', 'table', 'list', 'code', 'mixed'] as const;
export const URL_TYPES = [
    'azure_devops_sprint',
    'azure_devops_wiki',
    'azure_devops_workitem',
    'azure_devops_deliveryplan',
    'figma',
    'sharepoint',
    'planner',
    'network_path',
    'other',
] as const;

export interface ChunkingOptions {
    targetSize: number;
    maxSize: number;
    overlap: number;
    separators: string[];
}

export interface ChunkMetadata {
    documentId?: string;
    wikiPageId?: string;
    documentName: string;
    pageNumber?: number;
    sectionHeading?: string;
    contentType: 'text' | 'table' | 'list' | 'code' | 'mixed';
    position: number;
    sourceType: 'document' | 'wiki' | 'workitem' | 'sprint';
    urls?: string[];
    urlTypes?: Array<{
        url: string;
        type:
            | 'azure_devops_sprint'
            | 'azure_devops_wiki'
            | 'azure_devops_workitem'
            | 'azure_devops_deliveryplan'
            | 'figma'
            | 'sharepoint'
            | 'planner'
            | 'network_path'
            | 'other';
    }>;
}

export interface DocumentChunkData {
    content: string;
    metadata: ChunkMetadata;
    chunkIndex: number;
    tokenCount: number;
}

export interface EmbeddingResult {
    text: string;
    embedding: number[];
    tokenCount: number;
}

export interface SearchResult {
    id: string;
    content: string;
    metadata: ChunkMetadata;
    sourceType: string;
    score: number;
    matchType: 'vector' | 'fulltext' | 'hybrid';
}

export interface SearchOptions {
    projectId: string;
    query: string;
    topK?: number;
    sourceTypes?: string[];
    minScore?: number;
    includeMetadata?: boolean;
}

export interface HybridSearchWeights {
    vectorWeight: number;
    fullTextWeight: number;
    rrfK: number;
}

export interface ExtractedTable {
    headers: string[];
    rows: string[][];
    pageNumber?: number;
    caption?: string;
}

export interface ExtractionResult {
    text: string;
    method: 'pdf-parse' | 'mammoth' | 'vision' | 'pizzip-xml';
    quality: number;
    pageCount?: number;
    warnings: string[];
    tables?: ExtractedTable[];
}

export interface IngestionResult {
    documentId: string;
    chunksCreated: number;
    embeddingsGenerated: number;
    extractionMethod: string;
    extractionQuality: number;
    warnings: string[];
    duration: number;
}

export interface IngestionProgress {
    documentId: string;
    step: 'extracting' | 'chunking' | 'embedding' | 'storing' | 'completed' | 'failed';
    progress: number;
    details?: string;
}

export interface ProjectContextData {
    projectName: string;
    projectScope: string;
    objectives: Array<{
        description: string;
        priority: 'alta' | 'media' | 'baixa';
    }>;
    teamMembers: Array<{
        name: string;
        role: string;
        area: string;
    }>;
    technologies: Array<{
        name: string;
        category: 'frontend' | 'backend' | 'database' | 'infrastructure' | 'tool' | 'other';
        version?: string;
    }>;
    keyMilestones: Array<{
        name: string;
        date?: string;
        deliverable: string;
        status: 'planejado' | 'em_andamento' | 'concluido' | 'atrasado';
    }>;
    businessRules: Array<{
        id: string;
        description: string;
        area: string;
        priority: 'alta' | 'media' | 'baixa';
    }>;
    deliveryPlan: Array<{
        phase: string;
        startDate?: string;
        endDate?: string;
        objectives: string[];
        deliverables: string[];
    }>;
    stakeholders: Array<{
        name: string;
        role: string;
        organization: string;
        contact?: string;
    }>;
    summary?: string;
}

export interface DocumentTypeMapping {
    documentType: 'visao' | 'plano_trabalho' | 'delivery_plan' | 'requisitos' | 'regras_negocio' | 'prototipagem' | 'outro';
    fieldsToExtract: Array<keyof ProjectContextData>;
    searchQueries: string[];
}

export interface WikiSyncResult {
    pagesProcessed: number;
    pagesNew: number;
    pagesUpdated: number;
    pagesUnchanged: number;
    chunksCreated: number;
    embeddingsGenerated: number;
    duration: number;
}

export const ChunkingOptionsSchema = z.object({
    targetSize: z.number().int().min(100).max(8000).default(1000),
    maxSize: z.number().int().min(100).max(12000).default(1500),
    overlap: z.number().int().min(0).max(2000).default(120),
    separators: z.array(z.string().min(1)).min(1).default(['\n## ', '\n### ', '\n\n', '\n', '. ']),
}).refine((v) => v.maxSize >= v.targetSize, {
    message: 'maxSize deve ser maior ou igual a targetSize',
    path: ['maxSize'],
});

export const ChunkMetadataSchema = z.object({
    documentId: z.string().min(1).optional(),
    wikiPageId: z.string().min(1).optional(),
    documentName: z.string().min(1),
    pageNumber: z.number().int().positive().optional(),
    sectionHeading: z.string().min(1).optional(),
    contentType: z.enum(CONTENT_TYPES),
    position: z.number().int().min(0),
    sourceType: z.enum(SOURCE_TYPES),
    urls: z.array(z.string().url()).optional(),
    urlTypes: z.array(z.object({
        url: z.string().min(1),
        type: z.enum(URL_TYPES),
    })).optional(),
});

export const DocumentChunkDataSchema = z.object({
    content: z.string().min(1),
    metadata: ChunkMetadataSchema,
    chunkIndex: z.number().int().min(0),
    tokenCount: z.number().int().min(0),
});

export const SearchOptionsSchema = z.object({
    projectId: z.string().min(1),
    query: z.string().min(2),
    topK: z.number().int().min(1).max(100).default(10),
    sourceTypes: z.array(z.string().min(1)).optional(),
    minScore: z.number().min(0).max(1).default(0),
    includeMetadata: z.boolean().default(true),
});

export const HybridSearchWeightsSchema = z.object({
    vectorWeight: z.number().min(0).max(1).default(0.7),
    fullTextWeight: z.number().min(0).max(1).default(0.3),
    rrfK: z.number().int().min(1).max(200).default(60),
}).refine((v) => Number((v.vectorWeight + v.fullTextWeight).toFixed(6)) === 1, {
    message: 'vectorWeight + fullTextWeight deve ser 1.0',
});

export const ProjectContextDataSchema = z.object({
    projectName: z.string().min(1),
    projectScope: z.string().min(1),
    objectives: z.array(z.object({
        description: z.string().min(1),
        priority: z.enum(['alta', 'media', 'baixa']),
    })).default([]),
    teamMembers: z.array(z.object({
        name: z.string().min(1),
        role: z.string().min(1),
        area: z.string().min(1),
    })).default([]),
    technologies: z.array(z.object({
        name: z.string().min(1),
        category: z.enum(['frontend', 'backend', 'database', 'infrastructure', 'tool', 'other']),
        version: z.string().min(1).optional(),
    })).default([]),
    keyMilestones: z.array(z.object({
        name: z.string().min(1),
        date: z.string().min(1).optional(),
        deliverable: z.string().min(1),
        status: z.enum(['planejado', 'em_andamento', 'concluido', 'atrasado']),
    })).default([]),
    businessRules: z.array(z.object({
        id: z.string().min(1),
        description: z.string().min(1),
        area: z.string().min(1),
        priority: z.enum(['alta', 'media', 'baixa']),
    })).default([]),
    deliveryPlan: z.array(z.object({
        phase: z.string().min(1),
        startDate: z.string().min(1).optional(),
        endDate: z.string().min(1).optional(),
        objectives: z.array(z.string().min(1)).default([]),
        deliverables: z.array(z.string().min(1)).default([]),
    })).default([]),
    stakeholders: z.array(z.object({
        name: z.string().min(1),
        role: z.string().min(1),
        organization: z.string().min(1),
        contact: z.string().min(1).optional(),
    })).default([]),
    summary: z.string().min(1).optional(),
});

export const IngestDocumentSchema = z.object({
    projectId: z.string().min(1),
    documentType: z.enum(['visao', 'plano_trabalho', 'delivery_plan', 'requisitos', 'regras_negocio', 'prototipagem', 'outro']),
});

export const SearchQuerySchema = z.object({
    projectId: z.string().min(1),
    query: z.string().min(2),
    topK: z.number().int().min(1).max(100).optional(),
    sourceTypes: z.array(z.enum(SOURCE_TYPES)).optional(),
    minScore: z.number().min(0).max(1).optional(),
});

export const SetupProjectSchema = z.object({
    projectId: z.string().min(1),
    documentTypeMappings: z.array(z.object({
        documentId: z.string().min(1),
        documentType: z.enum(['visao', 'plano_trabalho', 'delivery_plan', 'requisitos', 'regras_negocio', 'prototipagem', 'outro']),
    })).optional(),
    includeWiki: z.boolean().optional(),
    forceReprocess: z.boolean().optional(),
    syncOperationalData: z.boolean().optional(),
    syncMode: z.enum(['none', 'incremental', 'full']).optional(),
});

export type ChunkingOptionsInput = z.infer<typeof ChunkingOptionsSchema>;
export type SearchOptionsInput = z.infer<typeof SearchOptionsSchema>;
export type ProjectContextDataInput = z.infer<typeof ProjectContextDataSchema>;
export type IngestDocumentInput = z.infer<typeof IngestDocumentSchema>;
export type SearchQueryInput = z.infer<typeof SearchQuerySchema>;
export type SetupProjectInput = z.infer<typeof SetupProjectSchema>;
