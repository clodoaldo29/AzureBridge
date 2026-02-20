import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/database/client';
import { rdaDocxGeneratorService } from '@/modules/rda/services/docx-generator.service';
import { logger } from '@/utils/logger';
import {
    ExtractionOutputSchema,
    GenerationMetadataSchema,
    type GenerationMetadata,
    type NormalizationOutput,
    NormalizationOutputSchema,
    PlaceholderMapSchema,
    type PlaceholderMap,
    type ValidationIssue,
    type ValidationReport,
    ValidationReportSchema,
} from '@/modules/rda/schemas/generation.schema';
import { GenerationContextSchema } from '@/modules/rda/schemas/preflight.schema';
import type {
    FieldOverride,
    OverridesMap,
    ReviewData,
    ReviewField,
    ReviewSection,
    SaveBatchOverridesRequest,
    SaveOverrideRequest,
} from '@/modules/rda/schemas/review.schema';

type ReviewSectionName = 'dados_projeto' | 'atividades' | 'resultados';

interface ParsedFieldKey {
    fieldName: string;
    activityIndex?: number;
    responsibleIndex?: number;
}

interface StoredReviewState {
    qualityAlert?: boolean;
    editPercentage?: number;
    lastFinalizedAt?: string;
    lastReprocessedAt?: string;
    lastReprocessReason?: string;
}

interface StoredPartialResults {
    context?: unknown;
    extraction?: unknown;
    normalization?: unknown;
    validationReport?: unknown;
    placeholderMap?: unknown;
    metadata?: unknown;
    review?: StoredReviewState;
}

type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;
type NormalizedField = z.infer<typeof NormalizationOutputSchema>['sections'][number]['fields'][number];

const REQUIRED_FIELDS = new Set([
    'PROJETO_NOME',
    'ANO_BASE',
    'COMPETENCIA',
    'COORDENADOR_TECNICO',
    'ATIVIDADES',
    'RESULTADOS_ALCANCADOS',
]);

const SIMPLE_FIELDS: Array<{ fieldName: string; label: string; section: ReviewSectionName }> = [
    { fieldName: 'PROJETO_NOME', label: 'Projeto', section: 'dados_projeto' },
    { fieldName: 'ANO_BASE', label: 'Ano Base', section: 'dados_projeto' },
    { fieldName: 'COMPETENCIA', label: 'Competencia', section: 'dados_projeto' },
    { fieldName: 'COORDENADOR_TECNICO', label: 'Coordenador Tecnico', section: 'dados_projeto' },
    { fieldName: 'RESULTADOS_ALCANCADOS', label: 'Resultados Alcancados', section: 'resultados' },
];

const ACTIVITY_FIELDS = [
    'NUMERO_ATIVIDADE',
    'NOME_ATIVIDADE',
    'PERIODO_ATIVIDADE',
    'DESCRICAO_ATIVIDADE',
    'JUSTIFICATIVA_ATIVIDADE',
    'RESULTADO_OBTIDO_ATIVIDADE',
    'DISPENDIOS_ATIVIDADE',
] as const;

const RESPONSIBLE_FIELDS = [
    'NOME_RESPONSAVEL',
    'CPF_RESPONSAVEL',
    'JUSTIFICATIVA_RESPONSAVEL',
] as const;

function defaultValidationReport(): ValidationReport {
    return {
        overallScore: 0,
        totalFields: 0,
        filledFields: 0,
        pendingFields: 0,
        emptyFields: 0,
        issues: [],
        approved: false,
        retryable: false,
        duration: 0,
    };
}

