import { prisma } from '@/database/client';
import { WikiSyncResult } from '@/modules/rda/schemas/rag.schema';
import { ChunkingService, chunkingService } from '@/modules/rda/services/chunking.service';
import { ChunkEmbeddingInsertInput, EmbeddingService, embeddingService } from '@/modules/rda/services/embedding.service';

interface WikiIngestionOptions {
    forceReprocess?: boolean;
}

interface WikiProgress {
    current: number;
    total: number;
    pageId?: string;
    status?: string;
}

export class WikiIngestionService {
    constructor(
        private readonly chunking: ChunkingService,
        private readonly embedding: EmbeddingService,
    ) {}

    async processProjectWikiPages(
        projectId: string,
        options: WikiIngestionOptions = {},
        onProgress?: (progress: WikiProgress) => void,
    ): Promise<WikiSyncResult> {
        const startedAt = Date.now();

        const pages = await prisma.wikiPage.findMany({
            where: { projectId },
            orderBy: { updatedAt: 'desc' },
        });

        let pagesProcessed = 0;
        let pagesNew = 0;
        let pagesUpdated = 0;
        let pagesUnchanged = 0;
        let chunksCreated = 0;
        let embeddingsGenerated = 0;

        for (let index = 0; index < pages.length; index++) {
            const page = pages[index];
            onProgress?.({ current: index + 1, total: pages.length, pageId: page.id, status: 'processing' });

            if (!page.content || page.content.trim().length < 20) {
                pagesUnchanged += 1;
                continue;
            }

            const shouldSkip = page.chunked && !options.forceReprocess;
            if (shouldSkip) {
                pagesUnchanged += 1;
                continue;
            }

            if (options.forceReprocess) {
                await this.embedding.deleteChunksByWikiPage(page.id);
            }

            const chunks = this.chunking.chunkText({
                text: page.content,
                sourceType: 'wiki',
                documentName: page.title,
                wikiPageId: page.id,
            });

            if (chunks.length === 0) {
                pagesUnchanged += 1;
                continue;
            }

            const embeddings = await this.embedding.generateEmbeddingsBatch(chunks.map((chunk) => chunk.content));

            const rows: ChunkEmbeddingInsertInput[] = chunks.map((chunk, chunkIndex) => ({
                projectId,
                wikiPageId: page.id,
                content: chunk.content,
                metadata: {
                    ...chunk.metadata,
                    wikiPath: page.path,
                    wikiTitle: page.title,
                },
                sourceType: 'wiki',
                chunkIndex,
                tokenCount: chunk.tokenCount,
                embedding: embeddings[chunkIndex]?.embedding ?? embeddings[0]?.embedding ?? [],
            }));

            if (rows.some((row) => row.embedding.length !== 1536)) {
                throw new Error(`Embedding invalido na wiki page ${page.id}.`);
            }

            await this.embedding.storeChunksWithEmbeddings(rows);

            await prisma.wikiPage.update({
                where: { id: page.id },
                data: {
                    chunked: true,
                    chunkCount: rows.length,
                    lastSyncAt: new Date(),
                },
            });

            pagesProcessed += 1;
            chunksCreated += rows.length;
            embeddingsGenerated += rows.length;

            if (page.chunked) {
                pagesUpdated += 1;
            } else {
                pagesNew += 1;
            }
        }

        const result: WikiSyncResult = {
            pagesProcessed,
            pagesNew,
            pagesUpdated,
            pagesUnchanged,
            chunksCreated,
            embeddingsGenerated,
            duration: Date.now() - startedAt,
        };

        console.log('[Ingestion] Wiki ingestion completed', {
            projectId,
            ...result,
        });

        onProgress?.({ current: pages.length, total: pages.length, status: 'completed' });

        return result;
    }
}

export const wikiIngestionService = new WikiIngestionService(
    chunkingService,
    embeddingService,
);
