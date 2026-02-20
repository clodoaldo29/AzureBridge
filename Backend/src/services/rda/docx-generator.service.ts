import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { RDATemplateDocPayload } from '@/types/rda.types';
import { logger } from '@/utils/logger';
import { RDA_GENERATED_DIR } from '@/services/rda/storage-paths';
import { templateStructureFillerService } from '@/services/rda/template-structure-filler.service';

const GENERATED_DIR = RDA_GENERATED_DIR;

export class DocxGeneratorService {
    async readTemplate(templatePath: string): Promise<Buffer> {
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Template DOCX não encontrado: ${templatePath}`);
        }

        return fs.readFileSync(templatePath);
    }

    async replaceText(
        docBuffer: Buffer,
        replacements: Record<string, string>,
        templatePayload?: RDATemplateDocPayload,
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
        },
    ): Promise<Buffer> {
        const hasTemplatePayload =
            Boolean(templatePayload)
            && Array.isArray(templatePayload?.ATIVIDADES)
            && templatePayload.ATIVIDADES.length > 0;

        if (structuredData && !hasTemplatePayload) {
            try {
                return templateStructureFillerService.fill(docBuffer, structuredData);
            } catch (error) {
                logger.warn('[DocxGeneratorService] Falha no preenchimento estrutural, tentando placeholders', {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }

        try {
            const zip = new PizZip(docBuffer);
            const doc = new Docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
                nullGetter: (part) => {
                    if ((part as { module?: string }).module === 'loop') {
                        return [];
                    }

                    return '';
                },
            });

            const normalizedReplacements = this.normalizeReplacements(replacements);
            const renderData = templatePayload
                ? { ...normalizedReplacements, ...templatePayload }
                : normalizedReplacements;
            doc.render(renderData);

            const generatedBuffer = doc.getZip().generate({
                type: 'nodebuffer',
                compression: 'DEFLATE',
            });

            return generatedBuffer;
        } catch (error) {
            logger.warn('[DocxGeneratorService] Falha no docxtemplater, tentando fallback por substituição direta', {
                error: error instanceof Error ? error.message : String(error),
            });

            return this.replaceByXmlFallback(docBuffer, replacements, templatePayload);
        }
    }

    async insertTable(
        docBuffer: Buffer,
        placeholder: string,
        data: Array<Record<string, string | number | boolean | null>>,
    ): Promise<Buffer> {
        const tableMarkdown = this.buildTableMarkdown(data);
        const replacements: Record<string, string> = {
            [placeholder]: tableMarkdown,
        };

        return this.replaceText(docBuffer, replacements);
    }

    async save(docBuffer: Buffer, outputPath: string): Promise<string> {
        const absolutePath = path.isAbsolute(outputPath)
            ? outputPath
            : path.resolve(GENERATED_DIR, outputPath);

        const dir = path.dirname(absolutePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(absolutePath, docBuffer);
        logger.info('[DocxGeneratorService] Documento salvo', { absolutePath, sizeBytes: docBuffer.length });

        return absolutePath;
    }

    getDefaultOutputPath(generationId: string): string {
        return path.resolve(GENERATED_DIR, `rda-${generationId}.docx`);
    }

    private normalizeReplacements(replacements: Record<string, string>): Record<string, string> {
        const normalized: Record<string, string> = {};

        Object.entries(replacements).forEach(([key, value]) => {
            normalized[key.replace(/\{\{|\}\}/g, '').trim()] = value;
        });

        return normalized;
    }

    private buildTableMarkdown(data: Array<Record<string, string | number | boolean | null>>): string {
        if (data.length === 0) {
            return 'Sem dados para tabela.';
        }

        const headers = Object.keys(data[0]);
        const rows = data.map((row) => headers.map((header) => String(row[header] ?? '')).join(' | '));

        return [headers.join(' | '), headers.map(() => '---').join(' | '), ...rows].join('\n');
    }

    private replaceByXmlFallback(
        docBuffer: Buffer,
        replacements: Record<string, string>,
        templatePayload?: RDATemplateDocPayload,
    ): Buffer {
        try {
            const zip = new PizZip(docBuffer);
            const normalizedReplacements = this.normalizeReplacements(replacements);
            const payloadReplacements = this.flattenTemplatePayload(templatePayload);

            Object.keys(zip.files)
                .filter((name) => name.startsWith('word/') && name.endsWith('.xml'))
                .forEach((name) => {
                    const entry = zip.file(name);
                    if (!entry) {
                        return;
                    }

                    let xml = entry.asText();

                    Object.entries(replacements).forEach(([placeholder, value]) => {
                        xml = xml.split(placeholder).join(value ?? '');
                    });

                    Object.entries(normalizedReplacements).forEach(([key, value]) => {
                        xml = xml.split(`{${key}}`).join(value ?? '');
                        xml = xml.split(`{{${key}}}`).join(value ?? '');
                    });

                    Object.entries(payloadReplacements).forEach(([key, value]) => {
                        xml = xml.split(`{${key}}`).join(value ?? '');
                        xml = xml.split(`{{${key}}}`).join(value ?? '');
                    });

                    zip.file(name, xml);
                });

            return zip.generate({
                type: 'nodebuffer',
                compression: 'DEFLATE',
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Falha ao substituir placeholders no DOCX: ${message}`);
        }
    }

    private flattenTemplatePayload(payload?: RDATemplateDocPayload): Record<string, string> {
        if (!payload) {
            return {};
        }

        return {
            PROJETO_NOME: payload.PROJETO_NOME ?? '',
            ANO_BASE: payload.ANO_BASE ?? '',
            COMPETENCIA: payload.COMPETENCIA ?? '',
            COORDENADOR_TECNICO: payload.COORDENADOR_TECNICO ?? '',
            RESULTADOS_ALCANCADOS: payload.RESULTADOS_ALCANCADOS ?? '',
        };
    }
}

export const docxGeneratorService = new DocxGeneratorService();
