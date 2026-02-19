import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import { prisma } from '@/database/client';
import { RDATemplateData } from '@/types/rda.types';
import { logger } from '@/utils/logger';
import { RDA_TEMPLATES_DIR } from '@/services/rda/storage-paths';

const TEMPLATE_DIR = RDA_TEMPLATES_DIR;

interface CreateTemplateInput {
    projectId: string;
    name: string;
    description?: string;
    uploadedBy: string;
}

interface UploadFileInput {
    filename: string;
    buffer: Buffer;
}

export class RDATemplateService {
    async createTemplate(data: CreateTemplateInput, file: UploadFileInput): Promise<RDATemplateData> {
        this.ensureTemplateDir();
        this.validateDocx(file.filename);

        const storageName = `${Date.now()}-${file.filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const filePath = path.join(TEMPLATE_DIR, storageName);

        fs.writeFileSync(filePath, file.buffer);
        const placeholders = await this.extractPlaceholders(filePath);

        const delegate = this.getTemplateDelegate();
        const created = await delegate.create({
            data: {
                name: data.name,
                projectId: data.projectId,
                description: data.description ?? null,
                filePath,
                placeholders,
                isActive: false,
                uploadedBy: data.uploadedBy,
            },
        });

        logger.info('[RDATemplateService] Template criado', { id: created.id, name: created.name });

        return this.mapTemplate(created);
    }

    async getTemplates(): Promise<RDATemplateData[]> {
        const delegate = this.getTemplateDelegate();
        const templates = await delegate.findMany({
            orderBy: { createdAt: 'desc' },
        });

        return templates.map((template: unknown) => this.mapTemplate(template));
    }

    async getTemplateById(id: string): Promise<RDATemplateData> {
        const delegate = this.getTemplateDelegate();
        const template = await delegate.findUnique({ where: { id } });

        if (!template) {
            throw new Error(`Template não encontrado: ${id}`);
        }

        return this.mapTemplate(template);
    }

    async setActiveTemplate(id: string): Promise<RDATemplateData> {
        const delegate = this.getTemplateDelegate();
        const currentTemplate = await delegate.findUnique({ where: { id } });
        if (!currentTemplate) {
            throw new Error(`Template não encontrado: ${id}`);
        }

        await delegate.updateMany({
            where: {},
            data: { isActive: false },
        });

        const activated = await delegate.update({
            where: { id },
            data: { isActive: true },
        });

        logger.info('[RDATemplateService] Template ativado', { id: activated.id });

        return this.mapTemplate(activated);
    }

    async deleteTemplate(id: string): Promise<void> {
        const delegate = this.getTemplateDelegate();
        const template = await delegate.findUnique({ where: { id } });

        if (!template) {
            throw this.createHttpError(404, `Template não encontrado: ${id}`);
        }

        const generationCount = await this.countGenerationsByTemplate(id);
        if (generationCount > 0) {
            throw this.createHttpError(409, 'Template não pode ser removido porque já possui gerações de RDA associadas.');
        }

        const mapped = this.mapTemplate(template);
        if (fs.existsSync(mapped.filePath)) {
            fs.unlinkSync(mapped.filePath);
        }

        await delegate.delete({ where: { id } });
        logger.info('[RDATemplateService] Template removido', { id });
    }

    async extractPlaceholders(filePath: string): Promise<string[]> {
        const binaryContent = fs.readFileSync(filePath, 'binary');
        const zip = new PizZip(binaryContent);
        const xmlContent = zip.file('word/document.xml')?.asText() ?? '';

        const regex = /\{\{\s*([^}]+?)\s*\}\}/g;
        const found = new Set<string>();
        let match: RegExpExecArray | null = null;
        while ((match = regex.exec(xmlContent)) !== null) {
            const raw = (match[1] ?? '').trim();
            if (!raw) {
                continue;
            }
            const normalized = this.normalizePlaceholderName(raw);
            if (!normalized) {
                continue;
            }
            found.add(`{{${normalized}}}`);
        }

        return Array.from(found);
    }

    private getTemplateDelegate(): {
        create: (args: unknown) => Promise<any>;
        findMany: (args?: unknown) => Promise<unknown[]>;
        findUnique: (args: unknown) => Promise<unknown | null>;
        update: (args: unknown) => Promise<any>;
        updateMany: (args: unknown) => Promise<unknown>;
        delete: (args: unknown) => Promise<unknown>;
    } {
        const prismaClient = prisma as unknown as {
            rDATemplate?: {
                create: (args: unknown) => Promise<any>;
                findMany: (args?: unknown) => Promise<unknown[]>;
                findUnique: (args: unknown) => Promise<unknown | null>;
                update: (args: unknown) => Promise<any>;
                updateMany: (args: unknown) => Promise<unknown>;
                delete: (args: unknown) => Promise<unknown>;
            };
        };

        if (!prismaClient.rDATemplate) {
            throw new Error('Modelo RDATemplate não está disponível no Prisma Client. Execute a migration da Fase 1/2.');
        }

        return prismaClient.rDATemplate;
    }

    private async countGenerationsByTemplate(templateId: string): Promise<number> {
        const prismaClient = prisma as unknown as {
            rDAGeneration?: {
                count: (args: { where: { templateId: string } }) => Promise<number>;
            };
        };

        if (!prismaClient.rDAGeneration) {
            return 0;
        }

        return prismaClient.rDAGeneration.count({
            where: { templateId },
        });
    }

    private mapTemplate(raw: unknown): RDATemplateData {
        const value = raw as {
            id: string;
            projectId: string;
            name: string;
            description?: string | null;
            filePath: string;
            placeholders?: string[];
            isActive: boolean;
            version?: number;
            createdAt?: Date;
            updatedAt?: Date;
        };

        return {
            id: value.id,
            projectId: value.projectId,
            name: value.name,
            description: value.description ?? null,
            filePath: value.filePath,
            placeholders: value.placeholders ?? [],
            isActive: value.isActive,
            version: value.version,
            createdAt: value.createdAt,
            updatedAt: value.updatedAt,
        };
    }

    private ensureTemplateDir(): void {
        if (!fs.existsSync(TEMPLATE_DIR)) {
            fs.mkdirSync(TEMPLATE_DIR, { recursive: true });
        }
    }

    private validateDocx(filename: string): void {
        if (!filename.toLowerCase().endsWith('.docx')) {
            throw this.createHttpError(400, 'Template inválido. Apenas arquivos .docx são aceitos.');
        }
    }

    private createHttpError(statusCode: number, message: string): Error & { statusCode: number } {
        const error = new Error(message) as Error & { statusCode: number; status?: number };
        error.statusCode = statusCode;
        error.status = statusCode;
        return error;
    }

    private normalizePlaceholderName(name: string): string {
        return name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .toUpperCase();
    }
}

export const rdaTemplateService = new RDATemplateService();
