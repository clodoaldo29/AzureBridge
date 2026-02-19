import type { GenerationContext } from '@/modules/rda/schemas/preflight.schema';

function stringifySafe(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return '{}';
    }
}

export const EXTRACTOR_SYSTEM_PROMPT = [
    'Voce e o ExtractorAgent do pipeline RDA.',
    'Responda SOMENTE JSON valido.',
    'Nao invente dados. Use pending/no_data quando faltar evidencia.',
    'Priorize rastreabilidade: cada campo deve ter evidence[] com fonte e snippet.',
].join('\n');

export const NORMALIZER_SYSTEM_PROMPT = [
    'Voce e o NormalizerAgent do pipeline RDA.',
    'Responda SOMENTE JSON valido.',
    'Padronize linguagem formal PT-BR e mantenha fidelidade factual.',
    'Nao altere significado nem crie fatos.',
].join('\n');

export const VALIDATOR_SYSTEM_PROMPT = [
    'Voce e o ValidatorAgent do pipeline RDA.',
    'Responda SOMENTE JSON valido.',
    'Valide consistencia, completude e aderencia ao periodo.',
    'Emita issues objetivas por campo, com sugestao acionavel.',
].join('\n');

export function buildExtractorPrompt(context: GenerationContext, workItems: unknown[], sprints: unknown[]): string {
    return [
        'Extraia os dados estruturados do RDA com base no contexto abaixo.',
        'Formato de saida esperado: { sections: [{ sectionName, fields: [...] }], totalTokens, totalDuration }.',
        'Campos obrigatorios globais: PROJETO_NOME, ANO_BASE, COMPETENCIA, COORDENADOR_TECNICO, RESULTADOS_ALCANCADOS, ATIVIDADES[].',
        '',
        'Contexto:',
        stringifySafe(context),
        '',
        'Work items do periodo:',
        stringifySafe(workItems),
        '',
        'Sprints do periodo:',
        stringifySafe(sprints),
    ].join('\n');
}

export function buildNormalizerPrompt(extraction: unknown, fillingGuide: string): string {
    return [
        'Normalize os campos extraidos para PT-BR formal.',
        'Mantenha estrutura de campos e evidencias.',
        '',
        'Guia de preenchimento:',
        fillingGuide,
        '',
        'Extracao:',
        stringifySafe(extraction),
    ].join('\n');
}

export function buildValidatorPrompt(normalization: unknown, placeholders: unknown): string {
    return [
        'Valide os dados normalizados e gere ValidationReport.',
        'Aprovacao: false se houver campo obrigatorio ausente.',
        '',
        'Placeholders:',
        stringifySafe(placeholders),
        '',
        'Normalizacao:',
        stringifySafe(normalization),
    ].join('\n');
}
