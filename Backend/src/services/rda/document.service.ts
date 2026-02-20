import fs from 'fs';
import path from 'path';
import { prisma } from '@/database/client';
import { logger } from '@/utils/logger';
import { RDA_UPLOADS_DIR } from '@/services/rda/storage-paths';

const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const UPLOADS_DIR = RDA_UPLOADS_DIR;

export class DocumentService {
    private resolveMimeType(filename: string, mimeType: string) {
        if (ALLOWED_MIME_TYPES.includes(mimeType)) {
            return mimeType;
        }

        const normalizedName = filename.toLowerCase();
        if (normalizedName.endsWith('.pdf')) {
            return 'application/pdf';
        }

        if (normalizedName.endsWith('.docx')) {
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        }

        return mimeType;
    }

    /**
     * Upload e processamento de documento (PDF ou DOCX)
     */
    async uploadDocument(params: {
        projectId: string;
        filename: string;
        buffer: Buffer;
        mimeType: string;
        uploadedBy: string;
    }) {
        const { projectId, filename, buffer, mimeType, uploadedBy } = params;
        const normalizedMimeType = this.resolveMimeType(filename, mimeType);

        if (!ALLOWED_MIME_TYPES.includes(normalizedMimeType)) {
            throw new Error(`Tipo de arquivo nao suportado: ${mimeType}. Aceitos: PDF, DOCX`);
        }

        const projectDir = path.join(UPLOADS_DIR, projectId);
        if (!fs.existsSync(projectDir)) {
            fs.mkdirSync(projectDir, { recursive: true });
        }

        const timestamp = Date.now();
        const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storageName = `${timestamp}_${safeName}`;
        const storagePath = path.join(projectDir, storageName);

        fs.writeFileSync(storagePath, buffer);
        logger.info(`Documento salvo: ${storagePath} (${buffer.length} bytes)`);

        let extractedText: string | null = null;
        try {
            extractedText = await this.extractText(buffer, normalizedMimeType);
            logger.info(`Texto extraido do documento: ${extractedText?.length || 0} caracteres`);
        } catch (error) {
            logger.warn(`Falha ao extrair texto de ${filename}:`, error);
        }

        const document = await prisma.document.create({
            data: {
                projectId,
                filename,
                storagePath: path.relative(UPLOADS_DIR, storagePath),
                mimeType: normalizedMimeType,
                sizeBytes: buffer.length,
                extractedText,
                uploadedBy,
            },
        });

        logger.info(`Documento registrado no banco: ${document.id}`);
        return document;
    }

    /**
     * Extrai texto de um arquivo PDF ou DOCX
     */
    async extractText(buffer: Buffer, mimeType: string): Promise<string> {
        if (mimeType === 'application/pdf') {
            const pdfParse = require('pdf-parse');
            const result = await pdfParse(buffer);
            return result.text;
        }

        if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const mammoth = await import('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            return result.value;
        }

        throw new Error(`Extracao de texto nao suportada para: ${mimeType}`);
    }

    /**
     * Lista documentos de um projeto
     */
    async getDocumentsByProject(projectId: string) {
        return prisma.document.findMany({
            where: { projectId },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                filename: true,
                mimeType: true,
                sizeBytes: true,
                uploadedBy: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }

    /**
     * Busca documento por ID (com texto extraido)
     */
    async getDocumentById(id: string) {
        return prisma.document.findUnique({ where: { id } });
    }

    /**
     * Remove documento do filesystem e do banco
     */
    async deleteDocument(id: string) {
        const document = await prisma.document.findUnique({ where: { id } });
        if (!document) {
            throw new Error(`Documento nao encontrado: ${id}`);
        }

        const fullPath = path.join(UPLOADS_DIR, document.storagePath);
        if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
            logger.info(`Arquivo removido: ${fullPath}`);
        }

        await prisma.document.delete({ where: { id } });
        logger.info(`Documento removido do banco: ${id}`);

        return { success: true };
    }
}

export const documentService = new DocumentService();
