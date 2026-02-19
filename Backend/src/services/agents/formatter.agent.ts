import {
    AgentContext,
    RDATemplateActivityPayload,
    RDATemplateDocPayload,
    RDATemplateResponsiblePayload,
    WorkItemData,
} from '@/types/rda.types';
import { BaseAgent } from './base.agent';

interface FormatterSection {
    title: string;
    content: string;
    subsections: Array<{
        title: string;
        content: string;
    }>;
}

interface FormatterOutput {
    replacements: Record<string, string>;
    templatePayload?: RDATemplateDocPayload;
    structuredData?: {
        projectName: string;
        periodStart: string;
        periodEnd: string;
        yearBase: string;
        competence: string;
        technicalCoordinator: string;
        activityName: string;
        activityDescription: string;
        activityJustification: string;
        activityResult: string;
    };
    sections: FormatterSection[];
    reviewApproved: boolean;
    qualityScore: string;
    tokensUsed: number;
}

interface WriterResultData {
    sections: FormatterSection[];
    templateFieldValues?: Record<string, string>;
    metadata?: {
        keyHighlights?: string[];
    };
}

interface ReviewerResultData {
    approved: boolean;
    overallQuality: string;
}

interface AnalyzerResultData {
    deliveryComparison?: {
        planned?: string;
        delivered?: string;
        gapAnalysis?: string;
    };
    recommendations?: string[];
}

type ActivityFront =
    | 'frontend'
    | 'backend'
    | 'infra'
    | 'quality'
    | 'documentation'
    | 'general';

interface ActivityGroup {
    front: ActivityFront;
    items: WorkItemData[];
}

export class FormatterAgent extends BaseAgent {
    readonly name = 'FormatterAgent';
    readonly description = 'Prepara placeholders e estrutura para geracao do DOCX';

    protected async run(context: AgentContext): Promise<FormatterOutput> {
        await this.updateProgress(context.generationId, 90, 'formatting_start');

        const writerResult = context.previousResults.find((result) => result.agentName === 'WriterAgent');
        const reviewerResult = context.previousResults.find((result) => result.agentName === 'ReviewerAgent');

        if (!writerResult?.success || !writerResult.data) {
            throw new Error('Resultado do WriterAgent nao encontrado para formatacao.');
        }

        if (!reviewerResult?.success || !reviewerResult.data) {
            throw new Error('Resultado do ReviewerAgent nao encontrado para formatacao.');
        }

        const writerData = writerResult.data as WriterResultData;
        const reviewerData = reviewerResult.data as ReviewerResultData;
        const analyzerData = (context.previousResults.find((result) => result.agentName === 'AnalyzerAgent')?.data ?? {}) as AnalyzerResultData;
        const sections = writerData.sections ?? [];
        const templateFields = writerData.templateFieldValues ?? {};
        const contractFields = context.template.templateContract?.requiredFields ?? [];
        const evidencePack = context.evidencePack;
        const competence = this.buildCompetence(context.request.periodStart);
        const yearBase = String(new Date(`${context.request.periodStart}T00:00:00`).getUTCFullYear());

        const replacements: Record<string, string> = {
            '{{PROJECT_NAME}}': evidencePack?.project.name ?? context.request.projectId,
            '{{PERIOD_START}}': context.request.periodStart,
            '{{PERIOD_END}}': context.request.periodEnd,
            '{{GENERATION_DATE}}': new Date().toISOString().slice(0, 10),
            '{{PROJECT_ID}}': context.request.projectId,
            '{{PERIOD_TYPE}}': context.request.periodType,
        };

        Object.entries(templateFields).forEach(([key, value]) => {
            if (typeof value !== 'string') {
                return;
            }

            this.assignReplacement(replacements, key, value);
        });

        contractFields.forEach((field) => {
            const key = field.placeholder;
            if (replacements[key]) {
                return;
            }

            const fallbackValue = this.resolveContractFallbackValue(field.key, context, writerData);
            if (fallbackValue) {
                replacements[key] = fallbackValue;
            }
        });

        sections.forEach((section, index) => {
            const position = index + 1;
            replacements[`{{SECTION_${position}_TITLE}}`] = section.title;
            replacements[`{{SECTION_${position}_CONTENT}}`] = section.content;

            section.subsections.forEach((subsection, subsectionIndex) => {
                const subsectionPosition = subsectionIndex + 1;
                replacements[`{{SECTION_${position}_SUB_${subsectionPosition}_TITLE}}`] = subsection.title;
                replacements[`{{SECTION_${position}_SUB_${subsectionPosition}_CONTENT}}`] = subsection.content;
            });
        });

        const templatePayload = this.applyFixedTemplateReplacements(replacements, context, writerData, analyzerData);

        await this.updateProgress(context.generationId, 95, 'formatting_done');

        const activitySection = sections.find((section) => /atividades?/i.test(section.title));
        const justificationSection = sections.find((section) => /riscos|licoes aprendidas|qualidade/i.test(section.title));
        const resultSection = sections.find((section) => /performance|conclusao|sumario/i.test(section.title));
        const technicalCoordinator = context.request.generatedBy || 'Coordenacao Tecnica';

        return {
            replacements,
            templatePayload,
            structuredData: {
                projectName: evidencePack?.project.name ?? context.request.projectId,
                periodStart: context.request.periodStart,
                periodEnd: context.request.periodEnd,
                yearBase,
                competence,
                technicalCoordinator,
                activityName: activitySection?.title ?? 'Atividade Principal do Periodo',
                activityDescription: activitySection?.content ?? 'Atividade desenvolvida no periodo conforme escopo aprovado.',
                activityJustification:
                    justificationSection?.content ??
                    'Atividade necessaria para cumprimento do plano de trabalho e dos objetivos do projeto.',
                activityResult:
                    resultSection?.content ??
                    'Resultados alcancados no periodo com base nas evidencias registradas no projeto.',
            },
            sections,
            reviewApproved: Boolean(reviewerData.approved),
            qualityScore: reviewerData.overallQuality || 'unknown',
            tokensUsed: 0,
        };
    }