function isFilled(value: unknown): boolean {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

function parseFieldKey(fieldKey: string): ParsedFieldKey {
    const match = /^([A-Z_]+)(?:\[(\d+)\])?(?:\[(\d+)\])?$/.exec(fieldKey.trim());
    if (!match) {
        throw new Error(`fieldKey invalido: ${fieldKey}`);
    }

    return {
        fieldName: match[1],
        activityIndex: match[2] != null ? Number(match[2]) : undefined,
        responsibleIndex: match[3] != null ? Number(match[3]) : undefined,
    };
}

function buildFieldKey(fieldName: string, activityIndex?: number, responsibleIndex?: number): string {
    if (activityIndex == null) return fieldName;
    if (responsibleIndex == null) return `${fieldName}[${activityIndex}]`;
    return `${fieldName}[${activityIndex}][${responsibleIndex}]`;
}

function clonePlaceholderMap(input: PlaceholderMap): PlaceholderMap {
    return JSON.parse(JSON.stringify(input)) as PlaceholderMap;
}

function getFieldValue(placeholderMap: PlaceholderMap, parsed: ParsedFieldKey): unknown {
    if (parsed.activityIndex == null) {
        return (placeholderMap as unknown as Record<string, unknown>)[parsed.fieldName];
    }

    const activity = placeholderMap.ATIVIDADES[parsed.activityIndex];
    if (!activity) return undefined;

    if (parsed.responsibleIndex == null) {
        return (activity as unknown as Record<string, unknown>)[parsed.fieldName];
    }

    const responsible = activity.RESPONSAVEIS[parsed.responsibleIndex];
    if (!responsible) return undefined;
    return (responsible as unknown as Record<string, unknown>)[parsed.fieldName];
}

function setFieldValue(placeholderMap: PlaceholderMap, parsed: ParsedFieldKey, value: unknown): void {
    if (parsed.activityIndex == null) {
        (placeholderMap as unknown as Record<string, unknown>)[parsed.fieldName] = value;
        return;
    }

    const activity = placeholderMap.ATIVIDADES[parsed.activityIndex];
    if (!activity) return;

    if (parsed.responsibleIndex == null) {
        (activity as unknown as Record<string, unknown>)[parsed.fieldName] = value;
        return;
    }

    const responsible = activity.RESPONSAVEIS[parsed.responsibleIndex];
    if (!responsible) return;
    (responsible as unknown as Record<string, unknown>)[parsed.fieldName] = value;
}

function applyOverrides(placeholderMap: PlaceholderMap, overrides: OverridesMap): PlaceholderMap {
    const next = clonePlaceholderMap(placeholderMap);
    for (const [fieldKey, override] of Object.entries(overrides)) {
        try {
            const parsed = parseFieldKey(fieldKey);
            setFieldValue(next, parsed, override.newValue);
        } catch {
            continue;
        }
    }
    return next;
}

function extractSection(fieldName: string, activityIndex?: number, responsibleIndex?: number): ReviewSectionName {
    if (activityIndex != null || responsibleIndex != null || fieldName.includes('ATIVIDADE') || fieldName.includes('RESPONSAVEL')) {
        return 'atividades';
    }
    if (fieldName === 'RESULTADOS_ALCANCADOS') {
        return 'resultados';
    }
    return 'dados_projeto';
}

function matchIssue(
    issue: ValidationIssue,
    fieldName: string,
    activityIndex?: number,
    responsibleIndex?: number,
): boolean {
    const field = issue.field.toUpperCase();
    if (field === fieldName) return true;
    if (field.includes(fieldName)) {
        if (activityIndex == null) return true;
        if (!field.includes(`[${activityIndex}]`)) return false;
        if (responsibleIndex == null) return true;
        return field.includes(`[${responsibleIndex}]`);
    }
    return false;
}

function labelFromFieldName(fieldName: string): string {
    const custom = SIMPLE_FIELDS.find((item) => item.fieldName === fieldName);
    if (custom) return custom.label;
    return fieldName
        .toLowerCase()
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function sectionLabel(sectionName: ReviewSectionName): string {
    if (sectionName === 'dados_projeto') return 'Dados do Projeto';
    if (sectionName === 'atividades') return 'Atividades';
    return 'Resultados';
}

function safeMetadata(input: unknown): GenerationMetadata | null {
    const parsed = GenerationMetadataSchema.safeParse(input);
    return parsed.success ? parsed.data : null;
}

function getNormalizationValue(normalization: NormalizationOutput, fieldName: string): unknown {
    for (const section of normalization.sections) {
        for (const field of section.fields) {
            if (field.fieldName === fieldName) {
                return field.normalizedValue ?? field.value;
            }
        }
    }
    return undefined;
}

function buildPlaceholderMapFromNormalization(normalization: NormalizationOutput): PlaceholderMap {
    const atividadesRaw = getNormalizationValue(normalization, 'ATIVIDADES');
    const atividades = Array.isArray(atividadesRaw) ? atividadesRaw : [];

    return {
        PROJETO_NOME: String(getNormalizationValue(normalization, 'PROJETO_NOME') ?? ''),
        ANO_BASE: String(getNormalizationValue(normalization, 'ANO_BASE') ?? ''),
        COMPETENCIA: String(getNormalizationValue(normalization, 'COMPETENCIA') ?? ''),
        COORDENADOR_TECNICO: String(getNormalizationValue(normalization, 'COORDENADOR_TECNICO') ?? ''),
        RESULTADOS_ALCANCADOS: String(getNormalizationValue(normalization, 'RESULTADOS_ALCANCADOS') ?? ''),
        ATIVIDADES: atividades.map((item, activityIndex) => {
            const row = item as Record<string, unknown>;
            const responsaveisRaw = Array.isArray(row.RESPONSAVEIS) ? row.RESPONSAVEIS : [];

            return {
                NUMERO_ATIVIDADE: String(row.NUMERO_ATIVIDADE ?? activityIndex + 1),
                NOME_ATIVIDADE: String(row.NOME_ATIVIDADE ?? `Atividade ${activityIndex + 1}`),
                PERIODO_ATIVIDADE: String(row.PERIODO_ATIVIDADE ?? ''),
                DESCRICAO_ATIVIDADE: String(row.DESCRICAO_ATIVIDADE ?? ''),
                JUSTIFICATIVA_ATIVIDADE: String(row.JUSTIFICATIVA_ATIVIDADE ?? ''),
                RESULTADO_OBTIDO_ATIVIDADE: String(row.RESULTADO_OBTIDO_ATIVIDADE ?? ''),
                DISPENDIOS_ATIVIDADE: String(row.DISPENDIOS_ATIVIDADE ?? ''),
                RESPONSAVEIS: responsaveisRaw.map((responsavel) => {
                    const person = responsavel as Record<string, unknown>;
                    return {
                        NOME_RESPONSAVEL: String(person.NOME_RESPONSAVEL ?? ''),
                        CPF_RESPONSAVEL: String(person.CPF_RESPONSAVEL ?? ''),
                        JUSTIFICATIVA_RESPONSAVEL: String(person.JUSTIFICATIVA_RESPONSAVEL ?? ''),
                    };
                }),
            };
        }),
    };
}

function ensurePlaceholderMap(normalization: NormalizationOutput, current?: unknown): PlaceholderMap {
    const existing = PlaceholderMapSchema.safeParse(current);
    if (existing.success) {
        return existing.data;
    }
    return buildPlaceholderMapFromNormalization(normalization);
}

export class ReviewService {
    async getReviewData(projectId: string, generationId: string): Promise<ReviewData> {
        const generation = await prisma.rDAGeneration.findFirst({
            where: { id: generationId, projectId },
            select: {
                id: true,
                projectId: true,
                status: true,
                outputFilePath: true,
                partialResults: true,
                overrides: true,
                validationReport: true,
                metadata: true,
                period: true,
                periodStart: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        if (!generation) {
            throw new Error('Geracao nao encontrada para o projeto informado.');
        }

        const partial = (generation.partialResults as StoredPartialResults | null) ?? {};
        const normalization = NormalizationOutputSchema.parse(partial.normalization ?? { sections: [], totalTokens: { input: 0, output: 0 }, totalDuration: 0 });
        const extraction = ExtractionOutputSchema.safeParse(partial.extraction);
        const validation = ValidationReportSchema.safeParse(generation.validationReport ?? partial.validationReport);
        const report = validation.success ? validation.data : defaultValidationReport();
        const overrides = this.resolveOverrides(generation.overrides, partial);

        const placeholderMapValue = ensurePlaceholderMap(normalization, partial.placeholderMap);
        const placeholderMap = applyOverrides(placeholderMapValue, overrides);
        const allFields = this.buildReviewFields(normalization, extraction.success ? extraction.data : null, report, placeholderMap, overrides);
        const sections = this.groupSections(allFields);

        const totalFields = allFields.length;
        const overriddenFields = Object.keys(overrides).length;
        const editPercentage = totalFields > 0 ? (overriddenFields / totalFields) * 100 : 0;
        const qualityAlert = editPercentage > 20;
        if (qualityAlert) {
            logger.warn('[ReviewService] quality alert > 20%', {
                generationId,
                projectId,
                editPercentage,
                overriddenFields,
                totalFields,
            });
        }
        const period = this.resolvePeriod(generation.period, generation.periodStart);

        return {
            generationId: generation.id,
            projectId: generation.projectId,
            period,
            status: generation.status,
            overallScore: report.overallScore,
            sections,
            validationReport: report,
            metadata: safeMetadata(generation.metadata ?? partial.metadata),
            overrides,
            hasDocx: Boolean(generation.outputFilePath),
            docxPath: generation.outputFilePath ?? undefined,
            qualityAlert,
            editPercentage,
            createdAt: generation.createdAt.toISOString(),
            updatedAt: generation.updatedAt.toISOString(),
        };
    }

    async saveOverride(
        projectId: string,
        generationId: string,
        input: SaveOverrideRequest,
        editedBy?: string,
    ): Promise<ReviewData> {
        const current = await this.getReviewData(projectId, generationId);
        const target = current.sections.flatMap((section) => section.fields).find((field) => field.fieldKey === input.fieldKey);
        if (!target) {
            throw new Error(`Campo nao encontrado para override: ${input.fieldKey}`);
        }

        const override: FieldOverride = {
            fieldName: target.fieldName,
            sectionName: target.sectionName,
            activityIndex: target.activityIndex,
            responsibleIndex: target.responsibleIndex,
            originalValue: target.originalValue,
            newValue: input.newValue,
            reason: input.reason,
            editedAt: new Date().toISOString(),
            editedBy,
        };

        await this.patchOverrides(projectId, generationId, (current) => ({
            ...current,
            [input.fieldKey]: override,
        }));

        return this.getReviewData(projectId, generationId);
    }

    async saveBatchOverrides(
        projectId: string,
        generationId: string,
        input: SaveBatchOverridesRequest,
        editedBy?: string,
    ): Promise<ReviewData> {
        for (const item of input.overrides) {
            await this.saveOverride(projectId, generationId, item, editedBy);
        }
        return this.getReviewData(projectId, generationId);
    }

    async removeOverride(projectId: string, generationId: string, fieldKey: string): Promise<ReviewData> {
        await this.patchOverrides(projectId, generationId, (current) => {
            const next = { ...current };
            delete next[fieldKey];
            return next;
        });

        return this.getReviewData(projectId, generationId);
    }

    async finalizeReview(
        projectId: string,
        generationId: string,
        saveAsExample: boolean,
    ): Promise<{ generationId: string; filePath: string; editPercentage: number; qualityAlert: boolean }> {
        const generation = await prisma.rDAGeneration.findFirst({
            where: { id: generationId, projectId },
            select: {
                id: true,
                partialResults: true,
                overrides: true,
                validationReport: true,
                metadata: true,
                period: true,
                schemaVersion: true,
                template: {
                    select: {
                        id: true,
                        filePath: true,
                        activeSchemaId: true,
                    },
                },
            },
        });

        if (!generation) {
            throw new Error('Geracao nao encontrada para finalizacao.');
        }

        const partial = (generation.partialResults as StoredPartialResults | null) ?? {};
        const contextParsed = GenerationContextSchema.safeParse(partial.context);
        if (!contextParsed.success) {
            throw new Error('Contexto da geracao nao encontrado para re-render do DOCX.');
        }

        const normalization = NormalizationOutputSchema.safeParse(partial.normalization);
        if (!normalization.success) {
            throw new Error('NormalizationOutput ausente para finalizacao.');
        }

        const reviewData = await this.getReviewData(projectId, generationId);
        const reviewState = partial.review ?? {};
        const overrides = this.resolveOverrides(generation.overrides, partial);

        const formatted = buildPlaceholderMapFromNormalization(normalization.data);
        const finalPlaceholderMap = applyOverrides(formatted, overrides);

        const templatePath = contextParsed.data.templatePath || generation.template.filePath;
        const generated = await rdaDocxGeneratorService.generate(templatePath, finalPlaceholderMap, generationId);

        const nextPartial: StoredPartialResults = {
            ...partial,
            placeholderMap: finalPlaceholderMap,
            review: {
                ...reviewState,
                editPercentage: reviewData.editPercentage,
                qualityAlert: reviewData.qualityAlert,
                lastFinalizedAt: new Date().toISOString(),
            },
        };

        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: {
                status: 'completed',
                progress: 100,
                currentStep: 'review_finalized',
                outputFilePath: generated.filePath,
                fileSize: generated.sizeBytes,
                overrides: overrides as unknown as Prisma.InputJsonValue,
                validationReport: reviewData.validationReport as unknown as Prisma.InputJsonValue,
                metadata: reviewData.metadata != null
                    ? reviewData.metadata as unknown as Prisma.InputJsonValue
                    : (generation.metadata ?? partial.metadata ?? Prisma.JsonNull),
                period: reviewData.period as unknown as Prisma.InputJsonValue,
                schemaVersion: generation.schemaVersion ?? '4.0.0',
                partialResults: nextPartial as Prisma.InputJsonValue,
            },
        });

        if (saveAsExample && generation.template.activeSchemaId) {
            await prisma.rDAExample.create({
                data: {
                    schemaId: generation.template.activeSchemaId,
                    section: 'review_final',
                    fieldName: 'PLACEHOLDER_MAP',
                    content: finalPlaceholderMap as unknown as Prisma.InputJsonValue,
                    source: 'human_review',
                    quality: reviewData.qualityAlert ? 0.8 : 1.0,
                },
            });
        }

        return {
            generationId,
            filePath: generated.filePath,
            editPercentage: reviewData.editPercentage,
            qualityAlert: reviewData.qualityAlert,
        };
    }

    private async patchOverrides(
        projectId: string,
        generationId: string,
        patcher: (overrides: OverridesMap) => OverridesMap,
    ): Promise<void> {
        const generation = await prisma.rDAGeneration.findFirst({
            where: { id: generationId, projectId },
            select: { id: true, overrides: true, partialResults: true },
        });

        if (!generation) {
            throw new Error('Geracao nao encontrada.');
        }

        const partial = (generation.partialResults as StoredPartialResults | null) ?? {};
        const current = this.resolveOverrides(generation.overrides, partial);
        const next = patcher(current);

        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: {
                overrides: next as unknown as Prisma.InputJsonValue,
            },
        });
    }

    private resolveOverrides(columnValue: unknown, partial: StoredPartialResults): OverridesMap {
        const parsed = z.record(z.string(), z.unknown()).safeParse(columnValue);
        if (parsed.success) {
            return parsed.data as OverridesMap;
        }

        const legacy = partial.review as { overrides?: OverridesMap } | undefined;
        return legacy?.overrides ?? {};
    }

    private resolvePeriod(columnPeriod: unknown, periodStart: Date): { month: number; year: number } {
        const parsed = z.object({
            month: z.number().int().min(1).max(12),
            year: z.number().int().min(2000),
        }).safeParse(columnPeriod);

        if (parsed.success) {
            return parsed.data;
        }

        return {
            month: periodStart.getUTCMonth() + 1,
            year: periodStart.getUTCFullYear(),
        };
    }

    private buildReviewFields(
        normalization: NormalizationOutput,
        extraction: ExtractionOutput | null,
        validationReport: ValidationReport,
        placeholderMap: PlaceholderMap,
        overrides: OverridesMap,
    ): ReviewField[] {
        const fields: ReviewField[] = [];
        const normalizedFields = new Map<string, NormalizedField>();
        const extractionFields = new Map<string, ExtractionOutput['sections'][number]['fields'][number]>();

        for (const section of normalization.sections) {
            for (const field of section.fields) {
                normalizedFields.set(field.fieldName, field);
            }
        }

        if (extraction) {
            for (const section of extraction.sections) {
                for (const field of section.fields) {
                    extractionFields.set(field.fieldName, field);
                }
            }
        }

        for (const simple of SIMPLE_FIELDS) {
            const normalized = normalizedFields.get(simple.fieldName);
            const extracted = extractionFields.get(simple.fieldName);
            const fieldKey = buildFieldKey(simple.fieldName);
            const override = overrides[fieldKey];
            const value = override ? override.newValue : getFieldValue(placeholderMap, { fieldName: simple.fieldName });
            const originalValue = normalized?.originalValue ?? extracted?.value ?? null;
            const confidence = normalized?.confidence ?? extracted?.confidence ?? 0;
            const issues = validationReport.issues.filter((issue) => matchIssue(issue, simple.fieldName));

            fields.push({
                fieldKey,
                fieldName: simple.fieldName,
                sectionName: simple.section,
                label: simple.label,
                value,
                originalValue,
                confidence,
                status: isFilled(value) ? 'filled' : 'pending',
                evidence: extracted?.evidence ?? [],
                issues,
                hasOverride: Boolean(override),
                override,
                isRequired: REQUIRED_FIELDS.has(simple.fieldName),
                fieldType: 'simple',
            });
        }

        const activities = placeholderMap.ATIVIDADES ?? [];
        const normalizedActivities = normalizedFields.get('ATIVIDADES');
        const extractedActivities = extractionFields.get('ATIVIDADES');
        const activityConfidence = normalizedActivities?.confidence ?? extractedActivities?.confidence ?? 0;

        activities.forEach((activity, activityIndex) => {
            for (const fieldName of ACTIVITY_FIELDS) {
                const fieldKey = buildFieldKey(fieldName, activityIndex);
                const override = overrides[fieldKey];
                const value = override ? override.newValue : getFieldValue(placeholderMap, { fieldName, activityIndex });
                const originalValue = (normalizedActivities?.originalValue as Array<Record<string, unknown>> | undefined)?.[activityIndex]?.[fieldName]
                    ?? (extractedActivities?.value as Array<Record<string, unknown>> | undefined)?.[activityIndex]?.[fieldName]
                    ?? null;
                const evidence = extractedActivities?.evidence?.[activityIndex]
                    ? [extractedActivities.evidence[activityIndex]]
                    : extractedActivities?.evidence ?? [];
                const issues = validationReport.issues.filter((issue) => matchIssue(issue, fieldName, activityIndex));

                fields.push({
                    fieldKey,
                    fieldName,
                    sectionName: 'atividades',
                    activityIndex,
                    label: `${labelFromFieldName(fieldName)} ${activityIndex + 1}`,
                    value,
                    originalValue,
                    confidence: activityConfidence,
                    status: isFilled(value) ? 'filled' : 'pending',
                    evidence,
                    issues,
                    hasOverride: Boolean(override),
                    override,
                    isRequired: fieldName === 'NOME_ATIVIDADE' || fieldName === 'DESCRICAO_ATIVIDADE',
                    fieldType: 'activity',
                });
            }

            (activity.RESPONSAVEIS ?? []).forEach((_responsible, responsibleIndex) => {
                for (const fieldName of RESPONSIBLE_FIELDS) {
                    const fieldKey = buildFieldKey(fieldName, activityIndex, responsibleIndex);
                    const override = overrides[fieldKey];
                    const value = override ? override.newValue : getFieldValue(placeholderMap, { fieldName, activityIndex, responsibleIndex });
                    const originalValue = (normalizedActivities?.originalValue as Array<Record<string, unknown>> | undefined)?.[activityIndex]
                        ?.RESPONSAVEIS as Array<Record<string, unknown>> | undefined;
                    const resolvedOriginal = originalValue?.[responsibleIndex]?.[fieldName]
                        ?? ((extractedActivities?.value as Array<Record<string, unknown>> | undefined)?.[activityIndex]
                            ?.RESPONSAVEIS as Array<Record<string, unknown>> | undefined)?.[responsibleIndex]?.[fieldName]
                        ?? null;

                    const issues = validationReport.issues.filter((issue) => matchIssue(issue, fieldName, activityIndex, responsibleIndex));
                    const evidence = extractedActivities?.evidence?.[activityIndex]
                        ? [extractedActivities.evidence[activityIndex]]
                        : extractedActivities?.evidence ?? [];

                    fields.push({
                        fieldKey,
                        fieldName,
                        sectionName: 'atividades',
                        activityIndex,
                        responsibleIndex,
                        label: `${labelFromFieldName(fieldName)} ${activityIndex + 1}.${responsibleIndex + 1}`,
                        value,
                        originalValue: resolvedOriginal,
                        confidence: activityConfidence,
                        status: isFilled(value) ? 'filled' : 'pending',
                        evidence,
                        issues,
                        hasOverride: Boolean(override),
                        override,
                        isRequired: fieldName === 'NOME_RESPONSAVEL',
                        fieldType: 'responsible',
                    });
                }
            });
        });

        return fields;
    }

    private groupSections(fields: ReviewField[]): ReviewSection[] {
        const grouped = new Map<ReviewSectionName, ReviewField[]>();
        for (const field of fields) {
            const section = extractSection(field.fieldName, field.activityIndex, field.responsibleIndex);
            grouped.set(section, [...(grouped.get(section) ?? []), field]);
        }

        const ordered: ReviewSectionName[] = ['dados_projeto', 'atividades', 'resultados'];
        return ordered.map((sectionName) => {
            const sectionFields = grouped.get(sectionName) ?? [];
            const totalFields = sectionFields.length;
            const filledFields = sectionFields.filter((field) => field.status === 'filled').length;
            const pendingFields = totalFields - filledFields;
            const overriddenFields = sectionFields.filter((field) => field.hasOverride).length;
            const score = totalFields > 0
                ? sectionFields.reduce((acc, field) => acc + field.confidence, 0) / totalFields
                : 0;

            const issueCount = {
                errors: sectionFields.flatMap((field) => field.issues).filter((issue) => issue.severity === 'error').length,
                warnings: sectionFields.flatMap((field) => field.issues).filter((issue) => issue.severity === 'warning').length,
                info: sectionFields.flatMap((field) => field.issues).filter((issue) => issue.severity === 'info').length,
            };

            return {
                sectionName,
                label: sectionLabel(sectionName),
                fields: sectionFields,
                sectionScore: score,
                totalFields,
                filledFields,
                pendingFields,
                overriddenFields,
                issueCount,
            };
        }).filter((section) => section.totalFields > 0);
    }
}

export const reviewService = new ReviewService();
