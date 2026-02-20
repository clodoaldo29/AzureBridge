import { BaseAgent } from '@/modules/rda/agents/base.agent';
import type { NormalizationOutput, ValidationIssue, ValidationReport } from '@/modules/rda/schemas/generation.schema';
import type { PlaceholderInfo } from '@/modules/rda/schemas/preflight.schema';
import { claudeService } from '@/services/rda/claude.service';
import { buildValidatorPrompt, VALIDATOR_SYSTEM_PROMPT } from '@/modules/rda/prompts/agent-prompts';

interface ValidatorInput {
    generationId: string;
    normalization: NormalizationOutput;
    placeholders: PlaceholderInfo[];
}

const REQUIRED = ['PROJETO_NOME', 'ANO_BASE', 'COMPETENCIA', 'COORDENADOR_TECNICO', 'ATIVIDADES', 'RESULTADOS_ALCANCADOS'];

function collectFieldMap(normalization: NormalizationOutput): Map<string, unknown> {
    const map = new Map<string, unknown>();
    for (const section of normalization.sections) {
        for (const field of section.fields) {
            map.set(field.fieldName, field.normalizedValue ?? field.value);
        }
    }
    return map;
}

export class ValidatorAgent extends BaseAgent {
    constructor() {
        super('ValidatorAgent');
    }

    async run(input: ValidatorInput): Promise<ValidationReport> {
        const startedAt = Date.now();
        await this.updateProgress(input.generationId, 70, 'validator_running');

        const fields = collectFieldMap(input.normalization);
        const issues: ValidationIssue[] = [];

        for (const name of REQUIRED) {
            const value = fields.get(name);
            const empty = value == null
                || (typeof value === 'string' && value.trim().length === 0)
                || (Array.isArray(value) && value.length === 0);

            if (empty) {
                issues.push({
                    field: name,
                    severity: 'error',
                    type: 'missing',
                    message: `Campo obrigatorio ausente: ${name}`,
                    suggestion: 'Revisar fontes e preencher campo.',
                    autoFixable: false,
                });
            }
        }

        const atividades = fields.get('ATIVIDADES');
        if (Array.isArray(atividades)) {
            atividades.forEach((item, index) => {
                const activity = item as Record<string, unknown>;
                if (!activity.NOME_ATIVIDADE) {
                    issues.push({
                        field: `ATIVIDADES[${index}].NOME_ATIVIDADE`,
                        severity: 'warning',
                        type: 'missing',
                        message: 'Atividade sem nome.',
                        suggestion: 'Usar titulo do work item correspondente.',
                        autoFixable: true,
                    });
                }
            });
        }

        try {
            await claudeService.complete(buildValidatorPrompt(input.normalization, input.placeholders), {
                systemPrompt: VALIDATOR_SYSTEM_PROMPT,
                maxTokens: 700,
                temperature: 0.1,
            });
        } catch {
            this.logWarn('Validator LLM unavailable, using rule-based report only');
        }

        const totalFields = fields.size;
        const filledFields = Array.from(fields.values()).filter((v) => {
            if (v == null) return false;
            if (typeof v === 'string') return v.trim().length > 0;
            if (Array.isArray(v)) return v.length > 0;
            return true;
        }).length;

        const emptyFields = Math.max(0, totalFields - filledFields);
        const pendingFields = issues.filter((item) => item.severity !== 'info').length;
        const overallScore = totalFields > 0 ? Math.max(0, Math.min(1, (filledFields - issues.filter((i) => i.severity === 'error').length) / totalFields)) : 0;
        const hasErrors = issues.some((item) => item.severity === 'error');

        const report: ValidationReport = {
            overallScore,
            totalFields,
            filledFields,
            pendingFields,
            emptyFields,
            issues,
            approved: !hasErrors && overallScore >= 0.6,
            retryable: hasErrors,
            retryRecommendations: hasErrors ? {
                sections: ['rda'],
                reason: 'Campos obrigatorios sem preenchimento completo.',
            } : undefined,
            duration: Date.now() - startedAt,
        };

        await this.mergePartialResults(input.generationId, { validationReport: report });
        await this.updateProgress(input.generationId, 80, 'validator_done');

        return report;
    }
}
