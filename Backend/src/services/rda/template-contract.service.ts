import fs from 'fs';
import PizZip from 'pizzip';
import { TemplateContractData, TemplateContractField, TemplateContractSection } from '@/types/rda.types';

const KNOWN_SECTION_TITLES = [
    'sumario executivo',
    'introducao',
    'objetivos',
    'atividades',
    'performance',
    'qualidade',
    'riscos',
    'licoes aprendidas',
    'proximos passos',
    'conclusao',
];

function normalize(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function parsePlaceholderCategory(key: string): TemplateContractField['category'] {
    if (/project|projeto/.test(key)) return 'project';
    if (/period|mes|month|date|data/.test(key)) return 'period';
    if (/section|secao|sumario|introducao|objetivo|atividade|performance|qualidade|risco|licao|conclusao/.test(key)) return 'section';
    if (/pbi|wiki|design|evidence|url|link/.test(key)) return 'evidence';
    if (/generation|metadata|token|quality/.test(key)) return 'metadata';
    return 'unknown';
}

export class TemplateContractService {
    parseTemplateContract(filePath: string): TemplateContractData {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Template DOCX não encontrado para contrato: ${filePath}`);
        }

        const binaryContent = fs.readFileSync(filePath, 'binary');
        const zip = new PizZip(binaryContent);
        const xml = zip.file('word/document.xml')?.asText() ?? '';

        const placeholders = this.extractPlaceholders(xml);
        const sections = this.extractSections(xml, placeholders);
        const requiredFields = this.extractRequiredFields(placeholders);
        const tableAnchors = this.extractTableAnchors(xml);

        return {
            placeholders,
            requiredFields,
            sections,
            tableAnchors,
        };
    }

    private extractPlaceholders(xml: string): string[] {
        const textLayer = this.extractTextLayer(xml);
        const regex = /\{\{\s*([^}]+)\s*\}\}/g;
        const placeholders = new Set<string>();
        let match: RegExpExecArray | null = regex.exec(textLayer);

        while (match) {
            placeholders.add(`{{${match[1].trim()}}}`);
            match = regex.exec(textLayer);
        }

        return Array.from(placeholders);
    }

    private extractRequiredFields(placeholders: string[]): TemplateContractField[] {
        return placeholders.map((placeholder) => {
            const key = placeholder.replace(/[{}]/g, '').trim();
            return {
                placeholder,
                key,
                required: true,
                category: parsePlaceholderCategory(normalize(key)),
            };
        });
    }

    private extractSections(xml: string, placeholders: string[]): TemplateContractSection[] {
        const plainText = this.extractTextLayer(xml)
            .replace(/\r/g, '\n')
            .replace(/\n+/g, '\n')
            .trim();

        const lines = plainText.split('\n').map((line) => line.trim()).filter(Boolean);
        const sectionTitles = lines.filter((line) => KNOWN_SECTION_TITLES.some((known) => normalize(line).includes(known)));

        const resolvedTitles = sectionTitles.length > 0
            ? Array.from(new Set(sectionTitles))
            : KNOWN_SECTION_TITLES.map((title) => title.replace(/\b\w/g, (char) => char.toUpperCase()));

        return resolvedTitles.map((title) => {
            const key = normalize(title).replace(/\s+/g, '_');
            const sectionPlaceholders = placeholders.filter((placeholder) => normalize(placeholder).includes(key) || normalize(placeholder).includes('section'));
            return {
                title,
                key,
                placeholders: sectionPlaceholders,
                expectedContentHint: `Conteudo da secao ${title}`,
            };
        });
    }

    private extractTableAnchors(xml: string): string[] {
        const tableRegex = /<w:tbl[\s\S]*?<\/w:tbl>/g;
        const tableAnchors = new Set<string>();
        const tables = xml.match(tableRegex) ?? [];

        tables.forEach((tableXml) => {
            const placeholders = this.extractPlaceholders(tableXml);
            placeholders.forEach((placeholder) => tableAnchors.add(placeholder));
        });

        return Array.from(tableAnchors);
    }

    private extractTextLayer(xml: string): string {
        const textRuns = Array.from(xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)).map((match) => match[1] ?? '');
        const joined = textRuns.join('');
        return joined
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\u00A0/g, ' ');
    }
}

export const templateContractService = new TemplateContractService();
