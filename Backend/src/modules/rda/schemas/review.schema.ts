import { z } from 'zod';
import {
    EvidenceSchema,
    ValidationIssueSchema,
    type Evidence,
    type GenerationMetadata,
    type ValidationIssue,
    type ValidationReport,
} from '@/modules/rda/schemas/generation.schema';

export interface FieldOverride {
    fieldName: string;
    sectionName: string;
    activityIndex?: number;
    responsibleIndex?: number;
    originalValue: unknown;
    newValue: unknown;
    reason?: string;
    editedAt: string;
    editedBy?: string;
}

export const FieldOverrideSchema = z.object({
    fieldName: z.string().min(1),
    sectionName: z.string().min(1),
    activityIndex: z.number().int().min(0).optional(),
    responsibleIndex: z.number().int().min(0).optional(),
    originalValue: z.unknown(),
    newValue: z.unknown(),
    reason: z.string().max(500).optional(),
    editedAt: z.string().datetime().or(z.string().min(1)),
    editedBy: z.string().optional(),
});

export interface OverridesMap {
    [fieldKey: string]: FieldOverride;
}

export const OverridesMapSchema = z.record(z.string(), FieldOverrideSchema);

export interface ReviewField {
    fieldKey: string;
    fieldName: string;
    sectionName: string;
    activityIndex?: number;
    responsibleIndex?: number;
    label: string;
    value: unknown;
    originalValue: unknown;
    confidence: number;
    status: 'filled' | 'pending' | 'no_data';
    evidence: Evidence[];
    issues: ValidationIssue[];
    hasOverride: boolean;
    override?: FieldOverride;
    isRequired: boolean;
    fieldType: 'simple' | 'activity' | 'responsible';
}

export const ReviewFieldSchema = z.object({
    fieldKey: z.string().min(1),
    fieldName: z.string().min(1),
    sectionName: z.string().min(1),
    activityIndex: z.number().int().min(0).optional(),
    responsibleIndex: z.number().int().min(0).optional(),
    label: z.string().min(1),
    value: z.unknown(),
    originalValue: z.unknown(),
    confidence: z.number().min(0).max(1),
    status: z.enum(['filled', 'pending', 'no_data']),
    evidence: z.array(EvidenceSchema),
    issues: z.array(ValidationIssueSchema),
    hasOverride: z.boolean(),
    override: FieldOverrideSchema.optional(),
    isRequired: z.boolean(),
    fieldType: z.enum(['simple', 'activity', 'responsible']),
});

export interface ReviewSection {
    sectionName: string;
    label: string;
    fields: ReviewField[];
    sectionScore: number;
    totalFields: number;
    filledFields: number;
    pendingFields: number;
    overriddenFields: number;
    issueCount: {
        errors: number;
        warnings: number;
        info: number;
    };
}

export const ReviewSectionSchema = z.object({
    sectionName: z.string().min(1),
    label: z.string().min(1),
    fields: z.array(ReviewFieldSchema),
    sectionScore: z.number().min(0).max(1),
    totalFields: z.number().int().min(0),
    filledFields: z.number().int().min(0),
    pendingFields: z.number().int().min(0),
    overriddenFields: z.number().int().min(0),
    issueCount: z.object({
        errors: z.number().int().min(0),
        warnings: z.number().int().min(0),
        info: z.number().int().min(0),
    }),
});

export interface ReviewData {
    generationId: string;
    projectId: string;
    period: { month: number; year: number };
    status: string;
    overallScore: number;
    sections: ReviewSection[];
    validationReport: ValidationReport;
    metadata: GenerationMetadata | null;
    overrides: OverridesMap;
    hasDocx: boolean;
    docxPath?: string;
    qualityAlert: boolean;
    editPercentage: number;
    createdAt: string;
    updatedAt: string;
}

export const SaveOverrideRequestSchema = z.object({
    fieldKey: z.string().min(1),
    newValue: z.unknown(),
    reason: z.string().max(500).optional(),
});

export type SaveOverrideRequest = z.infer<typeof SaveOverrideRequestSchema>;

export const SaveBatchOverridesRequestSchema = z.object({
    overrides: z.array(SaveOverrideRequestSchema).min(1).max(50),
});

export type SaveBatchOverridesRequest = z.infer<typeof SaveBatchOverridesRequestSchema>;

export const ReprocessSectionRequestSchema = z.object({
    sections: z.array(z.enum(['dados_projeto', 'atividades', 'resultados'])).min(1).max(3),
    reason: z.string().max(500).optional(),
});

export type ReprocessSectionRequest = z.infer<typeof ReprocessSectionRequestSchema>;

export const FinalizeReviewRequestSchema = z.object({
    saveAsExample: z.boolean().optional().default(false),
});

export type FinalizeReviewRequest = z.infer<typeof FinalizeReviewRequestSchema>;
