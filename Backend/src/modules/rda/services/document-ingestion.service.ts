import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import { prisma } from '@/database/client';
import {
    ExtractionResult,
    IngestionProgress,
    IngestionResult,
} from '@/modules/rda/schemas/rag.schema';
import { ChunkingService, chunkingService } from '@/modules/rda/services/chunking.service';
import { ChunkEmbeddingInsertInput, EmbeddingService, embeddingService } from '@/modules/rda/services/embedding.service';
import { RDA_UPLOADS_DIR } from '@/services/rda/storage-paths';

interface IngestDocumentOptions {
    forceReprocess?: boolean;
    sourceType?: 'document' | 'wiki' | 'workitem' | 'sprint';
}

export class DocumentIngestionService {
    constructor(
        private readonly chunking: ChunkingService,
        private readonly embedding: EmbeddingService,
    ) {}

    async ingestDocument(
        documentId: string,
        options: IngestDocumentOptions = {},
        onProgress?: (progress: IngestionProgress) => void,
    ): Promise<IngestionResult> {
        const startedAt = Date.now();
        const sourceType = options.sourceType ?? 'document';

        const document = await prisma.document.findUnique({ where: { id: documentId } });
        if (!document) {
            throw new Error(`Documento nao encontrado: ${documentId}`);
        }

        if (document.chunked && !options.forceReprocess) {
            return {
                documentId,
                chunksCreated: document.chunkCount ?? 0,
                embeddingsGenerated: document.chunkCount ?? 0,
                extractionMethod: document.extractionMethod ?? 'n/a',
                extractionQuality: document.extractionQuality ?? 0,
                warnings: ['Documento ja processado anteriormente. Use forceReprocess=true para reprocessar.'],
                duration: Date.now() - startedAt,
            };
        }

        const warnings: string[] = [];

        onProgress?.({ documentId, step: 'extracting', progress: 5, details: 'Extraindo texto do arquivo.' });

        const absolutePath = this.resolveDocumentPath(document.storagePath);
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Arquivo do documento nao encontrado em disco: ${absolutePath}`);
        }

        const buffer = fs.readFileSync(absolutePath);
        const extraction = await this.extractTextWithFallback(buffer, document.mimeType, document.filename);
        warnings.push(...extraction.warnings);

        onProgress?.({ documentId, step: 'chunking', progress: 30, details: 'Gerando chunks semanticos.' });

        const chunks = this.chunking.chunkText({
            text: extraction.text,
            sourceType,
            documentName: document.filename,
            documentId: document.id,
        });

        if (chunks.length === 0) {
            throw new Error('Nao foi possivel gerar chunks a partir do documento.');
        }

        if (options.forceReprocess) {
            await this.embedding.deleteChunksByDocument(document.id);
        }

        onProgress?.({ documentId, step: 'embedding', progress: 60, details: 'Gerando embeddings dos chunks.' });

        const embeddings = await this.embedding.generateEmbeddingsBatch(chunks.map((chunk) => chunk.content));

        const rows: ChunkEmbeddingInsertInput[] = chunks.map((chunk, index) => ({
            projectId: document.projectId,
            documentId: document.id,
            content: chunk.content,
            metadata: chunk.metadata,
            sourceType: chunk.metadata.sourceType,
            chunkIndex: chunk.chunkIndex,
            tokenCount: chunk.tokenCount,
            embedding: embeddings[index]?.embedding ?? embeddings[0]?.embedding ?? [],
        }));

        if (rows.some((row) => row.embedding.length !== 1536)) {
            throw new Error('Embedding invalido detectado durante ingestao (dimensao esperada: 1536).');
        }

        onProgress?.({ documentId, step: 'storing', progress: 85, details: 'Persistindo chunks no banco.' });

        await this.embedding.storeChunksWithEmbeddings(rows);

        await prisma.document.update({
            where: { id: document.id },
            data: {
                extractedText: extraction.text,
                extractionMethod: extraction.method,
                extractionQuality: extraction.quality,
                chunked: true,
                chunkCount: rows.length,
            },
        });

        onProgress?.({ documentId, step: 'completed', progress: 100, details: 'Ingestao concluida.' });

        console.log('[Ingestion] Document ingestion completed', {
            documentId,
            filename: document.filename,
            chunks: rows.length,
            method: extraction.method,
            quality: extraction.quality,
            durationMs: Date.now() - startedAt,
        });

        return {
            documentId,
            chunksCreated: rows.length,
            embeddingsGenerated: rows.length,
            extractionMethod: extraction.method,
            extractionQuality: extraction.quality,
            warnings,
            duration: Date.now() - startedAt,
        };
    }

    private resolveDocumentPath(storagePath: string): string {
        if (path.isAbsolute(storagePath)) {
            return storagePath;
        }

        return path.join(RDA_UPLOADS_DIR, storagePath);
    }

    private async extractTextWithFallback(
        buffer: Buffer,
        mimeType: string,
        filename: string,
    ): Promise<ExtractionResult> {
        const warnings: string[] = [];

        if (mimeType === 'application/pdf') {
            try {
                const pdfParse = await import('pdf-parse');
                const result = await pdfParse.default(buffer);
                const text = (result.text ?? '').trim();

                if (!text) {
                    warnings.push('pdf-parse retornou texto vazio.');
                }

                return {
                    text,
                    method: 'pdf-parse',
                    quality: this.estimateExtractionQuality(text, filename),
                    pageCount: result.numpages,
                    warnings,
                };
            } catch (error) {
                throw new Error(`Falha ao extrair PDF com pdf-parse: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const mammoth = await import('mammoth');
            const mammothResult = await mammoth.extractRawText({ buffer });
            let text = (mammothResult.value ?? '').trim();

            if (!text || text.length < 80) {
                warnings.push('Mammoth retornou pouco texto. Aplicando fallback por XML do DOCX.');
                const xmlFallback = this.extractDocxTextByXml(buffer);
                if (xmlFallback.length > text.length) {
                    text = xmlFallback;
                }
            }

            return {
                text,
                method: 'mammoth',
                quality: this.estimateExtractionQuality(text, filename),
                warnings,
            };
        }

        throw new Error(`Tipo de arquivo nao suportado para ingestao RAG: ${mimeType}`);
    }

    private extractDocxTextByXml(buffer: Buffer): string {
        const zip = new PizZip(buffer);
        const xml = zip.file('word/document.xml')?.asText() ?? '';
        const runs = Array.from(xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)).map((m) => m[1] ?? '');

        return runs
            .join(' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    private estimateExtractionQuality(text: string, filename: string): number {
        if (!text) {
            return 0;
        }

        const base = Math.min(1, text.length / 5000);
        const hasWeirdChars = /\uFFFD|[\x00-\x08\x0E-\x1F]/.test(text);
        const multiplier = hasWeirdChars ? 0.6 : 1;
        const quality = Number((base * multiplier).toFixed(3));

        console.log('[Ingestion] estimateExtractionQuality', {
            filename,
            length: text.length,
            quality,
        });

        return quality;
    }
}

export const documentIngestionService = new DocumentIngestionService(
    chunkingService,
    embeddingService,
);
