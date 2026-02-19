import { ChunkMetadata, ChunkingOptions, DocumentChunkData } from '@/modules/rda/schemas/rag.schema';
import { extractAndClassifyUrls } from '@/modules/rda/utils/url-builder';

const DEFAULT_OPTIONS: ChunkingOptions = {
    targetSize: 1000,
    maxSize: 1500,
    overlap: 120,
    separators: ['\n## ', '\n### ', '\n\n', '\n', '. '],
};

export interface ChunkInput {
    text: string;
    sourceType: ChunkMetadata['sourceType'];
    documentName: string;
    documentId?: string;
    wikiPageId?: string;
}

export class ChunkingService {
    chunkText(input: ChunkInput, options: Partial<ChunkingOptions> = {}): DocumentChunkData[] {
        const startedAt = Date.now();
        const mergedOptions = this.mergeOptions(options);
        const normalized = this.normalizeText(input.text);

        if (!normalized) {
            return [];
        }

        const rawChunks = this.semanticSplit(normalized, mergedOptions);
        const withOverlap = this.applyOverlap(rawChunks, mergedOptions.overlap);

        const output = withOverlap.map((content, index) => {
            const tokenCount = this.estimateTokens(content);
            const metadata: ChunkMetadata = {
                documentId: input.documentId,
                wikiPageId: input.wikiPageId,
                documentName: input.documentName,
                sectionHeading: this.detectHeading(content),
                contentType: this.detectContentType(content),
                position: index,
                sourceType: input.sourceType,
                urls: extractAndClassifyUrls(content).map((u) => u.url),
                urlTypes: extractAndClassifyUrls(content).map((u) => ({ url: u.url, type: u.type })),
            };

            return {
                content,
                metadata,
                chunkIndex: index,
                tokenCount,
            };
        });

        console.log('[Chunking] chunkText completed', {
            sourceType: input.sourceType,
            documentName: input.documentName,
            chunks: output.length,
            durationMs: Date.now() - startedAt,
        });

        return output;
    }

    private mergeOptions(options: Partial<ChunkingOptions>): ChunkingOptions {
        return {
            targetSize: options.targetSize ?? DEFAULT_OPTIONS.targetSize,
            maxSize: options.maxSize ?? DEFAULT_OPTIONS.maxSize,
            overlap: options.overlap ?? DEFAULT_OPTIONS.overlap,
            separators: options.separators ?? DEFAULT_OPTIONS.separators,
        };
    }

