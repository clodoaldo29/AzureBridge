import { AgentContext } from '@/types/rda.types';

interface PromptBundle {
    systemPrompt: string;
    prompt: string;
}

interface WriterSection {
    title: string;
    content: string;
    subsections?: Array<{
        title: string;
        content: string;
    }>;
}

interface ReviewerIssue {
    section: string;
    type: 'error' | 'warning' | 'suggestion';
    description: string;
    suggestion: string;
}

function toJsonBlock(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

function toJsonBlockCapped(value: unknown, maxChars: number): string {
    const json = JSON.stringify(value, null, 2);
    return json.length > maxChars ? `${json.slice(0, maxChars)}\n...` : json;
}

function truncate(value: string, maxLength: number): string {
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function extractUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s)>"'<]+/gi) ?? [];
    return Array.from(new Set(matches));
}

function compactWorkItems(items: Array<Record<string, unknown>>, limit: number): Array<Record<string, unknown>> {
    return items.slice(0, limit).map((item) => ({
        ...item,
        title: typeof item.title === 'string' ? truncate(item.title, 140) : item.title,
        url: typeof item.url === 'string' ? truncate(item.url, 220) : item.url,
    }));
}

function buildProjectEvidence(context: AgentContext) {
    if (context.evidencePack) {
        return {
            workItems: context.evidencePack.pbiReferences,
            wikiLinks: [
                ...context.evidencePack.designLinks.map((item) => ({ ...item, kind: 'design' as const })),
                ...context.evidencePack.wikiLinks.map((item) => ({ ...item, kind: 'wiki' as const })),
            ],
            plannedVsDelivered: {
                totalPlannedStoryPoints: context.evidencePack.plannedVsDelivered.plannedStoryPoints,
                totalDeliveredStoryPoints: context.evidencePack.plannedVsDelivered.deliveredStoryPoints,
                completionRatePercent: context.evidencePack.plannedVsDelivered.completionRatePercent,
                periodStart: context.evidencePack.period.start,
                periodEnd: context.evidencePack.period.end,
            },
        };
    }

    const workItems = context.workItems
        .filter((item) => Boolean(item.url))
        .map((item) => ({
            azureId: item.azureId,
            title: item.title,
            type: item.type,
            state: item.state,
            url: item.url,
        }));

    const wikiLinks = context.wikiPages.flatMap((page) => {
        const urls = extractUrls(page.content);
        return urls.map((url) => ({
            pageTitle: page.title,
            pagePath: page.path,
            url,
            kind: /figma|design|prototype|wireframe|mockup/i.test(url) ? ('design' as const) : ('wiki' as const),
        }));
    });

    const totalPlannedStoryPoints = context.workItems.reduce((sum, item) => sum + (item.storyPoints ?? 0), 0);
    const totalDeliveredStoryPoints = context.workItems
        .filter((item) => /done|closed|resolved/i.test(item.state ?? ''))
        .reduce((sum, item) => sum + (item.storyPoints ?? 0), 0);
    const completionRatePercent = totalPlannedStoryPoints > 0
        ? Number(((totalDeliveredStoryPoints / totalPlannedStoryPoints) * 100).toFixed(2))
        : 0;

    return {
        workItems,
        wikiLinks,
        plannedVsDelivered: {
            totalPlannedStoryPoints,
            totalDeliveredStoryPoints,
            completionRatePercent,
            periodStart: context.request.periodStart,
            periodEnd: context.request.periodEnd,
        },
    };
}

