import { z } from 'zod';

export const EvidenceSchema = z.object({
    sourceType: z.enum(['Document', 'WikiPage', 'WorkItem', 'Sprint']),
    sourceId: z.string().min(1),
    sourceName: z.string().min(1),
    location: z.string().min(1),
    snippet: z.string().max(300),
    url: z.string().url().optional(),
    timestamp: z.string().optional(),
});

export type Evidence = z.infer<typeof EvidenceSchema>;

export const RDAFieldResultSchema = z.object({
    fieldName: z.string().min(1),
    value: z.unknown(),
    evidence: z.array(EvidenceSchema),
    confidence: z.number().min(0).max(1),
    status: z.enum(['filled', 'pending', 'no_data']),
    contextUsed: z.array(z.string()),
});

export type RDAFieldResult = z.infer<typeof RDAFieldResultSchema>;

export const SectionExtractionResultSchema = z.object({
    sectionName: z.string().min(1),
    fields: z.array(RDAFieldResultSchema),
    chunksQueried: z.number().int().min(0),
    tokensUsed: z.object({ input: z.number().int().min(0), output: z.number().int().min(0) }),
    duration: z.number().int().min(0),
});

export type SectionExtractionResult = z.infer<typeof SectionExtractionResultSchema>;

export const ExtractionOutputSchema = z.object({
    sections: z.array(SectionExtractionResultSchema),
    totalTokens: z.object({ input: z.number().int().min(0), output: z.number().int().min(0) }),
    totalDuration: z.number().int().min(0),
});

export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

export const NormalizedFieldResultSchema = RDAFieldResultSchema.extend({
    originalValue: z.unknown(),
    normalizedValue: z.unknown(),
    normalizationNotes: z.string().optional(),
});

export type NormalizedFieldResult = z.infer<typeof NormalizedFieldResultSchema>;

export const NormalizedSectionResultSchema = z.object({
    sectionName: z.string().min(1),
    fields: z.array(NormalizedFieldResultSchema),
    tokensUsed: z.object({ input: z.number().int().min(0), output: z.number().int().min(0) }),
    duration: z.number().int().min(0),
});

export const NormalizationOutputSchema = z.object({
    sections: z.array(NormalizedSectionResultSchema),
    totalTokens: z.object({ input: z.number().int().min(0), output: z.number().int().min(0) }),
    totalDuration: z.number().int().min(0),
});

export type NormalizationOutput = z.infer<typeof NormalizationOutputSchema>;

export const ValidationIssueSchema = z.object({
    field: z.string().min(1),
    severity: z.enum(['error', 'warning', 'info']),
    type: z.enum(['missing', 'inconsistent', 'low_confidence', 'format', 'contradiction', 'out_of_period', 'invalid_reference']),
    message: z.string().min(1),
    suggestion: z.string().min(1),
    autoFixable: z.boolean(),
});

export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ValidationReportSchema = z.object({
    overallScore: z.number().min(0).max(1),
    totalFields: z.number().int().min(0),
    filledFields: z.number().int().min(0),
    pendingFields: z.number().int().min(0),
    emptyFields: z.number().int().min(0),
    issues: z.array(ValidationIssueSchema),
    approved: z.boolean(),
    retryable: z.boolean(),
    retryRecommendations: z.object({
        sections: z.array(z.string()),
        reason: z.string(),
    }).optional(),
    duration: z.number().int().min(0),
});

export type ValidationReport = z.infer<typeof ValidationReportSchema>;

export const ResponsavelDataSchema = z.object({
    NOME_RESPONSAVEL: z.string(),
    CPF_RESPONSAVEL: z.string(),
    JUSTIFICATIVA_RESPONSAVEL: z.string(),
});

export type ResponsavelData = z.infer<typeof ResponsavelDataSchema>;

export const AtividadeDataSchema = z.object({
    NUMERO_ATIVIDADE: z.string(),
    NOME_ATIVIDADE: z.string(),
    PERIODO_ATIVIDADE: z.string(),
    DESCRICAO_ATIVIDADE: z.string(),
    JUSTIFICATIVA_ATIVIDADE: z.string(),
    RESULTADO_OBTIDO_ATIVIDADE: z.string(),
    DISPENDIOS_ATIVIDADE: z.string(),
    RESPONSAVEIS: z.array(ResponsavelDataSchema),
});

export type AtividadeData = z.infer<typeof AtividadeDataSchema>;

export const PlaceholderMapSchema = z.object({
    PROJETO_NOME: z.string().min(1),
    ANO_BASE: z.string().min(1),
    COMPETENCIA: z.string().min(1),
    COORDENADOR_TECNICO: z.string().min(1),
    RESULTADOS_ALCANCADOS: z.string().min(1),
    ATIVIDADES: z.array(AtividadeDataSchema).min(1),
}).passthrough();

export type PlaceholderMap = z.infer<typeof PlaceholderMapSchema>;

export const GenerationMetadataSchema = z.object({
    modelVersion: z.string(),
    schemaVersion: z.string(),
    templateId: z.string(),
    tokensUsed: z.object({
        extractor: z.object({ input: z.number().int().min(0), output: z.number().int().min(0) }),
        normalizer: z.object({ input: z.number().int().min(0), output: z.number().int().min(0) }),
        validator: z.object({ input: z.number().int().min(0), output: z.number().int().min(0) }),
        total: z.number().int().min(0),
    }),
    chunksUsed: z.array(z.string()),
    validationReport: ValidationReportSchema,
    duration: z.object({
        total: z.number().int().min(0),
        perStep: z.object({
            extractor: z.number().int().min(0),
            normalizer: z.number().int().min(0),
            validator: z.number().int().min(0),
            formatter: z.number().int().min(0),
            docxRender: z.number().int().min(0),
        }),
    }),
    retryCount: z.number().int().min(0),
    generatedAt: z.string(),
});

export type GenerationMetadata = z.infer<typeof GenerationMetadataSchema>;

export const GenerationJobPayloadSchema = z.object({
    generationId: z.string().min(1),
    projectId: z.string().min(1),
    templateId: z.string().min(1),
    periodKey: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export type GenerationJobPayload = z.infer<typeof GenerationJobPayloadSchema>;
