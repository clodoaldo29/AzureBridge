import { randomUUID } from 'crypto';
import OpenAI from 'openai';
import { Prisma } from '@prisma/client';
import { prisma } from '@/database/client';
import {
    ChunkMetadata,
    EmbeddingResult,
    HybridSearchWeights,
    SearchOptions,
    SearchResult,
} from '@/modules/rda/schemas/rag.schema';

interface ChunkEmbeddingInsertInput {
    projectId: string;
    content: string;
    metadata: ChunkMetadata | Record<string, unknown>;
    sourceType: 'document' | 'wiki' | 'workitem' | 'sprint';
    chunkIndex: number;
    tokenCount: number;
    embedding: number[];
    documentId?: string;
    wikiPageId?: string;
}

interface ChunkStats {
    totalChunks: number;
    chunksBySourceType: Record<string, number>;
    avgTokensPerChunk: number;
    totalTokens: number;
}

export class EmbeddingService {
    private readonly client: OpenAI;
    private readonly model = 'text-embedding-3-small';

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY nao configurada no ambiente.');
        }

        this.client = new OpenAI({ apiKey });
    }

    async generateEmbedding(text: string): Promise<EmbeddingResult> {
        const normalized = this.normalizeInput(text);
        const startedAt = Date.now();

        const response = await this.client.embeddings.create({
            model: this.model,
            input: normalized,
        });

        const embedding = response.data[0]?.embedding;
        if (!embedding || embedding.length === 0) {
            throw new Error('OpenAI retornou embedding vazio.');
        }

        const tokenCount = response.usage?.total_tokens ?? this.estimateTokens(normalized);

        console.log('[Embedding] generateEmbedding', {
            model: this.model,
            dimensions: embedding.length,
            tokens: tokenCount,
            durationMs: Date.now() - startedAt,
        });

        return {
            text: normalized,
            embedding,
            tokenCount,
        };
    }

    async generateEmbeddingsBatch(texts: string[], batchSize = 20): Promise<EmbeddingResult[]> {
        const cleanTexts = texts.map((item) => this.normalizeInput(item)).filter(Boolean);
        const startedAt = Date.now();

        if (cleanTexts.length === 0) {
            return [];
        }

        const results: EmbeddingResult[] = [];

        for (let i = 0; i < cleanTexts.length; i += batchSize) {
            const batch = cleanTexts.slice(i, i + batchSize);
            const response = await this.client.embeddings.create({
                model: this.model,
                input: batch,
            });

            response.data.forEach((item, index) => {
                results.push({
                    text: batch[index],
                    embedding: item.embedding,
                    tokenCount: this.estimateTokens(batch[index]),
                });
            });
        }

        console.log('[Embedding] generateEmbeddingsBatch', {
            count: cleanTexts.length,
            batchSize,
            durationMs: Date.now() - startedAt,
        });

        return results;
    }

    async storeChunksWithEmbeddings(chunks: ChunkEmbeddingInsertInput[]): Promise<number> {
        if (chunks.length === 0) {
            return 0;
        }

        const startedAt = Date.now();

        for (const chunk of chunks) {
            const vectorLiteral = this.toVectorLiteral(chunk.embedding);
            await prisma.$executeRaw(
                Prisma.sql`
                    INSERT INTO "document_chunks"
                    (
                        "id",
                        "documentId",
                        "wikiPageId",
                        "projectId",
                        "content",
                        "metadata",
                        "embedding",
                        "chunkIndex",
                        "tokenCount",
                        "sourceType",
                        "createdAt",
                        "updatedAt"
                    )
                    VALUES
                    (
                        ${randomUUID()},
                        ${chunk.documentId ?? null},
                        ${chunk.wikiPageId ?? null},
                        ${chunk.projectId},
                        ${chunk.content},
                        ${JSON.stringify(chunk.metadata)}::jsonb,
                        CAST(${vectorLiteral} AS vector),
                        ${chunk.chunkIndex},
                        ${chunk.tokenCount},
                        ${chunk.sourceType},
                        NOW(),
                        NOW()
                    )
                `,
            );
        }

        console.log('[Embedding] storeChunksWithEmbeddings', {
            count: chunks.length,
            durationMs: Date.now() - startedAt,
        });

        return chunks.length;
    }

    async deleteChunksByDocument(documentId: string): Promise<number> {
        const result = await prisma.documentChunk.deleteMany({
            where: { documentId },
        });

        return result.count;
    }

    async deleteChunksByWikiPage(wikiPageId: string): Promise<number> {
        const result = await prisma.documentChunk.deleteMany({
            where: { wikiPageId },
        });

        return result.count;
    }

    async hybridSearch(
        options: SearchOptions,
        weights: HybridSearchWeights = { vectorWeight: 0.7, fullTextWeight: 0.3, rrfK: 60 },
    ): Promise<SearchResult[]> {
        const startedAt = Date.now();
        const queryEmbedding = await this.generateEmbedding(options.query);

        const vectorResults = await this.vectorSearch(
            options.projectId,
            queryEmbedding.embedding,
            options.topK ?? 10,
            options.sourceTypes,
        );

        const fullTextResults = await this.fullTextSearch(
            options.projectId,
            options.query,
            options.topK ?? 10,
            options.sourceTypes,
        );

        const fused = this.reciprocalRankFusion(vectorResults, fullTextResults, weights.rrfK)
            .map((item) => {
                const vectorBoost = item.vectorRank !== undefined
                    ? weights.vectorWeight * (1 / (weights.rrfK + item.vectorRank + 1))
                    : 0;
                const fullTextBoost = item.fullTextRank !== undefined
                    ? weights.fullTextWeight * (1 / (weights.rrfK + item.fullTextRank + 1))
                    : 0;

                return {
                    ...item.result,
                    score: vectorBoost + fullTextBoost,
                    matchType: item.vectorRank !== undefined && item.fullTextRank !== undefined
                        ? 'hybrid' as const
                        : item.vectorRank !== undefined
                            ? 'vector' as const
                            : 'fulltext' as const,
                };
            })
            .filter((item) => item.score >= (options.minScore ?? 0))
            .sort((a, b) => b.score - a.score)
            .slice(0, options.topK ?? 10);

        console.log('[RAG] hybridSearch', {
            projectId: options.projectId,
            query: options.query,
            vectorResults: vectorResults.length,
            fullTextResults: fullTextResults.length,
            returned: fused.length,
            durationMs: Date.now() - startedAt,
        });

        return fused;
    }

    async getProjectChunkStats(projectId: string): Promise<ChunkStats> {
        const totalRows = await prisma.$queryRaw<Array<{ total: bigint | number | string }>>(
            Prisma.sql`SELECT COUNT(*) AS total FROM "document_chunks" WHERE "projectId" = ${projectId}`,
        );

        const groupedRows = await prisma.$queryRaw<Array<{ sourceType: string; total: bigint | number | string }>>(
            Prisma.sql`
                SELECT "sourceType", COUNT(*) AS total
                FROM "document_chunks"
                WHERE "projectId" = ${projectId}
                GROUP BY "sourceType"
            `,
        );

        const tokenRows = await prisma.$queryRaw<Array<{ avg_tokens: number | null; total_tokens: bigint | number | string | null }>>(
            Prisma.sql`
                SELECT AVG("tokenCount") AS avg_tokens, SUM("tokenCount") AS total_tokens
                FROM "document_chunks"
                WHERE "projectId" = ${projectId}
            `,
        );

        const chunksBySourceType: Record<string, number> = {};
        groupedRows.forEach((row) => {
            chunksBySourceType[row.sourceType] = Number(row.total ?? 0);
        });

        return {
            totalChunks: Number(totalRows[0]?.total ?? 0),
            chunksBySourceType,
            avgTokensPerChunk: Number(tokenRows[0]?.avg_tokens ?? 0),
            totalTokens: Number(tokenRows[0]?.total_tokens ?? 0),
        };
    }

    private async vectorSearch(
        projectId: string,
        queryEmbedding: number[],
        topK: number,
        sourceTypes?: string[],
    ): Promise<SearchResult[]> {
        const vectorLiteral = this.toVectorLiteral(queryEmbedding);

        const sourceFilter = sourceTypes && sourceTypes.length > 0
            ? Prisma.sql`AND "sourceType" = ANY(${sourceTypes})`
            : Prisma.empty;

        const rows = await prisma.$queryRaw<Array<{
            id: string;
            content: string;
            metadata: unknown;
            sourceType: string;
            similarity: number;
        }>>(
            Prisma.sql`
                SELECT
                    "id",
                    "content",
                    "metadata",
                    "sourceType",
                    1 - ("embedding" <=> CAST(${vectorLiteral} AS vector)) AS similarity
                FROM "document_chunks"
                WHERE "projectId" = ${projectId}
                ${sourceFilter}
                ORDER BY "embedding" <=> CAST(${vectorLiteral} AS vector)
                LIMIT ${topK}
            `,
        );

        return rows.map((row) => ({
            id: row.id,
            content: row.content,
            metadata: this.safeMetadata(row.metadata),
            sourceType: row.sourceType,
            score: Number(row.similarity ?? 0),
            matchType: 'vector',
        }));
    }

    private async fullTextSearch(
        projectId: string,
        query: string,
        topK: number,
        sourceTypes?: string[],
    ): Promise<SearchResult[]> {
        const sourceFilter = sourceTypes && sourceTypes.length > 0
            ? Prisma.sql`AND "sourceType" = ANY(${sourceTypes})`
            : Prisma.empty;

        const rows = await prisma.$queryRaw<Array<{
            id: string;
            content: string;
            metadata: unknown;
            sourceType: string;
            rank: number;
        }>>(
            Prisma.sql`
                SELECT
                    "id",
                    "content",
                    "metadata",
                    "sourceType",
                    ts_rank("tsv", plainto_tsquery('portuguese', ${query})) AS rank
                FROM "document_chunks"
                WHERE "projectId" = ${projectId}
                  ${sourceFilter}
                  AND "tsv" @@ plainto_tsquery('portuguese', ${query})
                ORDER BY rank DESC
                LIMIT ${topK}
            `,
        );

        return rows.map((row) => ({
            id: row.id,
            content: row.content,
            metadata: this.safeMetadata(row.metadata),
            sourceType: row.sourceType,
            score: Number(row.rank ?? 0),
            matchType: 'fulltext',
        }));
    }

    private reciprocalRankFusion(
        vectorResults: SearchResult[],
        fullTextResults: SearchResult[],
        rrfK: number,
    ): Array<{ result: SearchResult; vectorRank?: number; fullTextRank?: number }> {
        const map = new Map<string, { result: SearchResult; vectorRank?: number; fullTextRank?: number }>();

        vectorResults.forEach((result, index) => {
            map.set(result.id, {
                result,
                vectorRank: index,
            });
        });

        fullTextResults.forEach((result, index) => {
            const existing = map.get(result.id);
            if (existing) {
                existing.fullTextRank = index;
                return;
            }

            map.set(result.id, {
                result,
                fullTextRank: index,
            });
        });

        return Array.from(map.values())
            .sort((a, b) => {
                const aScore = (a.vectorRank !== undefined ? 1 / (rrfK + a.vectorRank + 1) : 0)
                    + (a.fullTextRank !== undefined ? 1 / (rrfK + a.fullTextRank + 1) : 0);
                const bScore = (b.vectorRank !== undefined ? 1 / (rrfK + b.vectorRank + 1) : 0)
                    + (b.fullTextRank !== undefined ? 1 / (rrfK + b.fullTextRank + 1) : 0);

                return bScore - aScore;
            });
    }

    private normalizeInput(text: string): string {
        return text
            .replace(/\u0000/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private estimateTokens(text: string): number {
        return Math.max(1, Math.ceil(text.length / 4));
    }

    private toVectorLiteral(vector: number[]): string {
        return `[${vector.join(',')}]`;
    }

    private safeMetadata(value: unknown): ChunkMetadata {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const raw = value as Partial<ChunkMetadata>;
            return {
                documentId: raw.documentId,
                wikiPageId: raw.wikiPageId,
                documentName: raw.documentName ?? 'Fonte sem identificacao',
                pageNumber: raw.pageNumber,
                sectionHeading: raw.sectionHeading,
                contentType: raw.contentType ?? 'text',
                position: raw.position ?? 0,
                sourceType: raw.sourceType ?? 'document',
                urls: raw.urls,
                urlTypes: raw.urlTypes,
            };
        }

        return {
            documentName: 'Fonte sem identificacao',
            contentType: 'text',
            position: 0,
            sourceType: 'document',
        };
    }
}

export const embeddingService = new EmbeddingService();

export type { ChunkEmbeddingInsertInput, ChunkStats };
