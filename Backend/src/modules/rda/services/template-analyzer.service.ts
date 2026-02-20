import { ClaudeService, claudeService } from '@/services/rda/claude.service';
import {
    DocumentStructure,
    PlaceholderDefinition,
    TemplateAnalysisResult,
    placeholderDefinitionSchema,
    templateAnalysisResultSchema,
} from '@/modules/rda/schemas/template-factory.schema';

const ANALYZE_SYSTEM_PROMPT = `Voce e um especialista em analise documental. Recebeu versoes do mesmo tipo de relatorio (RDA mensal) de periodos diferentes.
Analise a estrutura e conteudo de cada documento e identifique:
1. ESTRUTURA FIXA: secoes, headings, textos institucionais e labels que aparecem identicos ou quase identicos em todos os documentos.
2. CONTEUDO VARIAVEL: partes que mudam entre documentos. Para cada um, forneca name, type, required, section, description.
3. PADROES DE TABELA: tabelas com headers fixos e linhas variaveis devem virar placeholders de loop.
4. Para campos enum, liste valores possiveis encontrados.
Responda EXCLUSIVAMENTE em JSON valido compativel com TemplateAnalysisResult.`;

export class TemplateAnalyzerService {
    private static readonly MAX_PROMPT_CHARS = 120_000;
    private static readonly CHUNK_ELEMENT_SIZE = 80;

    constructor(private readonly claudeService: ClaudeService) {}

