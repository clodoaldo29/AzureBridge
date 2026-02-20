import { prisma } from '@/database/client';
import { BaseAgent } from '@/modules/rda/agents/base.agent';
import type { GenerationContext } from '@/modules/rda/schemas/preflight.schema';
import type { ExtractionOutput, RDAFieldResult, SectionExtractionResult } from '@/modules/rda/schemas/generation.schema';
import { claudeService } from '@/services/rda/claude.service';
import { buildExtractorPrompt, EXTRACTOR_SYSTEM_PROMPT } from '@/modules/rda/prompts/agent-prompts';

interface ExtractorInput {
    generationId: string;
    context: GenerationContext;
}

type ReviewSectionName = 'dados_projeto' | 'atividades' | 'resultados';

const SECTION_FIELD_NAMES: Record<ReviewSectionName, Set<string>> = {
    dados_projeto: new Set(['PROJETO_NOME', 'ANO_BASE', 'COMPETENCIA', 'COORDENADOR_TECNICO']),
    atividades: new Set(['ATIVIDADES']),
    resultados: new Set(['RESULTADOS_ALCANCADOS']),
};

function formatDate(value: Date | null): string {
    if (!value) return '-';
    return value.toISOString().slice(0, 10);
}

function formatCpf(value: string): string {
    const digits = value.replace(/\D/g, '');
    if (digits.length !== 11) return value;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export class ExtractorAgent extends BaseAgent {
    constructor() {
        super('ExtractorAgent');
    }

    async run(input: ExtractorInput): Promise<ExtractionOutput> {
        const startedAt = Date.now();
        await this.updateProgress(input.generationId, 15, 'extractor_running');

        const [workItems, sprints] = await Promise.all([
            prisma.rDAWorkItemSnapshot.findMany({
                where: {
                    projectId: input.context.projectId,
                    periodKey: input.context.periodKey,
                },
                orderBy: [{ changedDate: 'desc' }],
                take: 30,
                select: {
                    id: true,
                    workItemId: true,
                    title: true,
                    state: true,
                    description: true,
                    assignedTo: true,
                    changedDate: true,
                },
            }),
            prisma.rDASprintSnapshot.findMany({
                where: {
                    projectId: input.context.projectId,
                    period: input.context.periodKey,
                },
                orderBy: [{ startDate: 'asc' }],
                take: 12,
                select: {
                    id: true,
                    sprintName: true,
                    startDate: true,
                    endDate: true,
                    totalWorkItems: true,
                    completedItems: true,
                },
            }),
        ]);

        const baseFields: RDAFieldResult[] = [
            {
                fieldName: 'PROJETO_NOME',
                value: input.context.projectContext.projectName,
                evidence: [{
                    sourceType: 'Document',
                    sourceId: 'project-context',
                    sourceName: 'ProjectContext',
                    location: 'projectContext.projectName',
                    snippet: String(input.context.projectContext.projectName).slice(0, 200),
                }],
                confidence: 0.98,
                status: input.context.projectContext.projectName ? 'filled' : 'pending',
                contextUsed: ['projectContext'],
            },
            {
                fieldName: 'ANO_BASE',
                value: input.context.periodKey.slice(0, 4),
                evidence: [{
                    sourceType: 'Sprint',
                    sourceId: 'period',
                    sourceName: 'Periodo da geração',
                    location: 'periodKey',
                    snippet: input.context.periodKey,
                }],
                confidence: 0.99,
                status: 'filled',
                contextUsed: ['periodKey'],
            },
            {
                fieldName: 'COMPETENCIA',
                value: input.context.periodKey,
                evidence: [{
                    sourceType: 'Sprint',
                    sourceId: 'period',
                    sourceName: 'Periodo da geração',
                    location: 'periodKey',
                    snippet: input.context.periodKey,
                }],
                confidence: 0.99,
                status: 'filled',
                contextUsed: ['periodKey'],
            },
        ];

        const coordinator = input.context.projectContext.teamMembers.find((member) =>
            /coordenador|gerente t[eé]cnico|tech lead|technical coordinator/i.test(member.role),
        ) ?? input.context.projectContext.teamMembers[0];

        baseFields.push({
            fieldName: 'COORDENADOR_TECNICO',
            value: coordinator?.name ?? 'A definir',
            evidence: [{
                sourceType: 'Document',
                sourceId: coordinator?.name ?? 'team-member',
                sourceName: 'ProjectContext.teamMembers',
                location: 'teamMembers.role',
                snippet: `${coordinator?.name ?? 'N/A'} - ${coordinator?.role ?? 'N/A'}`.slice(0, 200),
            }],
            confidence: coordinator ? 0.85 : 0.5,
            status: coordinator ? 'filled' : 'pending',
            contextUsed: ['projectContext.teamMembers'],
        });

        const topActivities = workItems.slice(0, 8).map((wi, index) => {
            const people = wi.assignedTo ? [wi.assignedTo] : ['Equipe do projeto'];
            return {
                NUMERO_ATIVIDADE: String(index + 1),
                NOME_ATIVIDADE: wi.title,
                PERIODO_ATIVIDADE: input.context.periodKey,
                DESCRICAO_ATIVIDADE: wi.description?.slice(0, 1200) || `Work item ${wi.workItemId} (${wi.state}).`,
                JUSTIFICATIVA_ATIVIDADE: `Atividade priorizada no periodo ${input.context.periodKey}.`,
                RESULTADO_OBTIDO_ATIVIDADE: wi.state === 'Closed' || wi.state === 'Done'
                    ? 'Atividade concluida no periodo.'
                    : 'Atividade em andamento no periodo.',
                DISPENDIOS_ATIVIDADE: 'A apurar conforme controles financeiros do projeto.',
                RESPONSAVEIS: people.map((name) => ({
                    NOME_RESPONSAVEL: name,
                    CPF_RESPONSAVEL: formatCpf('00000000000'),
                    JUSTIFICATIVA_RESPONSAVEL: `Responsavel registrado no work item ${wi.workItemId}.`,
                })),
                _evidence: wi,
            };
        });

        const activitiesField: RDAFieldResult = {
            fieldName: 'ATIVIDADES',
            value: topActivities.map(({ _evidence: _ignored, ...rest }) => rest),
            evidence: topActivities.map((item) => ({
                sourceType: 'WorkItem' as const,
                sourceId: item._evidence.id,
                sourceName: item._evidence.title,
                location: `WI#${item._evidence.workItemId}`,
                snippet: (item._evidence.description || item._evidence.title).slice(0, 200),
                timestamp: item._evidence.changedDate.toISOString(),
            })),
            confidence: topActivities.length > 0 ? 0.9 : 0.4,
            status: topActivities.length > 0 ? 'filled' : 'pending',
            contextUsed: ['workItemSnapshots'],
        };

        const resultsSummary = [
            `Foram consolidados ${input.context.monthlySnapshot.workItemsTotal} work items no periodo.`,
            `Sprints consideradas: ${input.context.monthlySnapshot.sprintsCount}.`,
            `Paginas wiki atualizadas: ${input.context.monthlySnapshot.wikiPagesUpdated}.`,
        ].join(' ');

        const resultField: RDAFieldResult = {
            fieldName: 'RESULTADOS_ALCANCADOS',
            value: resultsSummary,
            evidence: sprints.slice(0, 3).map((sp) => ({
                sourceType: 'Sprint' as const,
                sourceId: sp.id,
                sourceName: sp.sprintName,
                location: `${formatDate(sp.startDate)} a ${formatDate(sp.endDate)}`,
                snippet: `Itens: ${sp.completedItems}/${sp.totalWorkItems}`,
            })),
            confidence: 0.82,
            status: 'filled',
            contextUsed: ['sprintSnapshots', 'monthlySnapshot'],
        };

        const section: SectionExtractionResult = {
            sectionName: 'rda',
            fields: [...baseFields, activitiesField, resultField],
            chunksQueried: input.context.chunkStats.total,
            tokensUsed: { input: 0, output: 0 },
            duration: Date.now() - startedAt,
        };

        try {
            const prompt = buildExtractorPrompt(input.context, workItems, sprints);
            const llm = await claudeService.complete(prompt, {
                systemPrompt: EXTRACTOR_SYSTEM_PROMPT,
                maxTokens: 1200,
                temperature: 0.2,
            });

            section.tokensUsed = { input: Math.max(0, llm.tokensUsed - 200), output: Math.min(200, llm.tokensUsed) };
        } catch {
            this.logWarn('LLM enrichment indisponivel, seguindo extracao deterministica');
        }

        const output: ExtractionOutput = {
            sections: [section],
            totalTokens: section.tokensUsed,
            totalDuration: Date.now() - startedAt,
        };

        await this.mergePartialResults(input.generationId, { extraction: output });
        await this.updateProgress(input.generationId, 30, 'extractor_done');

        return output;
    }

    async extractSection(input: ExtractorInput, sectionName: ReviewSectionName): Promise<ExtractionOutput> {
        const full = await this.run(input);
        const allowed = SECTION_FIELD_NAMES[sectionName];
        const sections = full.sections.map((section) => ({
            ...section,
            fields: section.fields.filter((field) => allowed.has(field.fieldName)),
        }));

        return {
            ...full,
            sections,
        };
    }
}
