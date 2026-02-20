import { BaseAgent } from '@/modules/rda/agents/base.agent';
import type { ExtractionOutput, NormalizationOutput, NormalizedFieldResult } from '@/modules/rda/schemas/generation.schema';
import { claudeService } from '@/services/rda/claude.service';
import { buildNormalizerPrompt, NORMALIZER_SYSTEM_PROMPT } from '@/modules/rda/prompts/agent-prompts';

interface NormalizerInput {
    generationId: string;
    extraction: ExtractionOutput;
    fillingGuide: string;
}

type ReviewSectionName = 'dados_projeto' | 'atividades' | 'resultados';

const SECTION_FIELD_NAMES: Record<ReviewSectionName, Set<string>> = {
    dados_projeto: new Set(['PROJETO_NOME', 'ANO_BASE', 'COMPETENCIA', 'COORDENADOR_TECNICO']),
    atividades: new Set(['ATIVIDADES']),
    resultados: new Set(['RESULTADOS_ALCANCADOS']),
};

function sanitizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function normalizeValue(value: unknown): unknown {
    if (typeof value === 'string') return sanitizeText(value);
    if (Array.isArray(value)) return value.map((item) => normalizeValue(item));
    if (value && typeof value === 'object') {
        const next: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            next[k] = normalizeValue(v);
        }
        return next;
    }
    return value;
}

export class NormalizerAgent extends BaseAgent {
    constructor() {
        super('NormalizerAgent');
    }

    async run(input: NormalizerInput): Promise<NormalizationOutput> {
        const startedAt = Date.now();
        await this.updateProgress(input.generationId, 45, 'normalizer_running');

        const sections = input.extraction.sections.map((section) => ({
            sectionName: section.sectionName,
            fields: section.fields.map<NormalizedFieldResult>((field) => ({
                ...field,
                originalValue: field.value,
                normalizedValue: normalizeValue(field.value),
                value: normalizeValue(field.value),
                normalizationNotes: 'Normalizacao deterministica aplicada.',
            })),
            tokensUsed: { input: 0, output: 0 },
            duration: 0,
        }));

        try {
            const llm = await claudeService.complete(buildNormalizerPrompt(input.extraction, input.fillingGuide), {
                systemPrompt: NORMALIZER_SYSTEM_PROMPT,
                maxTokens: 800,
                temperature: 0.1,
            });
            sections[0].tokensUsed = { input: Math.max(0, llm.tokensUsed - 100), output: Math.min(100, llm.tokensUsed) };
        } catch {
            this.logWarn('LLM normalization skip, using deterministic normalization');
        }

        const output: NormalizationOutput = {
            sections: sections.map((item) => ({
                ...item,
                duration: Math.max(1, Date.now() - startedAt),
            })),
            totalTokens: sections.reduce(
                (acc, item) => ({
                    input: acc.input + item.tokensUsed.input,
                    output: acc.output + item.tokensUsed.output,
                }),
                { input: 0, output: 0 },
            ),
            totalDuration: Date.now() - startedAt,
        };

        await this.mergePartialResults(input.generationId, { normalization: output });
        await this.updateProgress(input.generationId, 60, 'normalizer_done');

        return output;
    }

    async normalizeSection(input: NormalizerInput, sectionName: ReviewSectionName): Promise<NormalizationOutput> {
        const allowed = SECTION_FIELD_NAMES[sectionName];
        const extraction = {
            ...input.extraction,
            sections: input.extraction.sections.map((section) => ({
                ...section,
                fields: section.fields.filter((field) => allowed.has(field.fieldName)),
            })),
        };

        return this.run({
            ...input,
            extraction,
        });
    }
}
