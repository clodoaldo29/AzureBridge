import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/database/client';
import { ExtractorAgent } from '@/modules/rda/agents/extractor.agent';
import { NormalizerAgent } from '@/modules/rda/agents/normalizer.agent';
import { ValidatorAgent } from '@/modules/rda/agents/validator.agent';
import {
    ExtractionOutputSchema,
    type ExtractionOutput,
    type NormalizationOutput,
    NormalizationOutputSchema,
    type PlaceholderMap,
} from '@/modules/rda/schemas/generation.schema';
import { GenerationContextSchema } from '@/modules/rda/schemas/preflight.schema';
import type { OverridesMap } from '@/modules/rda/schemas/review.schema';

type ReviewSectionName = 'dados_projeto' | 'atividades' | 'resultados';

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

type NormalizedField = NormalizationOutput['sections'][number]['fields'][number];
type ExtractedField = ExtractionOutput['sections'][number]['fields'][number];

const SECTION_FIELDS: Record<ReviewSectionName, string[]> = {
    dados_projeto: ['PROJETO_NOME', 'ANO_BASE', 'COMPETENCIA', 'COORDENADOR_TECNICO'],
    atividades: ['ATIVIDADES'],
    resultados: ['RESULTADOS_ALCANCADOS'],
};

function parseFieldKey(fieldKey: string): { fieldName: string; activityIndex?: number; responsibleIndex?: number } {
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

function setFieldValue(placeholderMap: PlaceholderMap, fieldKey: string, value: unknown): void {
    const parsed = parseFieldKey(fieldKey);
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
    const next = JSON.parse(JSON.stringify(placeholderMap)) as PlaceholderMap;
    for (const [fieldKey, override] of Object.entries(overrides)) {
        try {
            setFieldValue(next, fieldKey, override.newValue);
        } catch {
            continue;
        }
    }
    return next;
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
        ATIVIDADES: atividades.map((item, index) => {
            const row = item as Record<string, unknown>;
            const responsaveisRaw = Array.isArray(row.RESPONSAVEIS) ? row.RESPONSAVEIS : [];

            return {
                NUMERO_ATIVIDADE: String(row.NUMERO_ATIVIDADE ?? index + 1),
                NOME_ATIVIDADE: String(row.NOME_ATIVIDADE ?? `Atividade ${index + 1}`),
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

function mergeFields<T extends { fieldName: string }>(
    previousFields: T[],
    freshFields: T[],
    selectedFieldNames: Set<string>,
): T[] {
    const freshByName = new Map(freshFields.map((field) => [field.fieldName, field]));
    const freshNames = new Set(freshFields.map((field) => field.fieldName));
    const result: T[] = [];

    for (const field of previousFields) {
        if (selectedFieldNames.has(field.fieldName) && freshByName.has(field.fieldName)) {
            result.push(freshByName.get(field.fieldName) as T);
        } else {
            result.push(field);
        }
    }

    for (const field of freshFields) {
        if (selectedFieldNames.has(field.fieldName) && !previousFields.some((item) => item.fieldName === field.fieldName)) {
            result.push(field);
        }
    }

    for (const fieldName of selectedFieldNames) {
        if (!freshNames.has(fieldName)) {
            continue;
        }
        if (!result.some((item) => item.fieldName === fieldName)) {
            result.push(freshByName.get(fieldName) as T);
        }
    }

    return result;
}

function toSingleSectionNormalization(fields: NormalizedField[], source: NormalizationOutput): NormalizationOutput {
    return {
        sections: [{
            sectionName: source.sections[0]?.sectionName ?? 'rda',
            fields,
            tokensUsed: source.totalTokens,
            duration: source.totalDuration,
        }],
        totalTokens: source.totalTokens,
        totalDuration: source.totalDuration,
    };
}

function toSingleSectionExtraction(fields: ExtractedField[], source: ExtractionOutput): ExtractionOutput {
    return {
        sections: [{
            sectionName: source.sections[0]?.sectionName ?? 'rda',
            fields,
            chunksQueried: source.sections[0]?.chunksQueried ?? 0,
            tokensUsed: source.totalTokens,
            duration: source.totalDuration,
        }],
        totalTokens: source.totalTokens,
        totalDuration: source.totalDuration,
    };
}

export class ReprocessService {
    private extractorAgent = new ExtractorAgent();
    private normalizerAgent = new NormalizerAgent();
    private validatorAgent = new ValidatorAgent();

    async reprocessSections(
        projectId: string,
        generationId: string,
        sections: ReviewSectionName[],
        reason?: string,
    ): Promise<{ generationId: string; sections: ReviewSectionName[]; validationScore: number }> {
        const generation = await prisma.rDAGeneration.findFirst({
            where: { id: generationId, projectId },
            select: {
                id: true,
                partialResults: true,
                status: true,
                overrides: true,
                validationReport: true,
            },
        });

        if (!generation) {
            throw new Error('Geracao nao encontrada para reprocessamento.');
        }

        const partial = (generation.partialResults as StoredPartialResults | null) ?? {};
        const context = GenerationContextSchema.safeParse(partial.context);
        if (!context.success) {
            throw new Error('Contexto da geracao nao encontrado.');
        }

        const existingNormalization = NormalizationOutputSchema.safeParse(partial.normalization);
        if (!existingNormalization.success) {
            throw new Error('NormalizationOutput nao encontrado para reprocessar.');
        }

        const existingExtraction = ExtractionOutputSchema.safeParse(partial.extraction);
        if (!existingExtraction.success) {
            throw new Error('ExtractionOutput nao encontrado para reprocessar.');
        }

        const selectedFieldNames = new Set<string>(sections.flatMap((section) => SECTION_FIELDS[section]));
        const partialExtractionOutputs = await Promise.all(
            sections.map((sectionName) => this.extractorAgent.extractSection({
                generationId,
                context: context.data,
            }, sectionName)),
        );
        const partialNormalizationOutputs = await Promise.all(
            sections.map((sectionName, index) => this.normalizerAgent.normalizeSection({
                generationId,
                extraction: partialExtractionOutputs[index],
                fillingGuide: context.data.fillingGuide,
            }, sectionName)),
        );

        const freshExtraction = toSingleSectionExtraction(
            partialExtractionOutputs.flatMap((output) => output.sections.flatMap((section) => section.fields)),
            partialExtractionOutputs[0] ?? existingExtraction.data,
        );
        const freshNormalization = toSingleSectionNormalization(
            partialNormalizationOutputs.flatMap((output) => output.sections.flatMap((section) => section.fields)),
            partialNormalizationOutputs[0] ?? existingNormalization.data,
        );

        const previousNormalizedFields = existingNormalization.data.sections.flatMap((section) => section.fields);
        const freshNormalizedFields = freshNormalization.sections.flatMap((section) => section.fields);
        const mergedNormalizedFields = mergeFields(previousNormalizedFields, freshNormalizedFields, selectedFieldNames);
        const mergedNormalization = toSingleSectionNormalization(mergedNormalizedFields, freshNormalization);

        const previousExtractedFields = existingExtraction.data.sections.flatMap((section) => section.fields);
        const freshExtractedFields = freshExtraction.sections.flatMap((section) => section.fields);
        const mergedExtractedFields = mergeFields(previousExtractedFields, freshExtractedFields, selectedFieldNames);
        const mergedExtraction = toSingleSectionExtraction(mergedExtractedFields, freshExtraction);

        const validation = await this.validatorAgent.run({
            generationId,
            normalization: mergedNormalization,
            placeholders: context.data.placeholders,
        });

        const rawPlaceholder = buildPlaceholderMapFromNormalization(mergedNormalization);
        const reviewState = partial.review ?? {};
        const overrides = this.resolveOverrides(generation.overrides, partial);
        const placeholderMap = applyOverrides(rawPlaceholder, overrides);

        const nextPartial: StoredPartialResults = {
            ...partial,
            extraction: mergedExtraction,
            normalization: mergedNormalization,
            validationReport: validation ?? generation.validationReport ?? partial.validationReport,
            placeholderMap,
            review: {
                ...reviewState,
                lastReprocessedAt: new Date().toISOString(),
                lastReprocessReason: reason,
            },
        };

        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: {
                status: 'completed',
                progress: 100,
                currentStep: 'review_reprocessed',
                validationReport: validation as unknown as Prisma.InputJsonValue,
                overrides: overrides as unknown as Prisma.InputJsonValue,
                partialResults: nextPartial as Prisma.InputJsonValue,
            },
        });

        return {
            generationId,
            sections,
            validationScore: validation.overallScore,
        };
    }

    private resolveOverrides(columnValue: unknown, partial: StoredPartialResults): OverridesMap {
        const parsed = z.record(z.string(), z.unknown()).safeParse(columnValue);
        if (parsed.success) {
            return parsed.data as OverridesMap;
        }
        const legacy = partial.review as { overrides?: OverridesMap } | undefined;
        return legacy?.overrides ?? {};
    }
}

export const reprocessService = new ReprocessService();