    private applyFixedTemplateReplacements(
        replacements: Record<string, string>,
        context: AgentContext,
        writerData: WriterResultData,
        analyzerData: AnalyzerResultData,
    ): RDATemplateDocPayload {
        const evidence = context.evidencePack;
        const periodDate = new Date(`${context.request.periodStart}T00:00:00`);
        const anoBase = String(periodDate.getUTCFullYear());
        const competencia = this.buildCompetence(context.request.periodStart);
        const atividades = this.buildAtividadesPayload(context, writerData, analyzerData);
        const resultadosAlcancados = this.buildResultadosAlcancados(context, writerData, analyzerData, atividades);

        this.assignReplacement(replacements, 'PROJETO_NOME', evidence?.project.name ?? context.request.projectId);
        this.assignReplacement(replacements, 'ANO_BASE', anoBase);
        this.assignReplacement(replacements, 'COMPETENCIA', `${competencia}/${anoBase}`);
        this.assignReplacement(replacements, 'COORDENADOR_TECNICO', context.request.generatedBy || 'Coordenacao Tecnica');
        this.assignReplacement(replacements, 'RESULTADOS_ALCANCADOS', resultadosAlcancados);
        this.assignReplacement(replacements, 'RESULTADOS_ALCANÇADOS', resultadosAlcancados);

        const primeiraAtividade = atividades[0];
        if (primeiraAtividade) {
            this.assignReplacement(replacements, 'NOME_ATIVIDADE', primeiraAtividade.NOME_ATIVIDADE);
            this.assignReplacement(replacements, 'PERIODO_ATIVIDADE', primeiraAtividade.PERIODO_ATIVIDADE);
            this.assignReplacement(replacements, 'DESCRICAO_ATIVIDADE', primeiraAtividade.DESCRICAO_ATIVIDADE);
            this.assignReplacement(replacements, 'JUSTIFICATIVA_ATIVIDADE', primeiraAtividade.JUSTIFICATIVA_ATIVIDADE);
            this.assignReplacement(replacements, 'RESULTADO_OBTIDO_ATIVIDADE', primeiraAtividade.RESULTADO_OBTIDO_ATIVIDADE);
            this.assignReplacement(replacements, 'DISPENDIOS_ATIVIDADE', primeiraAtividade.DISPENDIOS_ATIVIDADE);
            const nomesResponsaveis = primeiraAtividade.RESPONSAVEIS.map((item) => item.NOME_RESPONSAVEL).join('\n');
            this.assignReplacement(replacements, 'RESPONSAVEL_ATIVIDADE', nomesResponsaveis);
            this.assignReplacement(replacements, 'CPF_RESPONSAVEL', '');
            this.assignReplacement(replacements, 'CPF_RESPONSÀVEL', '');
        }

        return {
            PROJETO_NOME: evidence?.project.name ?? context.request.projectId,
            ANO_BASE: anoBase,
            COMPETENCIA: `${competencia}/${anoBase}`,
            COORDENADOR_TECNICO: context.request.generatedBy || 'Coordenacao Tecnica',
            ATIVIDADES: atividades,
            RESULTADOS_ALCANCADOS: resultadosAlcancados,
        };
    }

