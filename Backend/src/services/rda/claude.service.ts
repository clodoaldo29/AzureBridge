import Anthropic from '@anthropic-ai/sdk';
import { logger } from '@/utils/logger';
import { ClaudeCompletionOptions } from '@/types/rda.types';

const DEFAULT_MODEL = process.env.CLAUDE_MODEL?.trim() || 'claude-sonnet-4-5-20250929';
const DEFAULT_MAX_TOKENS = 4000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 2000;

interface ClaudeTextResult {
    text: string;
    tokensUsed: number;
}

export class ClaudeService {
    private client: Anthropic | null = null;
    private readonly model: string;

    constructor(model = DEFAULT_MODEL) {
        this.model = model;
    }

    async complete(prompt: string, options: ClaudeCompletionOptions = {}): Promise<ClaudeTextResult> {
        try {
            const response = await this.createWithRetry({
                model: this.model,
                max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
                temperature: options.temperature ?? 0.7,
                system: options.systemPrompt,
                messages: [{ role: 'user', content: prompt }],
            });

            const text = response.content
                .filter((part) => part.type === 'text')
                .map((part) => part.text)
                .join('\n')
                .trim();

            const tokensUsed = (response.usage.input_tokens ?? 0) + (response.usage.output_tokens ?? 0);

            logger.info('[ClaudeService] Requisição concluída', {
                model: this.model,
                inputTokens: response.usage.input_tokens ?? 0,
                outputTokens: response.usage.output_tokens ?? 0,
                totalTokens: tokensUsed,
            });

            if (!text) {
                throw new Error('Resposta vazia recebida da API Claude.');
            }

            return { text, tokensUsed };
        } catch (error) {
            throw this.handleError('Falha ao gerar resposta textual com Claude', error);
        }
    }

    async completeJSON<T>(prompt: string, options: ClaudeCompletionOptions = {}): Promise<{ data: T; tokensUsed: number }> {
        const { text, tokensUsed } = await this.complete(prompt, {
            ...options,
            temperature: options.temperature ?? 0.3,
        });

        try {
            const data = this.parseJSONSafely<T>(text);
            return { data, tokensUsed };
        } catch (error) {
            throw this.handleError('Falha ao converter resposta JSON do Claude', error, {
                responsePreview: text.slice(0, 500),
            });
        }
    }

    async generateVariations(prompt: string, count: number): Promise<string[]> {
        if (!Number.isInteger(count) || count <= 0) {
            throw new Error('O parâmetro count deve ser um inteiro positivo.');
        }

        const variationPrompt = [
            'Gere variações diferentes para o conteúdo solicitado.',
            `Quantidade obrigatória de variações: ${count}.`,
            'Retorne exclusivamente JSON válido no formato: {"variations": ["..."]}.',
            'Cada variação deve ter tom profissional e ser semanticamente diferente.',
            '',
            prompt,
        ].join('\n');

        const { data } = await this.completeJSON<{ variations: string[] }>(variationPrompt, {
            temperature: 0.9,
            maxTokens: 6000,
        });

        if (!Array.isArray(data.variations)) {
            throw new Error('A resposta JSON não contém o campo variations como array.');
        }

        return data.variations.filter((value) => typeof value === 'string').slice(0, count);
    }

    private parseJSONSafely<T>(rawText: string): T {
        const candidates = this.buildJsonCandidates(rawText);

        for (const candidate of candidates) {
            try {
                return JSON.parse(candidate) as T;
            } catch {
                continue;
            }
        }

        throw new Error('Não foi possível interpretar JSON válido na resposta do modelo.');
    }

    private buildJsonCandidates(rawText: string): string[] {
        const stripped = this.stripMarkdownCodeFence(rawText).trim();
        const candidates = [rawText.trim(), stripped];

        const objectStart = stripped.indexOf('{');
        const objectEnd = stripped.lastIndexOf('}');
        if (objectStart >= 0 && objectEnd > objectStart) {
            candidates.push(stripped.slice(objectStart, objectEnd + 1));
        }

        const arrayStart = stripped.indexOf('[');
        const arrayEnd = stripped.lastIndexOf(']');
        if (arrayStart >= 0 && arrayEnd > arrayStart) {
            candidates.push(stripped.slice(arrayStart, arrayEnd + 1));
        }

        return Array.from(new Set(candidates.filter(Boolean)));
    }

    private stripMarkdownCodeFence(text: string): string {
        return text
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '');
    }

    private getClient(): Anthropic {
        if (this.client) {
            return this.client;
        }

        const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY/CLAUDE_API_KEY não está configurada no ambiente.');
        }

        this.client = new Anthropic({ apiKey });
        return this.client;
    }

    private async createWithRetry(payload: Anthropic.MessageCreateParams): Promise<Anthropic.Messages.Message> {
        let attempt = 0;
        let lastError: unknown = null;

        while (attempt < DEFAULT_RETRY_ATTEMPTS) {
            try {
                const response = await this.getClient().messages.create(payload);
                if (!response || typeof response !== 'object' || !('content' in response)) {
                    throw new Error('Resposta inválida da API Claude.');
                }
                return response as Anthropic.Messages.Message;
            } catch (error) {
                lastError = error;
                const message = error instanceof Error ? error.message : String(error);
                const isRateLimit = /429|rate[_\s-]?limit|too many requests/i.test(message);
                attempt += 1;

                if (!isRateLimit || attempt >= DEFAULT_RETRY_ATTEMPTS) {
                    break;
                }

                const delayMs = DEFAULT_RETRY_BASE_DELAY_MS * attempt + Math.floor(Math.random() * 600);
                logger.warn('[ClaudeService] Rate limit detectado, aplicando retry', {
                    attempt,
                    delayMs,
                    model: this.model,
                });
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }

        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    private handleError(message: string, error: unknown, metadata?: Record<string, unknown>): Error {
        const details = error instanceof Error ? error.message : String(error);

        logger.error('[ClaudeService] Erro', {
            message,
            details,
            ...metadata,
        });

        return new Error(`${message}: ${details}`);
    }
}

export const claudeService = new ClaudeService();

