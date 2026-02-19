import PizZip from 'pizzip';
import { XMLParser } from 'fast-xml-parser';
import {
    DocumentElement,
    DocumentStructure,
    HeaderFooterContent,
    StyleInfo,
    documentStructureSchema,
} from '@/modules/rda/schemas/template-factory.schema';

interface XmlNode {
    [key: string]: unknown;
}

export class TemplateExtractorService {
    private readonly parser: XMLParser;

    constructor() {
        this.parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            trimValues: false,
            preserveOrder: false,
            parseTagValue: false,
            removeNSPrefix: false,
        });
    }

    async extractStructure(fileBuffer: Buffer): Promise<DocumentStructure> {
        console.log('[TemplateFactory] Extraindo estrutura DOCX...');

        const zip = new PizZip(fileBuffer);
        const documentXml = zip.file('word/document.xml')?.asText();

        if (!documentXml) {
            throw new Error('Arquivo DOCX inválido: word/document.xml não encontrado.');
        }

        const stylesXml = zip.file('word/styles.xml')?.asText() ?? '';
        const styles = this.extractStyles(stylesXml);
        const elements = this.parseDocumentXml(documentXml, styles);
        const { headers, footers } = this.extractHeaderFooter(zip);

        const metadata: DocumentStructure['metadata'] = {};
        const coreXml = zip.file('docProps/core.xml')?.asText();
        if (coreXml) {
            const core = this.parser.parse(coreXml) as XmlNode;
            const props = (core['cp:coreProperties'] ?? {}) as XmlNode;
            metadata.author = this.readTextNode(props['dc:creator']);
            metadata.created = this.readTextNode(props['dcterms:created']);
            metadata.modified = this.readTextNode(props['dcterms:modified']);
        }

        const structure: DocumentStructure = {
            filename: 'document.docx',
            elements,
            styles,
            headers,
            footers,
            metadata,
        };

        return documentStructureSchema.parse(structure);
    }

    private parseDocumentXml(xmlString: string, styles: Record<string, StyleInfo>): DocumentElement[] {
        const parsed = this.parser.parse(xmlString) as XmlNode;
        const body = (((parsed['w:document'] as XmlNode)?.['w:body'] ?? {}) as XmlNode);

        const contentNodes: Array<{ key: string; node: unknown }> = [];

        Object.keys(body).forEach((key) => {
            if (key === 'w:sectPr') {
                return;
            }

            const value = body[key];
            const nodes = this.toArray(value);
            nodes.forEach((node) => contentNodes.push({ key, node }));
        });

        const elements: DocumentElement[] = [];
        let position = 0;

        contentNodes.forEach((entry, index) => {
            try {
                if (entry.key === 'w:tbl') {
                    const tableElement = this.extractTableStructure(entry.node);
                    tableElement.position = position;
                    tableElement.xmlPath = `w:document/w:body/w:tbl[${index}]`;
                    elements.push(tableElement);
                    position += 1;
                    return;
                }

                if (entry.key !== 'w:p') {
                    return;
                }

                const paragraph = entry.node as XmlNode;
                const text = this.mergeAdjacentRuns(paragraph);
                const { style, level } = this.resolveStyle(paragraph, styles);
                const hasImage = this.hasDrawing(paragraph);
                const hasList = this.hasNumbering(paragraph);
                const hasPageBreak = this.hasPageBreak(paragraph);

                const type: DocumentElement['type'] = hasPageBreak
                    ? 'pageBreak'
                    : hasImage
                        ? 'image'
                        : level
                            ? 'heading'
                            : hasList
                                ? 'list'
                                : 'paragraph';

                const listItems = type === 'list' ? [text].filter(Boolean) : undefined;

                elements.push({
                    type,
                    content: text,
                    style,
                    level,
                    listItems,
                    position,
                    xmlPath: `w:document/w:body/w:p[${index}]`,
                });
                position += 1;
            } catch (error) {
                console.warn('[TemplateFactory] Warning ao parsear elemento do DOCX', {
                    index,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        });

        return elements;
    }

    private extractTableStructure(tableNode: unknown): DocumentElement {
        const table = tableNode as XmlNode;
        const rows = this.toArray((table['w:tr'] as unknown) ?? []);
        const parsedRows = rows.map((row) => {
            const cells = this.toArray(((row as XmlNode)['w:tc'] as unknown) ?? []);
            return cells.map((cell) => this.extractCellText(cell));
        });

        const headers = parsedRows[0] ?? [];
        const dataRows = parsedRows.length > 1 ? parsedRows.slice(1) : [];

        return {
            type: 'table',
            content: headers.join(' | '),
            style: 'Table',
            tableData: {
                headers,
                rows: dataRows,
                columnCount: headers.length,
                rowCount: dataRows.length,
            },
            position: 0,
        };
    }

    private extractStyles(stylesXml: string): Record<string, StyleInfo> {
        if (!stylesXml) {
            return {};
        }

        const parsed = this.parser.parse(stylesXml) as XmlNode;
        const styleNodes = this.toArray((((parsed['w:styles'] as XmlNode) ?? {})['w:style'] as unknown) ?? []);
        const styles: Record<string, StyleInfo> = {};

        styleNodes.forEach((rawStyle) => {
            const style = rawStyle as XmlNode;
            const id = this.getAttr(style, '@_w:styleId') ?? 'unknown';
            const rawType = this.getAttr(style, '@_w:type') ?? 'paragraph';
            const type = (['paragraph', 'character', 'table', 'numbering'].includes(rawType)
                ? rawType
                : 'paragraph') as 'paragraph' | 'character' | 'table' | 'numbering';
            const name = this.getAttr(((style['w:name'] as XmlNode) ?? {}), '@_w:val') ?? id;
            const basedOn = this.getAttr(((style['w:basedOn'] as XmlNode) ?? {}), '@_w:val') ?? undefined;
            const rPr = ((style['w:rPr'] as XmlNode) ?? {});
            const pPr = ((style['w:pPr'] as XmlNode) ?? {});

            const fontSizeRaw = this.getAttr(((rPr['w:sz'] as XmlNode) ?? {}), '@_w:val');
            const fontSize = fontSizeRaw ? Number(fontSizeRaw) / 2 : undefined;

            styles[id] = {
                id,
                name,
                type,
                basedOn,
                formatting: {
                    bold: Object.prototype.hasOwnProperty.call(rPr, 'w:b') ? true : undefined,
                    italic: Object.prototype.hasOwnProperty.call(rPr, 'w:i') ? true : undefined,
                    fontSize: Number.isFinite(fontSize) ? fontSize : undefined,
                    fontFamily: this.getAttr(((rPr['w:rFonts'] as XmlNode) ?? {}), '@_w:ascii') ?? undefined,
                    color: this.getAttr(((rPr['w:color'] as XmlNode) ?? {}), '@_w:val') ?? undefined,
                    alignment: this.getAttr(((pPr['w:jc'] as XmlNode) ?? {}), '@_w:val') ?? undefined,
                },
            };
        });

        return styles;
    }

    private extractHeaderFooter(zip: PizZip): { headers: HeaderFooterContent[]; footers: HeaderFooterContent[] } {
        const headers: HeaderFooterContent[] = [];
        const footers: HeaderFooterContent[] = [];

        Object.keys(zip.files).forEach((fileName) => {
            const file = zip.file(fileName);
            if (!file || !fileName.startsWith('word/')) {
                return;
            }

            const isHeader = /word\/header\d+\.xml$/i.test(fileName);
            const isFooter = /word\/footer\d+\.xml$/i.test(fileName);
            if (!isHeader && !isFooter) {
                return;
            }

            try {
                const xml = file.asText();
                const parsed = this.parser.parse(xml) as XmlNode;
                const root = (parsed[isHeader ? 'w:hdr' : 'w:ftr'] ?? {}) as XmlNode;
                const paragraphs = this.toArray(root['w:p']);
                const elements: DocumentElement[] = paragraphs.map((p, index) => ({
                    type: 'paragraph',
                    content: this.mergeAdjacentRuns(p as XmlNode),
                    style: this.getStyleId(p as XmlNode) ?? 'Normal',
                    position: index,
                    xmlPath: `${isHeader ? 'w:hdr' : 'w:ftr'}/w:p[${index}]`,
                }));

                const content = elements.map((element) => element.content).filter(Boolean).join('\n');
                const position: HeaderFooterContent['position'] = fileName.includes('first')
                    ? 'first'
                    : fileName.includes('even')
                        ? 'even'
                        : 'default';

                const result: HeaderFooterContent = {
                    type: isHeader ? 'header' : 'footer',
                    position,
                    content,
                    elements,
                };

                if (isHeader) {
                    headers.push(result);
                } else {
                    footers.push(result);
                }
            } catch (error) {
                console.warn('[TemplateFactory] Warning ao extrair header/footer', {
                    fileName,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        });

        return { headers, footers };
    }

    private mergeAdjacentRuns(paragraph: XmlNode): string {
        const runs = this.toArray(paragraph['w:r']);
        const fragments: string[] = [];

        runs.forEach((run) => {
            const textNode = (run as XmlNode)['w:t'];
            if (typeof textNode === 'string') {
                fragments.push(textNode);
                return;
            }

            if (Array.isArray(textNode)) {
                textNode.forEach((entry) => {
                    if (typeof entry === 'string') {
                        fragments.push(entry);
                        return;
                    }

                    const value = this.getTextValue(entry);
                    if (value) {
                        fragments.push(value);
                    }
                });
                return;
            }

            const value = this.getTextValue(textNode);
            if (value) {
                fragments.push(value);
            }
        });

        if (fragments.length === 0 && paragraph['w:hyperlink']) {
            const hyperlinks = this.toArray(paragraph['w:hyperlink']);
            hyperlinks.forEach((link) => {
                const linkRuns = this.toArray((link as XmlNode)['w:r']);
                linkRuns.forEach((run) => {
                    const textValue = this.getTextValue((run as XmlNode)['w:t']);
                    if (textValue) {
                        fragments.push(textValue);
                    }
                });
            });
        }

        return fragments.join('').replace(/\s+/g, ' ').trim();
    }

    private resolveStyle(element: XmlNode, styles: Record<string, StyleInfo>): { style: string; level?: number } {
        const styleId = this.getStyleId(element) ?? 'Normal';
        const styleName = styles[styleId]?.name ?? styleId;
        const normalized = `${styleId} ${styleName}`.toLowerCase();

        const headingMatch = normalized.match(/heading\s*([1-9])|t[ií]tulo\s*([1-9])/i);
        const levelRaw = headingMatch?.[1] ?? headingMatch?.[2];
        const level = levelRaw ? Number(levelRaw) : undefined;

        return { style: styleId, level: Number.isFinite(level) ? level : undefined };
    }

    private getStyleId(element: XmlNode): string | undefined {
        const pPr = (element['w:pPr'] ?? {}) as XmlNode;
        const pStyle = (pPr['w:pStyle'] ?? {}) as XmlNode;
        return this.getAttr(pStyle, '@_w:val') ?? undefined;
    }

    private hasDrawing(paragraph: XmlNode): boolean {
        const runs = this.toArray(paragraph['w:r']);
        return runs.some((run) => {
            const runNode = run as XmlNode;
            return Boolean(runNode['w:drawing'] || runNode['w:pict']);
        });
    }

    private hasNumbering(paragraph: XmlNode): boolean {
        const pPr = (paragraph['w:pPr'] ?? {}) as XmlNode;
        return Boolean(pPr['w:numPr']);
    }

    private hasPageBreak(paragraph: XmlNode): boolean {
        const runs = this.toArray(paragraph['w:r']);
        return runs.some((run) => {
            const breaks = this.toArray(((run as XmlNode)['w:br'] as unknown) ?? []);
            return breaks.some((br) => this.getAttr((br as XmlNode), '@_w:type') === 'page');
        });
    }

    private extractCellText(cell: unknown): string {
        const cellNode = cell as XmlNode;
        const paragraphs = this.toArray(cellNode['w:p']);
        const text = paragraphs
            .map((paragraph) => this.mergeAdjacentRuns(paragraph as XmlNode))
            .filter(Boolean)
            .join(' ')
            .trim();

        return text;
    }

    private readTextNode(node: unknown): string | undefined {
        if (typeof node === 'string') {
            return node;
        }

        if (!node || typeof node !== 'object') {
            return undefined;
        }

        return this.getTextValue(node);
    }

    private getTextValue(node: unknown): string {
        if (typeof node === 'string') {
            return node;
        }

        if (!node || typeof node !== 'object') {
            return '';
        }

        const raw = node as Record<string, unknown>;
        const textNode = raw['#text'];
        if (typeof textNode === 'string') {
            return textNode;
        }

        if (Array.isArray(textNode)) {
            return textNode.filter((item): item is string => typeof item === 'string').join('');
        }

        return '';
    }

    private toArray<T>(value: T | T[] | undefined): T[] {
        if (Array.isArray(value)) {
            return value;
        }

        if (typeof value === 'undefined') {
            return [];
        }

        return [value];
    }

    private getAttr(node: XmlNode, attr: string): string | null {
        const value = node[attr];
        return typeof value === 'string' ? value : null;
    }
}

export const templateExtractorService = new TemplateExtractorService();