    private buildAtividadesPayload(
        context: AgentContext,
        writerData: WriterResultData,
        analyzerData: AnalyzerResultData,
    ): RDATemplateActivityPayload[] {
        const source = this.selectSourceItems(context.workItems);
        const grouped = this.groupByActivityFront(source);
        const selectedGroups = this.limitGroups(grouped, 8);
        const activitySection = writerData.sections.find((section) => /atividade/i.test(section.title));

        if (selectedGroups.length === 0) {
            return [this.buildFallbackActivity(context, writerData, analyzerData)];
        }

        return selectedGroups.map((group, index) => {
            const numero = String(index + 1).padStart(2, '0');
            const itemDates = group.items
                .map((item) => item.changedDate ?? item.createdDate)
                .filter((date): date is Date => Boolean(date));
            const minDate = this.minDate(itemDates);
            const maxDate = this.maxDate(itemDates);
            const periodoAtividade = minDate && maxDate
                ? `${this.formatDateBr(minDate)} a ${this.formatDateBr(maxDate)}`
                : `${context.request.periodStart} a ${context.request.periodEnd}`;

            const pbiLines = group.items.slice(0, 12).map((item) => `${item.azureId} - ${item.title}`);
            const pbiUrls = group.items.slice(0, 12).map((item) => item.url).filter(Boolean);
            const designLinks = (context.evidencePack?.designLinks ?? []).slice(0, 8).map((link) => `${link.title}: ${link.url}`);
            const responsaveis = this.extractResponsaveis(group.items, context.request.generatedBy);
            const nomeAtividade = this.buildActivityName(group.front, group.items, index);
            const doneItems = group.items.filter((item) => /done|closed|resolved/i.test(item.state ?? '')).length;

            const descricaoAtividade = [
                `No periodo ${periodoAtividade}, foi conduzida a atividade "${nomeAtividade}" com foco na execucao do escopo tecnico priorizado para a competencia.`,
                `A frente contou com ${group.items.length} item(ns) de backlog vinculados, incluindo analise, desenvolvimento, validacao e registro de evidencias em Azure DevOps.`,
                `Foi utilizada metodologia agil com acompanhamento por sprint e rastreabilidade por Work Items, mantendo aderencia ao planejamento do projeto.`,
                activitySection?.content ?? '',
                pbiLines.length > 0 ? `Itens relacionados:\n${pbiLines.join('\n')}` : '',
                pbiUrls.length > 0 ? `URLs dos PBIs:\n${pbiUrls.join('\n')}` : '',
                designLinks.length > 0 ? `Links de design/wiki de apoio:\n${designLinks.join('\n')}` : '',
            ].filter(Boolean).join('\n\n');

            const justificativaAtividade = [
                `A atividade foi necessaria para evolucao da frente ${this.frontLabel(group.front)} e cumprimento dos objetivos previstos no plano de trabalho do periodo.`,
                `A execucao desta frente sustenta as entregas tecnicas esperadas para o mes de referencia e reduz riscos de atraso em marcos dependentes.`,
                analyzerData.deliveryComparison?.gapAnalysis ?? '',
            ].filter(Boolean).join('\n\n');

            const resultadoObtido = [
                `Foram trabalhados ${group.items.length} item(ns), com ${doneItems} concluido(s) no periodo desta atividade.`,
                `A rastreabilidade foi mantida por URLs de PBI e atualizacoes de status no Azure DevOps, permitindo auditoria do progresso realizado.`,
                context.evidencePack
                    ? `Planejado x entregue (story points): ${context.evidencePack.plannedVsDelivered.plannedStoryPoints} x ${context.evidencePack.plannedVsDelivered.deliveredStoryPoints} (${context.evidencePack.plannedVsDelivered.completionRatePercent}%).`
                    : '',
            ].filter(Boolean).join('\n\n');

            return {
                NUMERO_ATIVIDADE: numero,
                NOME_ATIVIDADE: nomeAtividade,
                PERIODO_ATIVIDADE: periodoAtividade,
                DESCRICAO_ATIVIDADE: descricaoAtividade,
                JUSTIFICATIVA_ATIVIDADE: justificativaAtividade,
                RESULTADO_OBTIDO_ATIVIDADE: resultadoObtido,
                DISPENDIOS_ATIVIDADE:
                    'Nao houve dispendios especificos identificados automaticamente para esta atividade no periodo. Caso aplicavel, preencher manualmente com fornecedor e NF.',
                RESPONSAVEIS: responsaveis,
            };
        });
    }