    private normalizeText(text: string): string {
        return text
            .replace(/\r\n/g, '\n')
            .replace(/\t/g, ' ')
            .replace(/\u00A0/g, ' ')
            .replace(/[ ]{2,}/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    private semanticSplit(text: string, options: ChunkingOptions): string[] {
        if (this.estimateTokens(text) <= options.maxSize) {
            return [text];
        }

        let segments = [text];

        for (const separator of options.separators) {
            const nextSegments: string[] = [];

            for (const segment of segments) {
                if (this.estimateTokens(segment) <= options.maxSize) {
                    nextSegments.push(segment);
                    continue;
                }

                const parts = this.splitBySeparator(segment, separator);
                if (parts.length <= 1) {
                    nextSegments.push(segment);
                    continue;
                }

                const packed = this.packParts(parts, options.targetSize, options.maxSize, separator);
                nextSegments.push(...packed);
            }

            segments = nextSegments;
        }

        return segments.flatMap((segment) => this.hardSplitIfNeeded(segment, options.maxSize));
    }

    private splitBySeparator(content: string, separator: string): string[] {
        if (!content.includes(separator)) {
            return [content];
        }

        if (separator.trim() === '. ') {
            return content
                .split(/(?<=[.!?])\s+/)
                .map((part) => part.trim())
                .filter(Boolean);
        }

        return content
            .split(separator)
            .map((part, index) => {
                if (index === 0) return part.trim();
                return `${separator.trim()} ${part}`.trim();
            })
            .filter(Boolean);
    }

    private packParts(parts: string[], targetSize: number, maxSize: number, separator: string): string[] {
        const chunks: string[] = [];
        let current = '';

        const joiner = separator.trim() === '. ' ? ' ' : '\n';

        for (const part of parts) {
            const candidate = current ? `${current}${joiner}${part}` : part;
            const candidateTokens = this.estimateTokens(candidate);

            if (candidateTokens <= maxSize) {
                current = candidate;
                continue;
            }

            if (current) {
                chunks.push(current.trim());
            }

            if (this.estimateTokens(part) > maxSize) {
                chunks.push(...this.hardSplitIfNeeded(part, maxSize));
                current = '';
            } else {
                current = part;
            }
        }

        if (current.trim()) {
            chunks.push(current.trim());
        }

        return this.repackTinyChunks(chunks, targetSize, maxSize);
    }

    private repackTinyChunks(chunks: string[], targetSize: number, maxSize: number): string[] {
        if (chunks.length <= 1) {
            return chunks;
        }

        const output: string[] = [];
        let carry = '';

        for (const chunk of chunks) {
            const tokens = this.estimateTokens(chunk);
            if (!carry) {
                carry = chunk;
                continue;
            }

            const carryTokens = this.estimateTokens(carry);
            const combined = `${carry}\n${chunk}`;
            const combinedTokens = this.estimateTokens(combined);

            if (carryTokens < targetSize * 0.35 && combinedTokens <= maxSize) {
                carry = combined;
                continue;
            }

            output.push(carry);
            carry = chunk;

            if (tokens >= targetSize) {
                output.push(carry);
                carry = '';
            }
        }

        if (carry) {
            output.push(carry);
        }

        return output;
    }

    private applyOverlap(chunks: string[], overlapTokens: number): string[] {
        if (chunks.length <= 1 || overlapTokens <= 0) {
            return chunks;
        }

        const output: string[] = [];

        for (let index = 0; index < chunks.length; index++) {
            const current = chunks[index];

            if (index === 0) {
                output.push(current);
                continue;
            }

            const previous = chunks[index - 1];
            const overlapText = this.takeLastTokens(previous, overlapTokens);
            output.push(overlapText ? `${overlapText}\n${current}` : current);
        }

        return output;
    }

    private takeLastTokens(text: string, tokenCount: number): string {
        const words = text.split(/\s+/).filter(Boolean);
        if (words.length <= tokenCount) {
            return text;
        }

        return words.slice(words.length - tokenCount).join(' ');
    }

    private hardSplitIfNeeded(text: string, maxSize: number): string[] {
        const words = text.split(/\s+/).filter(Boolean);
        if (words.length <= maxSize) {
            return [text.trim()];
        }

        const chunks: string[] = [];
        for (let i = 0; i < words.length; i += maxSize) {
            chunks.push(words.slice(i, i + maxSize).join(' ').trim());
        }

        return chunks.filter(Boolean);
    }

    private estimateTokens(text: string): number {
        if (!text) {
            return 0;
        }

        // Heuristica rapida: ~4 chars por token para pt-BR tecnico
        return Math.max(1, Math.ceil(text.length / 4));
    }

    private detectContentType(text: string): ChunkMetadata['contentType'] {
        const hasTable = /\|.+\|/.test(text) || /\t/.test(text);
        const hasList = /^\s*[-*]\s+/m.test(text) || /^\s*\d+\.\s+/m.test(text);
        const hasCode = /```[\s\S]*?```/.test(text) || /\b(function|class|const|let|var|import|export)\b/.test(text);

        const hits = [hasTable, hasList, hasCode].filter(Boolean).length;

        if (hits > 1) return 'mixed';
        if (hasTable) return 'table';
        if (hasList) return 'list';
        if (hasCode) return 'code';
        return 'text';
    }

    private detectHeading(text: string): string | undefined {
        const heading = text
            .split('\n')
            .map((line) => line.trim())
            .find((line) => /^#{1,4}\s+/.test(line) || /^[A-Z][A-Z0-9\s_\-]{8,}$/.test(line));

        if (!heading) {
            return undefined;
        }

        return heading.replace(/^#{1,4}\s+/, '').trim();
    }
}

export const chunkingService = new ChunkingService();