export function buildDataCollectorPrompt(
    context: AgentContext,
    statistics: { totalWorkItems: number; totalSprints: number; totalDocuments: number; totalWikiPages: number },
    workItemsByType: Record<string, number>,
    workItemsByState: Record<string, number>,
    sprintsSummary: Array<{ sprintName: string; startDate: string; endDate: string; velocity: number; capacityUtilization: number }>,
): PromptBundle {
    const evidences = buildProjectEvidence(context);
    const documents = context.documents.map((doc) => ({
        filename: doc.filename,
        sizeBytes: doc.sizeBytes,
        extractedTextPreview: truncate((doc.extractedText ?? '').replace(/\s+/g, ' ').trim(), 900),
    }));

    const projectName = context.evidencePack?.project.name ?? context.request.projectId;

    const systemPrompt = [
        'Voce e um especialista em governanca de entregas de software.',
        'Sua tarefa e estruturar o pacote de evidencias do relatorio mensal.',
        'Priorize dados auditaveis e objetivos, sem invencoes.',
    ].join(' ');

    const prompt = [
        'Monte um resumo executivo em portugues (ate 220 palavras) com foco em:',
        '1) Planejado x realizado no periodo',
        '2) Itens entregues e pendencias',
        '3) Referencias de evidencia (PBIs e links wiki/design)',
        '',
        'Retorne SOMENTE JSON valido, sem markdown, no formato:',
        '{',
        '  "executiveSummary": "",',
        '  "keyDeliveries": ["..."],',
        '  "keyPendingItems": ["..."],',
        '  "evidenceStats": {',
        '    "workItemUrls": 0,',
        '    "designLinks": 0,',
        '    "wikiLinks": 0',
        '  }',
        '}',
        '',
        `Projeto/Periodo: ${projectName} (${context.request.periodStart} ate ${context.request.periodEnd})`,
        `Estatisticas: ${toJsonBlock(statistics)}`,
        `Work items por tipo: ${toJsonBlock(workItemsByType)}`,
        `Work items por estado: ${toJsonBlock(workItemsByState)}`,
        `Sprints: ${toJsonBlock(sprintsSummary)}`,
        `Planejado vs realizado (story points): ${toJsonBlock(evidences.plannedVsDelivered)}`,
        `Evidencias de PBIs (URL): ${toJsonBlock(compactWorkItems(evidences.workItems, 20))}`,
        `Links wiki/design detectados: ${toJsonBlock(evidences.wikiLinks.slice(0, 25))}`,
        `Documentos (previa): ${toJsonBlock(documents.slice(0, 8))}`,
    ].join('\n');

    return { systemPrompt, prompt };
}

export function buildAnalyzerPrompt(context: AgentContext, collectorData: unknown): PromptBundle {
    const evidences = buildProjectEvidence(context);
    const documentsContext = context.documents.map((document) => ({
        filename: document.filename,
        extractedText: truncate((document.extractedText ?? '').replace(/\s+/g, ' ').trim(), 2600),
    }));

    const wikiContext = context.wikiPages.map((page) => ({
        title: page.title,
        path: page.path,
        content: truncate(page.content.replace(/\s+/g, ' ').trim(), 2200),
        urls: extractUrls(page.content),
    }));

    const systemPrompt = [
        'Voce e um consultor senior de delivery e qualidade de software.',
        'Analise o periodo com foco em desempenho real, riscos e rastreabilidade.',
        'Nao invente dados; use somente os dados recebidos.',
    ].join(' ');

    const prompt = [
        'Retorne SOMENTE JSON valido, sem markdown, no formato:',
        '{',
        '  "performance": { "velocity": "", "throughput": "", "leadTime": "" },',
        '  "quality": { "bugRate": "", "rework": "" },',
        '  "deliveryComparison": { "planned": "", "delivered": "", "gapAnalysis": "" },',
        '  "risks": [ { "type": "", "description": "", "severity": "low|medium|high|critical", "mitigation": "" } ],',
        '  "trends": { "chave": "valor" },',
        '  "recommendations": ["..."],',
        '  "traceability": {',
        '    "pbiReferences": [ { "id": 0, "title": "", "url": "" } ],',
        '    "designReferences": [ { "title": "", "url": "", "sourcePage": "" } ]',
        '  }',
        '}',
        '',
        'Regras de analise:',
        '- explique diferenca entre planejado e entregue no periodo;',
        '- cite gargalos e riscos que impactaram entrega;',
        '- use rastreabilidade com URLs de PBI e links de design/wiki;',
        '',
        `Dados coletados: ${toJsonBlock(collectorData)}`,
        `Planejado vs realizado: ${toJsonBlock(evidences.plannedVsDelivered)}`,
        `PBIs com URL: ${toJsonBlock(compactWorkItems(evidences.workItems, 25))}`,
        `Links wiki/design: ${toJsonBlock(evidences.wikiLinks.slice(0, 30))}`,
        `Documentos: ${toJsonBlock(documentsContext.slice(0, 6))}`,
        `Wiki: ${toJsonBlock(wikiContext.slice(0, 10))}`,
    ].join('\n');

    return { systemPrompt, prompt };
}