    private buildFallbackActivity(
        context: AgentContext,
        writerData: WriterResultData,
        analyzerData: AnalyzerResultData,
    ): RDATemplateActivityPayload {
        const responsaveis = this.extractResponsaveis([], context.request.generatedBy);
        const periodoAtividade = `${context.request.periodStart} a ${context.request.periodEnd}`;
        const activitySection = writerData.sections.find((section) => /atividade/i.test(section.title));

        return {
            NUMERO_ATIVIDADE: '01',
            NOME_ATIVIDADE: 'Consolidacao de evidencias e acompanhamento de execucao',
            PERIODO_ATIVIDADE: periodoAtividade,
            DESCRICAO_ATIVIDADE: [
                `No periodo ${periodoAtividade}, foi realizada consolidacao das evidencias do projeto para compor o relatorio demonstrativo anual.`,
                activitySection?.content ?? 'Atividade baseada na consolidacao de documentos, wiki e backlog do periodo selecionado.',
            ].filter(Boolean).join('\n\n'),
            JUSTIFICATIVA_ATIVIDADE: analyzerData.deliveryComparison?.gapAnalysis
                ?? 'Atividade necessaria para manter rastreabilidade das entregas e suportar a governanca do projeto.',
            RESULTADO_OBTIDO_ATIVIDADE:
                'Consolidacao realizada com dados disponiveis no periodo, com necessidade de complemento manual caso haja informacoes externas nao indexadas.',
            DISPENDIOS_ATIVIDADE:
                'Nao houve dispendios especificos identificados automaticamente para esta atividade no periodo.',
            RESPONSAVEIS: responsaveis,
        };
    }

    private buildResultadosAlcancados(
        context: AgentContext,
        writerData: WriterResultData,
        analyzerData: AnalyzerResultData,
        atividades: RDATemplateActivityPayload[],
    ): string {
        const evidence = context.evidencePack;
        const resultSection = writerData.sections.find((section) => /resultado|conclusao|sumario/i.test(section.title));
        const doneItems = context.workItems.filter((item) => /done|closed|resolved/i.test(item.state ?? '')).length;

        return [
            `No periodo de ${context.request.periodStart} a ${context.request.periodEnd}, o projeto apresentou consolidacao de ${atividades.length} frente(s) de atividade com evidencias rastreaveis no Azure DevOps.`,
            evidence
                ? `Foram entregues ${evidence.plannedVsDelivered.deliveredItems} item(ns) de ${evidence.plannedVsDelivered.plannedItems} planejado(s), com ${evidence.plannedVsDelivered.completionRatePercent}% de conclusao e ${evidence.plannedVsDelivered.deliveredStoryPoints} story points realizados.`
                : `Foram identificados ${doneItems} item(ns) concluidos no periodo com atualizacao de status e historico de execucao.`,
            resultSection?.content ?? '',
            analyzerData.recommendations && analyzerData.recommendations.length > 0
                ? `Proximos passos recomendados:\n- ${analyzerData.recommendations.slice(0, 4).join('\n- ')}`
                : '',
        ].filter(Boolean).join('\n\n');
    }

