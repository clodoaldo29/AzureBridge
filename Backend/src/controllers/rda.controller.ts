import { FastifyRequest, FastifyReply } from 'fastify';
import { documentService } from '@/services/rda/document.service';
import { wikiService } from '@/services/rda/wiki.service';
import {
    idParamsSchema,
    documentQuerySchema,
    documentUploadFieldsSchema,
    wikiSyncSchema,
    wikiPagesQuerySchema,
    wikiSearchQuerySchema,
} from '@/schemas/rda.schema';
import { logger } from '@/utils/logger';

export class RDAController {
    /**
     * Upload de documento (PDF/DOCX) via multipart
     */
    async uploadDocument(req: FastifyRequest, reply: FastifyReply) {
        const parts = req.parts();
        const fields: Record<string, string> = {};
        let fileBuffer: Buffer | null = null;
        let fileName = '';
        let fileMimeType = '';

        for await (const part of parts) {
            if (part.type === 'file') {
                if (fileBuffer) {
                    // Consome streams extras para evitar pendurar o parser multipart.
                    await part.toBuffer();
                    continue;
                }

                fileName = part.filename;
                fileMimeType = part.mimetype;
                fileBuffer = await part.toBuffer();
                continue;
            }

            if (part.type === 'field') {
                fields[part.fieldname] = String(part.value ?? '');
            }
        }

        if (!fileBuffer || !fileName || !fileMimeType) {
            return reply.status(400).send({
                success: false,
                error: 'Nenhum arquivo enviado',
            });
        }

        const { projectId, uploadedBy } = documentUploadFieldsSchema.parse(fields);

        const document = await documentService.uploadDocument({
            projectId,
            filename: fileName,
            buffer: fileBuffer,
            mimeType: fileMimeType,
            uploadedBy,
        });

        logger.info(`Documento uploaded: ${document.id} (${fileName})`);

        return reply.status(201).send({
            success: true,
            data: document,
        });
    }

    /**
     * Lista documentos de um projeto
     */
    async listDocuments(req: FastifyRequest, reply: FastifyReply) {
        const { projectId } = documentQuerySchema.parse(req.query);
        const documents = await documentService.getDocumentsByProject(projectId);

        return reply.send({
            success: true,
            data: documents,
        });
    }

    /**
     * Remove um documento
     */
    async deleteDocument(req: FastifyRequest, reply: FastifyReply) {
        const { id } = idParamsSchema.parse(req.params);
        await documentService.deleteDocument(id);

        return reply.send({
            success: true,
            data: { deleted: id },
        });
    }

    /**
     * Sincroniza páginas Wiki do Azure DevOps
     */
    async syncWiki(req: FastifyRequest, reply: FastifyReply) {
        const { projectId } = wikiSyncSchema.parse(req.body);
        const result = await wikiService.syncWikiPages(projectId);

        return reply.send({
            success: true,
            data: result,
        });
    }

    /**
     * Lista páginas Wiki de um projeto
     */
    async listWikiPages(req: FastifyRequest, reply: FastifyReply) {
        const { projectId } = wikiPagesQuerySchema.parse(req.query);
        const pages = await wikiService.getWikiPages(projectId);

        return reply.send({
            success: true,
            data: pages,
        });
    }

    /**
     * Busca conteúdo nas páginas Wiki
     */
    async searchWiki(req: FastifyRequest, reply: FastifyReply) {
        const { projectId, query } = wikiSearchQuerySchema.parse(req.query);
        const results = await wikiService.searchWikiContent(projectId, query);

        return reply.send({
            success: true,
            data: results,
        });
    }
}

export const rdaController = new RDAController();