export function buildWriterPrompt(context: AgentContext, collectorData: unknown, analyzerData: unknown): PromptBundle {
    const contract = context.template.templateContract;

    const systemPrompt = [
        'Voce e redator tecnico de relatorios mensais executivos.',
        'Preencha conteudo orientado ao contrato do template, preservando rastreabilidade.',
        'Use portugues formal e objetivo.',
    ].join(' ');

    const prompt = [
        'Retorne SOMENTE JSON valido, sem markdown, no formato:',
        '{',
        '  "sections": [',
        '    {',
        '      "title": "",',
        '      "content": "",',
        '      "subsections": [ { "title": "", "content": "" } ]',
        '    }',
        '  ],',
        '  "metadata": {',
        '    "wordCount": 0,',
        '    "keyHighlights": ["..."],',
        '    "templateAlignmentNotes": ["..."]',
        '  },',
        '  "templateFieldValues": {',
        '    "PLACEHOLDER_NAME": "valor"',
        '  }',
        '}',
        '',
        'Regras obrigatorias:',
        '- preencher por contrato do template (requiredFields);',
        '- considerar template fixo com placeholders principais: PROJETO_NOME, ANO_BASE, COMPETENCIA, COORDENADOR_TECNICO, ATIVIDADES[*], RESPONSAVEIS[*], RESULTADOS_ALCANCADOS;',
        '- NAO inventar CPF; deixar vazio quando nao houver fonte confiavel;',
        '- descrever atividades com foco em: o que foi feito, quem participou, tecnologias/metodologia, vinculacao ao escopo e entregas;',
        '- justificativas e resultados devem ser auditaveis e coerentes com backlog/wiki/documentos;',
        '- incluir planejado vs realizado;',
        '- incluir referencias de PBIs com URL;',
        '- incluir links de design/wiki quando houver;',
        '- manter linguagem factual e auditavel.',
        '',
        `Template ativo: ${toJsonBlockCapped(context.template, 3000)}`,
        `Template contract: ${toJsonBlockCapped(contract ?? null, 4500)}`,
        `Evidence pack (resumido): ${toJsonBlockCapped({
            project: context.evidencePack?.project,
            period: context.evidencePack?.period,
            plannedVsDelivered: context.evidencePack?.plannedVsDelivered,
            pbiReferences: context.evidencePack?.pbiReferences?.slice(0, 15),
            designLinks: context.evidencePack?.designLinks?.slice(0, 12),
            wikiLinks: context.evidencePack?.wikiLinks?.slice(0, 12),
            sprintPlan: context.evidencePack?.sprintPlan?.slice(0, 6),
        }, 7000)}`,
        `Dados do coletor (resumido): ${toJsonBlockCapped(collectorData, 5000)}`,
        `Analise (resumida): ${toJsonBlockCapped(analyzerData, 7000)}`,
    ].join('\n');

    return { systemPrompt, prompt };
}

export function buildReviewerPrompt(writerData: unknown): PromptBundle {
    const sections = (writerData as { sections?: WriterSection[] })?.sections ?? [];
    const sectionTitles = sections.map((section) => section.title);

    const systemPrompt = [
        'Voce e revisor tecnico e linguistico de relatorios corporativos.',
        'Valide completude, consistencia, gramatica e rastreabilidade das evidencias.',
    ].join(' ');

    const prompt = [
        'Retorne SOMENTE JSON valido, sem markdown, no formato:',
        '{',
        '  "issues": [',
        '    { "section": "", "type": "error|warning|suggestion", "description": "", "suggestion": "" }',
        '  ],',
        '  "overallQuality": "excellent|good|needs_improvement|poor",',
        '  "improvements": ["..."],',
        '  "approved": true,',
        '  "traceabilityCheck": {',
        '    "hasPbiUrls": true,',
        '    "hasDesignLinks": true,',
        '    "missingEvidenceSections": ["..."]',
        '  }',
        '}',
        '',
        'Criterios obrigatorios de validacao:',
        '- coerencia entre planejado e realizado;',
        '- presenca de referencias de PBI e links de design/wiki;',
        '- clareza e objetividade executiva;',
        '',
        `Titulos identificados: ${toJsonBlock(sectionTitles)}`,
        `Conteudo para revisao: ${toJsonBlock(writerData)}`,
    ].join('\n');

    return { systemPrompt, prompt };
}

export function summarizeReviewerIssues(issues: ReviewerIssue[]): string {
    if (!issues.length) {
        return 'Sem apontamentos criticos.';
    }

    const topIssues = issues.slice(0, 5).map((issue) => `${issue.type.toUpperCase()} [${issue.section}]: ${issue.description}`);
    return topIssues.join(' | ');
}