    private selectSourceItems(items: WorkItemData[]): WorkItemData[] {
        const ordered = [...items].sort((a, b) => {
            const left = new Date(a.changedDate ?? a.createdDate ?? 0).getTime();
            const right = new Date(b.changedDate ?? b.createdDate ?? 0).getTime();
            return left - right;
        });

        const delivered = ordered.filter((item) => /done|closed|resolved/i.test(item.state ?? ''));
        return (delivered.length > 0 ? delivered : ordered).slice(0, 120);
    }

    private groupByActivityFront(items: WorkItemData[]): ActivityGroup[] {
        const groups = new Map<ActivityFront, WorkItemData[]>();

        items.forEach((item) => {
            const front = this.detectFront(item);
            const bucket = groups.get(front) ?? [];
            bucket.push(item);
            groups.set(front, bucket);
        });

        return Array.from(groups.entries())
            .map(([front, groupItems]) => ({ front, items: groupItems }))
            .filter((group) => group.items.length > 0)
            .sort((a, b) => b.items.length - a.items.length);
    }

    private limitGroups(groups: ActivityGroup[], maxGroups: number): ActivityGroup[] {
        if (groups.length <= maxGroups) {
            return groups;
        }

        const kept = groups.slice(0, maxGroups - 1);
        const overflow = groups.slice(maxGroups - 1).flatMap((group) => group.items);
        kept.push({ front: 'general', items: overflow });
        return kept;
    }