    async analyzeModels(structures: DocumentStructure[]): Promise<TemplateAnalysisResult> {
        if (structures.length < 2 || structures.length > 5) {
            throw new Error('A analise requer entre 2 e 5 modelos DOCX.');
        }

        console.log('[TemplateFactory] Iniciando analise comparativa dos modelos...');
        const fallback = this.buildHeuristicAnalysis(structures);

        const compactStructures = this.buildCompactStructures(structures);
        const prompt = this.buildAnalysisPromptFromCompact(compactStructures);

        if (prompt.length <= TemplateAnalyzerService.MAX_PROMPT_CHARS) {
            try {
                const { data } = await this.claudeService.completeJSON<TemplateAnalysisResult>(prompt, {
                    systemPrompt: ANALYZE_SYSTEM_PROMPT,
                    temperature: 0.1,
                    maxTokens: 8000,
                });
                const validated = this.validateAnalysisResult(data);
                return this.ensureMinimumAnalysis(validated, fallback);
            } catch (error) {
                console.warn('[TemplateFactory] Falha na analise via Claude. Usando fallback local.', {
                    error: error instanceof Error ? error.message : String(error),
                });
                return fallback;
            }
        }

        const chunked = this.buildChunks(compactStructures);
        const partialResults: TemplateAnalysisResult[] = [];

        for (const [index, chunk] of chunked.entries()) {
            const chunkPrompt = this.buildAnalysisPromptFromCompact(chunk);
            try {
                const { data } = await this.claudeService.completeJSON<TemplateAnalysisResult>(chunkPrompt, {
                    systemPrompt: `${ANALYZE_SYSTEM_PROMPT}\nChunk ${index + 1}/${chunked.length}.`,
                    temperature: 0.1,
                    maxTokens: 3000,
                });

                partialResults.push(this.validateAnalysisResult(data));
            } catch (error) {
                console.warn('[TemplateFactory] Falha ao analisar chunk via Claude.', {
                    chunk: `${index + 1}/${chunked.length}`,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        if (partialResults.length === 0) {
            return fallback;
        }

        const merged = this.mergePartialAnalysis(partialResults);
        return this.ensureMinimumAnalysis(merged, fallback);
    }

    async generatePlaceholderMap(analysis: TemplateAnalysisResult): Promise<PlaceholderDefinition[]> {
        const prompt = this.buildPlaceholderPrompt(analysis);
        const { data } = await this.claudeService.completeJSON<{ placeholders: PlaceholderDefinition[] }>(prompt, {
            systemPrompt: 'Normalize os placeholders em uma lista unica, sem duplicidade e com nomes UPPER_SNAKE_CASE.',
            temperature: 0.1,
            maxTokens: 4000,
        });

        const list = Array.isArray(data.placeholders) ? data.placeholders : [];
        return list.map((item) => placeholderDefinitionSchema.parse(item));
    }

    extractExamples(structures: DocumentStructure[], analysis: TemplateAnalysisResult): Map<string, string[]> {
        const examples = new Map<string, string[]>();

        analysis.globalPlaceholders.forEach((placeholder) => {
            const normalizedSection = this.normalize(placeholder.section);
            const collected: string[] = [];

            structures.forEach((structure) => {
                const sectionElements = structure.elements.filter((element) => {
                    if (element.type === 'heading') {
                        return false;
                    }

                    if (normalizedSection.length === 0) {
                        return true;
                    }

                    return this.normalize(element.content).includes(normalizedSection);
                });

                sectionElements.slice(0, 3).forEach((element) => {
                    if (element.content && !collected.includes(element.content)) {
                        collected.push(element.content);
                    }
                });
            });

            if (collected.length > 0) {
                examples.set(placeholder.name, collected.slice(0, 5));
            }
        });

        return examples;
    }

    private buildCompactStructures(structures: DocumentStructure[]) {
        return structures.map((structure, index) => {
            const sampleElements = structure.elements.slice(0, 220).map((element) => ({
                type: element.type,
                level: element.level,
                style: element.style,
                content: element.content.slice(0, 700),
                tableData: element.tableData
                    ? {
                        headers: element.tableData.headers,
                        rowCount: element.tableData.rowCount,
                        sampleRows: element.tableData.rows.slice(0, 2),
                    }
                    : undefined,
            }));

            return {
                model: index + 1,
                filename: structure.filename,
                metadata: structure.metadata,
                headers: structure.headers.map((item) => item.content.slice(0, 250)),
                footers: structure.footers.map((item) => item.content.slice(0, 250)),
                elements: sampleElements,
            };
        });
    }

    private buildAnalysisPromptFromCompact(compactStructures: ReturnType<TemplateAnalyzerService['buildCompactStructures']>): string {
        return [
            `Voce recebeu ${compactStructures.length} modelos de RDA.`,
            'Compare estruturas, extraia fixo vs variavel e responda JSON no schema TemplateAnalysisResult.',
            'Dados dos modelos (compactados):',
            JSON.stringify(compactStructures),
        ].join('\n\n');
    }

    private buildChunks(compactStructures: ReturnType<TemplateAnalyzerService['buildCompactStructures']>) {
        const maxElements = Math.max(...compactStructures.map((item) => item.elements.length), 0);
        if (maxElements <= TemplateAnalyzerService.CHUNK_ELEMENT_SIZE) {
            return [compactStructures];
        }

        const chunks: ReturnType<TemplateAnalyzerService['buildCompactStructures']>[] = [];
        for (let offset = 0; offset < maxElements; offset += TemplateAnalyzerService.CHUNK_ELEMENT_SIZE) {
            const chunk = compactStructures.map((item) => ({
                ...item,
                elements: item.elements.slice(offset, offset + TemplateAnalyzerService.CHUNK_ELEMENT_SIZE),
            }));
            chunks.push(chunk);
        }

        return chunks;
    }

    private mergePartialAnalysis(results: TemplateAnalysisResult[]): TemplateAnalysisResult {
        const mergedSections = new Map<string, TemplateAnalysisResult['sections'][number]>();
        const mergedFixed = new Map<string, TemplateAnalysisResult['fixedElements'][number]>();
        const mergedPlaceholders = new Map<string, PlaceholderDefinition>();

        results.forEach((result) => {
            result.sections.forEach((section) => {
                const key = this.normalize(section.title);
                const existing = mergedSections.get(key);

                if (!existing) {
                    mergedSections.set(key, {
                        ...section,
                        placeholders: section.placeholders.map((placeholder) => ({
                            ...placeholder,
                            name: this.normalizePlaceholderName(placeholder.name),
                        })),
                    });
                    return;
                }

                const placeholderMap = new Map<string, PlaceholderDefinition>();
                [...existing.placeholders, ...section.placeholders].forEach((placeholder) => {
                    const name = this.normalizePlaceholderName(placeholder.name);
                    if (!placeholderMap.has(name)) {
                        placeholderMap.set(name, { ...placeholder, name });
                    }
                });

                existing.placeholders = Array.from(placeholderMap.values());
            });

            result.fixedElements.forEach((element) => {
                const key = `${element.type}:${this.normalize(element.content)}`;
                if (!mergedFixed.has(key)) {
                    mergedFixed.set(key, element);
                }
            });

            result.globalPlaceholders.forEach((placeholder) => {
                const name = this.normalizePlaceholderName(placeholder.name);
                if (!mergedPlaceholders.has(name)) {
                    mergedPlaceholders.set(name, { ...placeholder, name });
                }
            });
        });

        return {
            sections: Array.from(mergedSections.values()).sort((a, b) => a.order - b.order),
            fixedElements: Array.from(mergedFixed.values()).sort((a, b) => a.position - b.position),
            globalPlaceholders: Array.from(mergedPlaceholders.values()),
        };
    }

    private buildPlaceholderPrompt(analysis: TemplateAnalysisResult): string {
        return [
            'Consolide placeholders em uma lista unica.',
            'Remova duplicados sem perder contexto de secao.',
            'Retorne JSON no formato {"placeholders":[...]}',
            JSON.stringify(analysis),
        ].join('\n\n');
    }

    private validateAnalysisResult(result: unknown): TemplateAnalysisResult {
        const normalizedInput = this.normalizeAnalysisPayload(result);
        const parsed = templateAnalysisResultSchema.parse(normalizedInput);
        return {
            ...parsed,
            globalPlaceholders: parsed.globalPlaceholders.map((placeholder) => ({
                ...placeholder,
                name: this.normalizePlaceholderName(placeholder.name),
            })),
            sections: parsed.sections.map((section) => ({
                ...section,
                placeholders: section.placeholders.map((placeholder) => ({
                    ...placeholder,
                    name: this.normalizePlaceholderName(placeholder.name),
                })),
            })),
        };
    }

    private normalizeAnalysisPayload(result: unknown): unknown {
        const root = this.asRecord(result);
        const candidate = this.asRecord(root.analysis ?? root.result ?? root.data ?? root);

        const sectionsRaw = this.toArray(candidate.sections ?? candidate.secoes ?? candidate.sectionList);
        const fixedRaw = this.toArray(
            candidate.fixedElements
            ?? candidate.fixed_elements
            ?? candidate.elementosFixos
            ?? candidate.fixedContent,
        );
        const placeholdersRaw = this.toArray(
            candidate.globalPlaceholders
            ?? candidate.placeholders
            ?? candidate.camposVariaveis
            ?? candidate.variableFields,
        );

        const sections = sectionsRaw.map((item, index) => {
            const section = this.asRecord(item);
            const sectionPlaceholders = this.toArray(
                section.placeholders
                ?? section.campos
                ?? section.fields,
            ).map((placeholder) => this.normalizePlaceholder(placeholder, section.title ?? section.titulo ?? 'GERAL'));

            return {
                title: String(section.title ?? section.titulo ?? `Secao ${index + 1}`),
                headingLevel: this.toInt(section.headingLevel ?? section.nivel ?? 1, 1),
                order: this.toInt(section.order ?? section.ordem ?? index, index),
                fixedText: this.toNullableString(section.fixedText ?? section.textoFixo ?? null),
                placeholders: sectionPlaceholders,
                subsections: undefined,
            };
        });

        const fixedElements = fixedRaw.map((item, index) => {
            const fixed = this.asRecord(item);
            return {
                type: this.normalizeFixedType(fixed.type ?? fixed.tipo),
                content: String(fixed.content ?? fixed.conteudo ?? ''),
                position: this.toInt(fixed.position ?? fixed.posicao ?? index, index),
                note: this.toNullableString(fixed.note ?? fixed.nota ?? undefined) ?? undefined,
            };
        });

        const globalPlaceholders = placeholdersRaw.map((item) => this.normalizePlaceholder(item, 'GERAL'));

        return {
            sections,
            fixedElements,
            globalPlaceholders,
        };
    }

    private normalizePlaceholder(raw: unknown, fallbackSection: unknown): PlaceholderDefinition {
        const placeholder = this.asRecord(raw);
        const type = this.normalizePlaceholderType(placeholder.type ?? placeholder.tipo);

        const tableColumns = this.toArray(placeholder.tableColumns ?? placeholder.colunas ?? placeholder.columns)
            .map((column) => {
                const columnValue = this.asRecord(column);
                return {
                    name: String(columnValue.name ?? columnValue.nome ?? 'coluna'),
                    displayName: String(columnValue.displayName ?? columnValue.titulo ?? columnValue.name ?? columnValue.nome ?? 'Coluna'),
                    type: this.normalizeColumnType(columnValue.type ?? columnValue.tipo),
                    required: this.toBoolean(columnValue.required ?? columnValue.obrigatorio, false),
                };
            });

        return {
            name: this.normalizePlaceholderName(String(placeholder.name ?? placeholder.nome ?? 'CAMPO')),
            type,
            required: this.toBoolean(placeholder.required ?? placeholder.obrigatorio, true),
            section: String(placeholder.section ?? placeholder.secao ?? fallbackSection ?? 'GERAL'),
            description: String(placeholder.description ?? placeholder.descricao ?? 'Campo variavel do template'),
            maxLength: this.toOptionalInt(placeholder.maxLength ?? placeholder.tamanhoMaximo),
            enumValues: this.toArray(placeholder.enumValues ?? placeholder.valores ?? placeholder.opcoes).map((value) => String(value)),
            tableColumns: tableColumns.length > 0 ? tableColumns : undefined,
            examples: this.toArray(placeholder.examples ?? placeholder.exemplos).map((value) => String(value)),
            avgLength: this.toOptionalNumber(placeholder.avgLength ?? placeholder.mediaTamanho),
        };
    }

    private normalizePlaceholderType(value: unknown): PlaceholderDefinition['type'] {
        const raw = String(value ?? '').toLowerCase();
        if (['text', 'date', 'number', 'list', 'table', 'enum', 'date_range'].includes(raw)) {
            return raw as PlaceholderDefinition['type'];
        }
        if (raw.includes('data') && raw.includes('range')) {
            return 'date_range';
        }
        if (raw.includes('data')) {
            return 'date';
        }
        if (raw.includes('numero')) {
            return 'number';
        }
        if (raw.includes('lista')) {
            return 'list';
        }
        if (raw.includes('tabela')) {
            return 'table';
        }
        if (raw.includes('enum')) {
            return 'enum';
        }
        return 'text';
    }

    private normalizeColumnType(value: unknown): 'text' | 'date' | 'number' | 'enum' {
        const raw = String(value ?? '').toLowerCase();
        if (raw === 'date' || raw.includes('data')) {
            return 'date';
        }
        if (raw === 'number' || raw.includes('numero')) {
            return 'number';
        }
        if (raw === 'enum') {
            return 'enum';
        }
        return 'text';
    }

    private normalizeFixedType(value: unknown): 'header' | 'footer' | 'paragraph' | 'image' {
        const raw = String(value ?? '').toLowerCase();
        if (raw === 'header' || raw.includes('cabec')) {
            return 'header';
        }
        if (raw === 'footer' || raw.includes('rodape')) {
            return 'footer';
        }
        if (raw === 'image' || raw.includes('imagem')) {
            return 'image';
        }
        return 'paragraph';
    }

    private asRecord(value: unknown): Record<string, unknown> {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value as Record<string, unknown>;
        }

        return {};
    }

    private toArray(value: unknown): unknown[] {
        if (Array.isArray(value)) {
            return value;
        }

        if (typeof value === 'undefined' || value === null) {
            return [];
        }

        return [value];
    }

    private toInt(value: unknown, fallback: number): number {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
    }

    private toOptionalInt(value: unknown): number | undefined {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
    }

    private toOptionalNumber(value: unknown): number | undefined {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    private toNullableString(value: unknown): string | null {
        if (value === null || typeof value === 'undefined') {
            return null;
        }

        return String(value);
    }

    private toBoolean(value: unknown, fallback: boolean): boolean {
        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            if (['true', '1', 'sim', 'yes'].includes(normalized)) {
                return true;
            }
            if (['false', '0', 'nao', 'não', 'no'].includes(normalized)) {
                return false;
            }
        }

        return fallback;
    }

    private normalize(text: string): string {
        return text
            .normalize('NFD')
            .replace(/[^\w\s]/g, '')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    private normalizePlaceholderName(name: string): string {
        return name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toUpperCase();
    }

    private ensureMinimumAnalysis(
        candidate: TemplateAnalysisResult,
        fallback: TemplateAnalysisResult,
    ): TemplateAnalysisResult {
        const hasSections = candidate.sections.length > 0;
        const hasPlaceholders = candidate.globalPlaceholders.length > 0;
        const hasFixed = candidate.fixedElements.length > 0;

        if (hasSections && hasPlaceholders) {
            return candidate;
        }

        return {
            sections: hasSections ? candidate.sections : fallback.sections,
            globalPlaceholders: hasPlaceholders ? candidate.globalPlaceholders : fallback.globalPlaceholders,
            fixedElements: hasFixed ? candidate.fixedElements : fallback.fixedElements,
        };
    }

    private buildHeuristicAnalysis(structures: DocumentStructure[]): TemplateAnalysisResult {
        const sectionTitles = this.extractSectionTitles(structures);
        const baseSection = sectionTitles.length > 0 ? sectionTitles[0] : 'GERAL';
        const fixedElements = this.extractFixedElements(structures);
        const placeholders = this.extractVariablePlaceholders(structures, sectionTitles);
        const defaultPlaceholders: PlaceholderDefinition[] = [
            {
                name: 'RESUMO_EXECUTIVO',
                type: 'text',
                required: true,
                section: baseSection,
                description: 'Resumo executivo do periodo',
                maxLength: 4000,
                examples: [],
                avgLength: undefined,
            },
        ];

        const effectivePlaceholders: PlaceholderDefinition[] = placeholders.length > 0
            ? placeholders
            : defaultPlaceholders;

        return {
            sections: sectionTitles.length > 0
                ? sectionTitles.map((title, index) => ({
                    title,
                    headingLevel: 1,
                    order: index,
                    fixedText: null,
                    placeholders: effectivePlaceholders.filter((item) => item.section === title),
                    subsections: undefined,
                }))
                : [{
                    title: 'GERAL',
                    headingLevel: 1,
                    order: 0,
                    fixedText: null,
                    placeholders: effectivePlaceholders,
                    subsections: undefined,
                }],
            fixedElements,
            globalPlaceholders: effectivePlaceholders,
        };
    }

    private extractSectionTitles(structures: DocumentStructure[]): string[] {
        const titleFrequency = new Map<string, number>();
        const orderedUnique: string[] = [];

        structures.forEach((structure) => {
            const seenInDoc = new Set<string>();
            structure.elements
                .filter((element) => element.type === 'heading' && element.content.trim().length > 1)
                .forEach((heading) => {
                    const normalized = this.normalize(heading.content);
                    if (!normalized || seenInDoc.has(normalized)) {
                        return;
                    }
                    seenInDoc.add(normalized);
                    titleFrequency.set(normalized, (titleFrequency.get(normalized) ?? 0) + 1);
                    if (!orderedUnique.includes(normalized)) {
                        orderedUnique.push(normalized);
                    }
                });
        });

        const threshold = Math.max(1, Math.ceil(structures.length * 0.5));
        const selected = orderedUnique
            .filter((normalized) => (titleFrequency.get(normalized) ?? 0) >= threshold)
            .slice(0, 12)
            .map((normalized) => {
                const original = structures
                    .flatMap((doc) => doc.elements)
                    .find((item) => this.normalize(item.content) === normalized)?.content;
                return (original ?? normalized).trim();
            });

        return selected.length > 0 ? selected : ['GERAL'];
    }

    private extractFixedElements(structures: DocumentStructure[]): TemplateAnalysisResult['fixedElements'] {
        const fixed: TemplateAnalysisResult['fixedElements'] = [];
        const docCount = structures.length;

        const headerCount = new Map<string, number>();
        const footerCount = new Map<string, number>();

        structures.forEach((structure) => {
            const localHeaders = new Set<string>();
            structure.headers.forEach((header) => {
                const normalized = this.normalize(header.content);
                if (!normalized || localHeaders.has(normalized)) {
                    return;
                }
                localHeaders.add(normalized);
                headerCount.set(normalized, (headerCount.get(normalized) ?? 0) + 1);
            });

            const localFooters = new Set<string>();
            structure.footers.forEach((footer) => {
                const normalized = this.normalize(footer.content);
                if (!normalized || localFooters.has(normalized)) {
                    return;
                }
                localFooters.add(normalized);
                footerCount.set(normalized, (footerCount.get(normalized) ?? 0) + 1);
            });
        });

        let position = 0;
        headerCount.forEach((count, content) => {
            if (count >= Math.max(1, Math.ceil(docCount * 0.5))) {
                fixed.push({ type: 'header', content, position: position += 1, note: 'Detectado em multiplos modelos' });
            }
        });

        footerCount.forEach((count, content) => {
            if (count >= Math.max(1, Math.ceil(docCount * 0.5))) {
                fixed.push({ type: 'footer', content, position: position += 1, note: 'Detectado em multiplos modelos' });
            }
        });

        return fixed.slice(0, 10);
    }

    private extractVariablePlaceholders(
        structures: DocumentStructure[],
        sections: string[],
    ): PlaceholderDefinition[] {
        const placeholders: PlaceholderDefinition[] = [];
        const maxPosition = Math.min(
            280,
            Math.max(...structures.map((structure) => structure.elements.length), 0),
        );

        let fallbackCounter = 1;
        for (let position = 0; position < maxPosition; position += 1) {
            const samples = structures
                .map((structure) => structure.elements[position])
                .filter((item): item is DocumentStructure['elements'][number] => Boolean(item))
                .filter((item) => item.type !== 'heading' && item.type !== 'pageBreak');

            if (samples.length < 2) {
                continue;
            }

            const normalizedSet = new Set(
                samples
                    .map((item) => this.normalize(item.content))
                    .filter((value) => value.length > 0),
            );

            if (normalizedSet.size <= 1) {
                continue;
            }

            const section = this.resolveSectionForPosition(structures[0], position, sections);
            const first = samples[0];
            const type: PlaceholderDefinition['type'] = first.type === 'table'
                ? 'table'
                : this.detectPlaceholderType(samples.map((item) => item.content));

            const rawBase = first.type === 'table'
                ? `TABELA_${section}`
                : first.content.slice(0, 45) || `CAMPO_${fallbackCounter}`;
            let name = this.normalizePlaceholderName(rawBase);
            if (!name) {
                name = `CAMPO_${fallbackCounter}`;
            }
            fallbackCounter += 1;

            if (placeholders.some((item) => item.name === name)) {
                name = `${name}_${fallbackCounter}`;
                fallbackCounter += 1;
            }

            placeholders.push({
                name,
                type,
                required: true,
                section,
                description: `Campo variavel identificado na posicao ${position}.`,
                maxLength: type === 'text' ? 4000 : undefined,
                enumValues: undefined,
                tableColumns: first.type === 'table' && first.tableData?.headers
                    ? first.tableData.headers
                        .filter((value) => value.trim().length > 0)
                        .slice(0, 12)
                        .map((header) => ({
                            name: this.normalizePlaceholderName(header) || 'COLUNA',
                            displayName: header,
                            type: 'text',
                            required: false,
                        }))
                    : undefined,
                examples: samples
                    .map((item) => item.content)
                    .filter((value) => value.trim().length > 0)
                    .slice(0, 4),
                avgLength: undefined,
            });
        }

        return placeholders.slice(0, 60);
    }

    private resolveSectionForPosition(
        structure: DocumentStructure,
        position: number,
        sections: string[],
    ): string {
        for (let cursor = position; cursor >= 0; cursor -= 1) {
            const element = structure.elements[cursor];
            if (element?.type === 'heading' && element.content.trim().length > 0) {
                return element.content.trim();
            }
        }

        return sections[0] ?? 'GERAL';
    }

    private detectPlaceholderType(values: string[]): PlaceholderDefinition['type'] {
        const nonEmpty = values.map((value) => value.trim()).filter((value) => value.length > 0);
        if (nonEmpty.length === 0) {
            return 'text';
        }

        const dateLike = nonEmpty.filter((value) => /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(value)).length;
        if (dateLike >= Math.ceil(nonEmpty.length * 0.6)) {
            return 'date';
        }

        const numericLike = nonEmpty.filter((value) => /^[-+]?(\d+[.,]?)+$/.test(value.replace(/\s/g, ''))).length;
        if (numericLike >= Math.ceil(nonEmpty.length * 0.6)) {
            return 'number';
        }

        return 'text';
    }
}

export const templateAnalyzerService = new TemplateAnalyzerService(claudeService);
