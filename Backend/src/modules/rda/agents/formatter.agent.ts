import { BaseAgent } from '@/modules/rda/agents/base.agent';
import type { NormalizationOutput, PlaceholderMap } from '@/modules/rda/schemas/generation.schema';

interface FormatterInput {
    generationId: string;
    normalization: NormalizationOutput;
}

function getFieldValue(normalization: NormalizationOutput, fieldName: string): unknown {
    for (const section of normalization.sections) {
        for (const field of section.fields) {
            if (field.fieldName === fieldName) {
                return field.normalizedValue ?? field.value;
            }
        }
    }
    return undefined;
}

export class FormatterAgent extends BaseAgent {
    constructor() {
        super('FormatterAgent');
    }

    async run(input: FormatterInput): Promise<PlaceholderMap> {
        await this.updateProgress(input.generationId, 88, 'formatter_running');

        const atividadesRaw = getFieldValue(input.normalization, 'ATIVIDADES');
        const atividades = Array.isArray(atividadesRaw) ? atividadesRaw : [];

        const placeholderMap: PlaceholderMap = {
            PROJETO_NOME: String(getFieldValue(input.normalization, 'PROJETO_NOME') ?? ''),
            ANO_BASE: String(getFieldValue(input.normalization, 'ANO_BASE') ?? ''),
            COMPETENCIA: String(getFieldValue(input.normalization, 'COMPETENCIA') ?? ''),
            COORDENADOR_TECNICO: String(getFieldValue(input.normalization, 'COORDENADOR_TECNICO') ?? ''),
            RESULTADOS_ALCANCADOS: String(getFieldValue(input.normalization, 'RESULTADOS_ALCANCADOS') ?? ''),
            ATIVIDADES: atividades.map((item, index) => {
                const row = item as Record<string, unknown>;
                const responsaveis = Array.isArray(row.RESPONSAVEIS) ? row.RESPONSAVEIS : [];
                return {
                    NUMERO_ATIVIDADE: String(row.NUMERO_ATIVIDADE ?? index + 1),
                    NOME_ATIVIDADE: String(row.NOME_ATIVIDADE ?? `Atividade ${index + 1}`),
                    PERIODO_ATIVIDADE: String(row.PERIODO_ATIVIDADE ?? ''),
                    DESCRICAO_ATIVIDADE: String(row.DESCRICAO_ATIVIDADE ?? ''),
                    JUSTIFICATIVA_ATIVIDADE: String(row.JUSTIFICATIVA_ATIVIDADE ?? ''),
                    RESULTADO_OBTIDO_ATIVIDADE: String(row.RESULTADO_OBTIDO_ATIVIDADE ?? ''),
                    DISPENDIOS_ATIVIDADE: String(row.DISPENDIOS_ATIVIDADE ?? ''),
                    RESPONSAVEIS: responsaveis.map((responsavel) => {
                        const r = responsavel as Record<string, unknown>;
                        return {
                            NOME_RESPONSAVEL: String(r.NOME_RESPONSAVEL ?? ''),
                            CPF_RESPONSAVEL: String(r.CPF_RESPONSAVEL ?? ''),
                            JUSTIFICATIVA_RESPONSAVEL: String(r.JUSTIFICATIVA_RESPONSAVEL ?? ''),
                        };
                    }),
                };
            }),
        };

        await this.mergePartialResults(input.generationId, { placeholderMap });
        await this.updateProgress(input.generationId, 90, 'formatter_done');

        return placeholderMap;
    }
}