    private detectFront(item: WorkItemData): ActivityFront {
        const text = `${item.type} ${item.title} ${item.description ?? ''}`.toLowerCase();

        if (/(react|frontend|front-end|ui|ux|tela|layout|css|html|javascript|typescript)/.test(text)) {
            return 'frontend';
        }

        if (/(api|backend|back-end|endpoint|service|microservice|dotnet|\.net|c#|java|node|database|sql|banco)/.test(text)) {
            return 'backend';
        }

        if (/(infra|docker|kubernetes|pipeline|ci\/cd|deploy|devops|cloud|aws|azure)/.test(text)) {
            return 'infra';
        }

        if (/(qa|teste|test|bug|homolog|quality|qualidade|regressao)/.test(text)) {
            return 'quality';
        }

        if (/(wiki|documenta|spec|requisito|processo|manual|guia)/.test(text)) {
            return 'documentation';
        }

        return 'general';
    }

    private buildActivityName(front: ActivityFront, items: WorkItemData[], index: number): string {
        const top = items[0]?.title;
        if (top && top.length <= 90 && items.length === 1) {
            return top;
        }

        const labels: Record<ActivityFront, string> = {
            frontend: 'Desenvolvimento de interfaces e experiencia do usuario',
            backend: 'Implementacao de servicos e regras de negocio',
            infra: 'Configuracao de infraestrutura e automacao de deploy',
            quality: 'Validacao funcional e qualidade de software',
            documentation: 'Documentacao tecnica e requisitos do projeto',
            general: 'Evolucao geral das entregas do projeto',
        };

        return `${labels[front]} (atividade ${String(index + 1).padStart(2, '0')})`;
    }

    private frontLabel(front: ActivityFront): string {
        const labels: Record<ActivityFront, string> = {
            frontend: 'frontend',
            backend: 'backend e regras de negocio',
            infra: 'infraestrutura e operacao',
            quality: 'qualidade e testes',
            documentation: 'documentacao e requisitos',
            general: 'entregas gerais',
        };

        return labels[front];
    }

    private extractResponsaveis(items: WorkItemData[], fallbackName: string): RDATemplateResponsiblePayload[] {
        const names = Array.from(new Set(items.map((item) => (item.assignedToId ?? '').trim()).filter(Boolean)));
        const effective = names.length > 0 ? names : [fallbackName || 'Equipe Tecnica'];

        return effective.slice(0, 8).map((name) => {
            const itemsByPerson = items.filter((item) => (item.assignedToId ?? '').trim() === name);
            const role = this.inferRole(itemsByPerson);

            return {
                NOME_RESPONSAVEL: name,
                CPF_RESPONSAVEL: '',
                JUSTIFICATIVA_RESPONSAVEL: `${role}: Responsavel pela execucao tecnica dos itens vinculados a esta atividade, incluindo planejamento, implementacao e atualizacao das evidencias no Azure DevOps durante o periodo reportado.`,
            };
        });
    }

    private inferRole(items: WorkItemData[]): string {
        if (items.length === 0) {
            return 'Profissional tecnico';
        }

        const text = items
            .map((item) => `${item.type} ${item.title} ${item.description ?? ''}`)
            .join(' ')
            .toLowerCase();

        if (/(react|frontend|ui|ux|css|tela)/.test(text)) return 'Desenvolvedor Frontend';
        if (/(api|backend|service|database|sql|dotnet|c#)/.test(text)) return 'Desenvolvedor Backend';
        if (/(infra|docker|pipeline|deploy|devops|cloud)/.test(text)) return 'Engenheiro DevOps';
        if (/(qa|teste|bug|homolog|quality)/.test(text)) return 'Analista de Qualidade';
        if (/(documenta|wiki|requisito|spec)/.test(text)) return 'Analista Funcional';

        return 'Profissional tecnico';
    }

    private assignReplacement(replacements: Record<string, string>, key: string, value: string): void {
        const raw = key.replace(/[{}]/g, '').trim();
        if (!raw) {
            return;
        }

        const normalized = this.normalizeKey(raw);
        const resolved = value ?? '';
        replacements[`{{${raw}}}`] = resolved;
        replacements[`{{${normalized}}}`] = resolved;
    }

    private normalizeKey(value: string): string {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toUpperCase();
    }

    private minDate(values: Date[]): Date | null {
        if (values.length === 0) {
            return null;
        }
        return new Date(Math.min(...values.map((date) => date.getTime())));
    }

    private maxDate(values: Date[]): Date | null {
        if (values.length === 0) {
            return null;
        }
        return new Date(Math.max(...values.map((date) => date.getTime())));
    }

    private formatDateBr(date: Date): string {
        return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
    }

    private buildCompetence(periodStart: string): string {
        const date = new Date(`${periodStart}T00:00:00`);
        const formatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });
        const month = formatter.format(date).replace(/\b\w/g, (char) => char.toUpperCase());
        return month;
    }

    private resolveContractFallbackValue(
        key: string,
        context: AgentContext,
        writerData: WriterResultData,
    ): string {
        const normalized = key.toUpperCase();
        const evidencePack = context.evidencePack;

        if (normalized.includes('PROJECT_NAME')) {
            return evidencePack?.project.name ?? context.request.projectId;
        }

        if (normalized.includes('PROJECT_ID')) {
            return context.request.projectId;
        }

        if (normalized.includes('PERIOD_START')) {
            return context.request.periodStart;
        }

        if (normalized.includes('PERIOD_END')) {
            return context.request.periodEnd;
        }

        if (normalized.includes('GENERATION_DATE')) {
            return new Date().toISOString().slice(0, 10);
        }

        if (normalized.includes('PLANNED_STORY_POINTS')) {
            return String(evidencePack?.plannedVsDelivered.plannedStoryPoints ?? 0);
        }

        if (normalized.includes('DELIVERED_STORY_POINTS')) {
            return String(evidencePack?.plannedVsDelivered.deliveredStoryPoints ?? 0);
        }

        if (normalized.includes('COMPLETION_RATE')) {
            return `${evidencePack?.plannedVsDelivered.completionRatePercent ?? 0}%`;
        }

        if (normalized.includes('PBI_URLS')) {
            return (evidencePack?.pbiReferences ?? []).slice(0, 30).map((item) => `${item.id}: ${item.url}`).join('\n');
        }

        if (normalized.includes('DESIGN_LINKS')) {
            return (evidencePack?.designLinks ?? []).slice(0, 30).map((item) => `${item.title}: ${item.url}`).join('\n');
        }

        if (normalized.includes('KEY_HIGHLIGHTS')) {
            return (writerData.metadata?.keyHighlights ?? []).join(' | ');
        }

        return '';
    }
}
