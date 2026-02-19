import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import {
    DocumentElement,
    DocumentStructure,
    PlaceholderDefinition,
    TemplateAnalysisResult,
} from '@/modules/rda/schemas/template-factory.schema';

export class TemplateBuilderService {
    async buildTemplate(
        structures: DocumentStructure[],
        analysis: TemplateAnalysisResult,
        originalFiles: Buffer[],
    ): Promise<{ templateBuffer: Buffer; placeholders: PlaceholderDefinition[] }> {
        if (structures.length === 0 || originalFiles.length === 0) {
            throw new Error('Nao ha modelos suficientes para construir o template.');
        }

        const baseIndex = this.selectBaseDocument(structures);
        const baseBuffer = originalFiles[baseIndex];
        const baseStructure = structures[baseIndex];
        const zip = new PizZip(baseBuffer);
        const updatedZip = this.replaceContentWithPlaceholders(zip, analysis, baseStructure);
        const templateBuffer = updatedZip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });

        return {
            templateBuffer,
            placeholders: analysis.globalPlaceholders,
        };
    }

    private selectBaseDocument(structures: DocumentStructure[]): number {
        let maxIndex = 0;
        let maxElements = 0;

        structures.forEach((structure, index) => {
            if (structure.elements.length > maxElements) {
                maxElements = structure.elements.length;
                maxIndex = index;
            }
        });

        return maxIndex;
    }

    private replaceContentWithPlaceholders(
        zip: PizZip,
        analysis: TemplateAnalysisResult,
        structure: DocumentStructure,
    ): PizZip {
        const documentEntry = zip.file('word/document.xml');
        if (!documentEntry) {
            throw new Error('Template base invalido: word/document.xml nao encontrado.');
        }

        let documentXml = this.mergeRunsForPlaceholder(documentEntry.asText());
        const placeholders = analysis.globalPlaceholders;

        placeholders.forEach((placeholder) => {
            const sectionElements = this.findElementsForSection(structure, placeholder.section);
            const token = `{{${placeholder.name}}}`;
            if (documentXml.includes(token)) {
                return;
            }

            if (placeholder.type === 'table') {
                const tableCandidate = sectionElements.find((element) => element.type === 'table' && element.tableData);
                if (tableCandidate) {
                    documentXml = this.convertTableToLoop(documentXml, tableCandidate, placeholder);
                }
                if (!documentXml.includes(token)) {
                    documentXml = this.injectPlaceholderInSection(documentXml, placeholder.section, token);
                }
                return;
            }

            const candidates = this.buildReplacementCandidates(placeholder, sectionElements);
            let replaced = false;

            for (const candidate of candidates) {
                const result = this.replaceInXml(
                    documentXml,
                    candidate,
                    token,
                    true,
                );

                if (result.replaced) {
                    documentXml = result.xml;
                    replaced = true;
                    break;
                }
            }

            if (!replaced && !documentXml.includes(token)) {
                documentXml = this.injectPlaceholderInSection(documentXml, placeholder.section, token);
            }
        });

        zip.file('word/document.xml', documentXml);
        return zip;
    }

    private replaceInXml(
        xml: string,
        originalContent: string,
        placeholder: string,
        fuzzyMatch: boolean,
    ): { xml: string; replaced: boolean } {
        if (!originalContent) {
            return { xml, replaced: false };
        }

        const escaped = this.escapeRegExp(originalContent);
        const directRegex = new RegExp(`(<w:t[^>]*>)${escaped}(</w:t>)`, 'g');
        if (directRegex.test(xml)) {
            directRegex.lastIndex = 0;
            return {
                xml: xml.replace(directRegex, `$1${placeholder}$2`),
                replaced: true,
            };
        }

        if (!fuzzyMatch) {
            return { xml, replaced: false };
        }

        const normalizedNeedle = this.normalizeLoose(originalContent);
        const textNodeRegex = /(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g;
        let fuzzyReplaced = false;
        const fuzzyNodeReplaced = xml.replace(textNodeRegex, (full, openTag, textValue, closeTag) => {
            if (String(textValue).includes('{{') || String(textValue).includes('}}')) {
                return full;
            }
            if (this.normalizeLoose(String(textValue)).includes(normalizedNeedle)) {
                fuzzyReplaced = true;
                return `${openTag}${placeholder}${closeTag}`;
            }
            return full;
        });

        if (fuzzyReplaced && fuzzyNodeReplaced !== xml) {
            return {
                xml: fuzzyNodeReplaced,
                replaced: true,
            };
        }

        const paragraphResult = this.replaceAcrossParagraph(xml, normalizedNeedle, placeholder);
        return paragraphResult;
    }

    private convertTableToLoop(xml: string, tableElement: DocumentElement, placeholder: PlaceholderDefinition): string {
        if (!tableElement.tableData || !placeholder.tableColumns || placeholder.tableColumns.length === 0) {
            return xml;
        }

        const firstDataRow = tableElement.tableData.rows[0] ?? [];
        if (firstDataRow.length === 0) {
            return xml;
        }

        let transformed = xml;
        placeholder.tableColumns.forEach((column, index) => {
            const cellContent = firstDataRow[index] ?? '';
            const result = this.replaceInXml(
                transformed,
                cellContent,
                `{{${placeholder.name}.${column.name}}}`,
                true,
            );
            transformed = result.xml;
        });

        const rowText = firstDataRow.join('.*?');
        if (rowText.length === 0) {
            return transformed;
        }

        const escapedRow = rowText
            .split('.*?')
            .map((part) => this.escapeRegExp(part))
            .join('[\\s\\S]*?');
        const rowRegex = new RegExp(`(<w:tr[\\s\\S]*?${escapedRow}[\\s\\S]*?<\\/w:tr>)`);
        if (!rowRegex.test(transformed)) {
            return transformed;
        }

        return transformed.replace(
            rowRegex,
            `{#${placeholder.name}}$1{/${placeholder.name}}`,
        );
    }

    private mergeRunsForPlaceholder(xml: string): string {
        return xml.replace(/<\/w:t>\s*<\/w:r>\s*<w:r[^>]*>\s*<w:t[^>]*>/g, '');
    }

    private replaceAcrossParagraph(
        xml: string,
        normalizedNeedle: string,
        placeholder: string,
    ): { xml: string; replaced: boolean } {
        const paragraphRegex = /<w:p[\s\S]*?<\/w:p>/g;
        let replaced = false;

        const updated = xml.replace(paragraphRegex, (paragraph) => {
            if (paragraph.includes('{{') || paragraph.includes('}}')) {
                return paragraph;
            }

            const paragraphText = this.normalizeLoose(
                paragraph
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim(),
            );

            if (!paragraphText.includes(normalizedNeedle)) {
                return paragraph;
            }

            let wrotePlaceholder = false;
            replaced = true;
            return paragraph.replace(/<w:t([^>]*)>[\s\S]*?<\/w:t>/g, (_full, attrs) => {
                if (!wrotePlaceholder) {
                    wrotePlaceholder = true;
                    return `<w:t${attrs}>${placeholder}</w:t>`;
                }

                return `<w:t${attrs}></w:t>`;
            });
        });

        return {
            xml: updated,
            replaced,
        };
    }

    async validateTemplate(
        templateBuffer: Buffer,
        placeholders: PlaceholderDefinition[],
    ): Promise<{ valid: boolean; errors: string[] }> {
        const errors: string[] = [];

        try {
            const zip = new PizZip(templateBuffer);
            const doc = new Docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
            });

            const mockData = this.generateMockData(placeholders);
            doc.render(mockData);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const detailed = this.extractDocxtemplaterErrors(error);
            if (detailed.length > 0) {
                errors.push(...detailed);
            } else {
                errors.push(message);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
        };
    }

    private extractDocxtemplaterErrors(error: unknown): string[] {
        if (!error || typeof error !== 'object') {
            return [];
        }

        const root = error as {
            properties?: {
                errors?: Array<{
                    properties?: {
                        id?: string;
                        explanation?: string;
                        xtag?: string;
                        context?: string;
                    };
                }>;
            };
        };

        const list = root.properties?.errors;
        if (!Array.isArray(list) || list.length === 0) {
            return [];
        }

        return list.map((item) => {
            const details = item?.properties ?? {};
            const id = details.id ? `[${details.id}] ` : '';
            const explanation = details.explanation ?? 'Erro de template';
            const tag = details.xtag ? ` tag: ${details.xtag}` : '';
            const context = details.context ? ` contexto: ${details.context}` : '';
            return `${id}${explanation}${tag}${context}`.trim();
        });
    }

    private generateMockData(placeholders: PlaceholderDefinition[]): Record<string, unknown> {
        const result: Record<string, unknown> = {};

        placeholders.forEach((placeholder) => {
            switch (placeholder.type) {
                case 'date':
                    result[placeholder.name] = '2026-01-31';
                    break;
                case 'number':
                    result[placeholder.name] = 10;
                    break;
                case 'enum':
                    result[placeholder.name] = placeholder.enumValues?.[0] ?? 'VALOR';
                    break;
                case 'date_range':
                    result[placeholder.name] = '2026-01-01 a 2026-01-31';
                    break;
                case 'list':
                    result[placeholder.name] = ['Item 1', 'Item 2'];
                    break;
                case 'table':
                    if (placeholder.tableColumns && placeholder.tableColumns.length > 0) {
                        result[placeholder.name] = [
                            Object.fromEntries(
                                placeholder.tableColumns.map((column) => [column.name, `Valor ${column.displayName}`]),
                            ),
                        ];
                    } else {
                        result[placeholder.name] = [];
                    }
                    break;
                case 'text':
                default:
                    result[placeholder.name] = 'Texto de exemplo';
                    break;
            }
        });

        return result;
    }

    private findElementsForSection(structure: DocumentStructure, section: string): DocumentElement[] {
        const normalizedSection = this.normalizeLoose(section);
        if (!normalizedSection) {
            return structure.elements;
        }

        let inSection = false;
        const elements: DocumentElement[] = [];

        structure.elements.forEach((element) => {
            if (element.type === 'heading') {
                const normalizedHeading = this.normalizeLoose(element.content);
                inSection = normalizedHeading.includes(normalizedSection);
                return;
            }

            if (inSection) {
                elements.push(element);
            }
        });

        return elements;
    }

    private buildReplacementCandidates(
        placeholder: PlaceholderDefinition,
        sectionElements: DocumentElement[],
    ): string[] {
        const fromExamples = (placeholder.examples ?? [])
            .map((item) => item.trim())
            .filter((item) => item.length >= 3);

        const fromSection = sectionElements
            .filter((item) => item.type !== 'table')
            .map((item) => item.content.trim())
            .filter((item) => item.length >= 3)
            .slice(0, 8);

        return Array.from(new Set([...fromExamples, ...fromSection]));
    }

    private injectPlaceholderInSection(xml: string, section: string, placeholder: string): string {
        const normalizedSection = this.normalizeLoose(section);
        if (!normalizedSection) {
            return this.injectAtDocumentStart(xml, placeholder);
        }

        const paragraphRegex = /<w:p[\s\S]*?<\/w:p>/g;
        const paragraphs = xml.match(paragraphRegex) ?? [];

        let insertAfterIndex = -1;
        paragraphs.some((paragraph, index) => {
            const text = this.normalizeLoose(paragraph.replace(/<[^>]+>/g, ' ').trim());
            if (text.includes(normalizedSection)) {
                insertAfterIndex = index;
                return true;
            }
            return false;
        });

        if (insertAfterIndex < 0) {
            return this.injectAtDocumentStart(xml, placeholder);
        }

        const target = paragraphs[insertAfterIndex];
        const insertion = this.buildSimpleParagraphXml(placeholder);
        return xml.replace(target, `${target}${insertion}`);
    }

    private injectAtDocumentStart(xml: string, placeholder: string): string {
        const bodyOpen = xml.indexOf('<w:body>');
        if (bodyOpen < 0) {
            return xml;
        }

        const insertionPoint = bodyOpen + '<w:body>'.length;
        const insertion = this.buildSimpleParagraphXml(placeholder);
        return `${xml.slice(0, insertionPoint)}${insertion}${xml.slice(insertionPoint)}`;
    }

    private buildSimpleParagraphXml(placeholder: string): string {
        return `<w:p><w:r><w:t>${placeholder}</w:t></w:r></w:p>`;
    }

    private normalizeLoose(value: string): string {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    private escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

export const templateBuilderService = new TemplateBuilderService();
