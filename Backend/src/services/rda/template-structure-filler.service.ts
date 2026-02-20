import PizZip from 'pizzip';

interface StructuredFillData {
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
}

interface TextRunMatch {
    index: number;
    start: number;
    end: number;
    xml: string;
    text: string;
}

function normalize(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export class TemplateStructureFillerService {
    fill(docBuffer: Buffer, data: StructuredFillData): Buffer {
        const zip = new PizZip(docBuffer);
        const entry = zip.file('word/document.xml');
        if (!entry) {
            throw new Error('document.xml não encontrado no template DOCX.');
        }

        let xml = entry.asText();
        const runs = this.collectRuns(xml);
        const replacementByRun = new Map<number, string>();

        this.replaceHeaderField(runs, replacementByRun, ['projeto:', 'rojeto:'], data.projectName);
        this.replaceHeaderField(runs, replacementByRun, ['ano-base'], data.yearBase);
        this.replaceHeaderField(runs, replacementByRun, ['competencia:', 'competencia'], data.competence);
        this.replaceHeaderField(runs, replacementByRun, ['coord. tecnico:', 'coord tecnico:'], data.technicalCoordinator);

        this.replaceFirstRunContaining(runs, replacementByRun, ['planejamento, coordenacao e gestao do projeto'], data.activityName);
        this.replaceFirstRunMatching(runs, replacementByRun, (text) => /\d{2}\/\d{2}\/\d{4}\s*a\s*\d{2}\/\d{2}\/\d{4}/.test(text), `${data.periodStart} a ${data.periodEnd}`);

        this.replaceInstructionAfterAnchor(
            runs,
            replacementByRun,
            ['descricao da atividade'],
            ['descrever detalhadamente a atividade executada'],
            data.activityDescription,
        );
        this.replaceInstructionAfterAnchor(
            runs,
            replacementByRun,
            ['justificativa da atividade'],
            ['justificar a necessidade da atividade'],
            data.activityJustification,
        );
        this.replaceInstructionAfterAnchor(
            runs,
            replacementByRun,
            ['resultado obtido da atividade'],
            ['detalhar os resultados concretos alcancados'],
            data.activityResult,
        );

        xml = this.applyRunReplacements(xml, runs, replacementByRun);
        zip.file('word/document.xml', xml);
        return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    }

    private collectRuns(xml: string): TextRunMatch[] {
        const regex = /<w:t[^>]*>[\s\S]*?<\/w:t>/g;
        const runs: TextRunMatch[] = [];
        let index = 0;
        let match: RegExpExecArray | null = regex.exec(xml);

        while (match) {
            const fullXml = match[0];
            const text = fullXml.replace(/^<w:t[^>]*>/, '').replace(/<\/w:t>$/, '');
            runs.push({
                index,
                start: match.index,
                end: match.index + fullXml.length,
                xml: fullXml,
                text,
            });
            index += 1;
            match = regex.exec(xml);
        }

        return runs;
    }

    private applyRunReplacements(xml: string, runs: TextRunMatch[], replacementByRun: Map<number, string>): string {
        let output = xml;
        const ordered = [...replacementByRun.entries()].sort((a, b) => b[0] - a[0]);

        ordered.forEach(([runIndex, newValue]) => {
            const run = runs.find((item) => item.index === runIndex);
            if (!run) {
                return;
            }

            const oldXml = run.xml;
            const newXml = oldXml.replace(run.text, escapeXml(newValue));
            output = output.slice(0, run.start) + newXml + output.slice(run.end);
        });

        return output;
    }

    private replaceHeaderField(
        runs: TextRunMatch[],
        replacementByRun: Map<number, string>,
        labels: string[],
        value: string,
    ): void {
        const normalizedLabels = labels.map(normalize);
        const anchorIndex = runs.findIndex((run) => normalizedLabels.some((label) => normalize(run.text).includes(label)));
        if (anchorIndex < 0) {
            return;
        }

        const targetIndex = this.findNextWritableRun(runs, anchorIndex + 1);
        if (targetIndex >= 0) {
            replacementByRun.set(targetIndex, value);
        }
    }

    private replaceFirstRunContaining(
        runs: TextRunMatch[],
        replacementByRun: Map<number, string>,
        phrases: string[],
        value: string,
    ): void {
        const normalizedPhrases = phrases.map(normalize);
        const target = runs.find((run) => normalizedPhrases.some((phrase) => normalize(run.text).includes(phrase)));
        if (target) {
            replacementByRun.set(target.index, value);
        }
    }

    private replaceFirstRunMatching(
        runs: TextRunMatch[],
        replacementByRun: Map<number, string>,
        predicate: (normalizedText: string) => boolean,
        value: string,
    ): void {
        const target = runs.find((run) => predicate(normalize(run.text)));
        if (target) {
            replacementByRun.set(target.index, value);
        }
    }

    private replaceInstructionAfterAnchor(
        runs: TextRunMatch[],
        replacementByRun: Map<number, string>,
        anchorLabels: string[],
        instructionHints: string[],
        value: string,
    ): void {
        const normalizedAnchors = anchorLabels.map(normalize);
        const normalizedHints = instructionHints.map(normalize);

        const anchorIndex = runs.findIndex((run) => normalizedAnchors.some((label) => normalize(run.text).includes(label)));
        if (anchorIndex < 0) {
            return;
        }

        for (let index = anchorIndex + 1; index < Math.min(anchorIndex + 120, runs.length); index += 1) {
            const runText = normalize(runs[index].text);
            if (normalizedHints.some((hint) => runText.includes(hint))) {
                replacementByRun.set(runs[index].index, value);
                return;
            }
        }
    }

    private findNextWritableRun(runs: TextRunMatch[], startIndex: number): number {
        for (let index = startIndex; index < Math.min(startIndex + 40, runs.length); index += 1) {
            const text = runs[index].text.trim();
            if (!text || text === ':') {
                continue;
            }

            if (/^(p|projeto|ano-base|competencia|coord\.?\s*tecnico)$/i.test(text)) {
                continue;
            }

            return runs[index].index;
        }

        return -1;
    }
}

export const templateStructureFillerService = new TemplateStructureFillerService();

