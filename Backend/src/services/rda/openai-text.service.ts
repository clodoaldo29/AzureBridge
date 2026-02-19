import OpenAI from 'openai';
import { logger } from '@/utils/logger';
import { ClaudeCompletionOptions } from '@/types/rda.types';

const DEFAULT_MODEL = process.env.OPENAI_CONTEXT_MODEL || 'gpt-4.1-mini';
const DEFAULT_MAX_TOKENS = 2500;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1200;

interface OpenAITextResult {
    text: string;
    tokensUsed: number;
}

export class OpenAITextService {
    private client: OpenAI | null = null;
    private readonly model: string;

    constructor(model = DEFAULT_MODEL) {
        this.model = model;
    }

    async complete(prompt: string, options: ClaudeCompletionOptions = {}): Promise<OpenAITextResult> {
        try {
            const response = await this.createWithRetry({
                model: this.model,
                temperature: options.temperature ?? 0.2,
                max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
                messages: this.buildMessages(prompt, options.systemPrompt),
            });

            const text = response.choices
                .map((choice) => choice.message?.content ?? '')
                .join('\n')
                .trim();

            const tokensUsed = response.usage?.total_tokens ?? 0;

            logger.info('[OpenAITextService] Requisicao concluida', {
                model: this.model,
                promptTokens: response.usage?.prompt_tokens ?? 0,
                completionTokens: response.usage?.completion_tokens ?? 0,
                totalTokens: tokensUsed,
            });

            if (!text) {
                throw new Error('Resposta vazia recebida da API OpenAI.');
            }

            return { text, tokensUsed };
        } catch (error) {
            throw this.handleError('Falha ao gerar resposta textual com OpenAI', error);
        }
    }

    async completeJSON<T>(prompt: string, options: ClaudeCompletionOptions = {}): Promise<{ data: T; tokensUsed: number }> {
        try {
            const response = await this.createWithRetry({
                model: this.model,
                temperature: options.temperature ?? 0.1,
                max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
                response_format: { type: 'json_object' },
                messages: this.buildMessages(prompt, options.systemPrompt),
            });

            const text = response.choices
                .map((choice) => choice.message?.content ?? '')
                .join('\n')
                .trim();

            const tokensUsed = response.usage?.total_tokens ?? 0;
            const data = this.parseJSONSafely<T>(text);

            return { data, tokensUsed };
        } catch (error) {
            throw this.handleError('Falha ao converter resposta JSON da OpenAI', error);
        }
    }

    private getClient(): OpenAI {
        if (this.client) {
            return this.client;
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY nao configurada no ambiente.');
        }

        this.client = new OpenAI({ apiKey });
        return this.client;
    }

    private async createWithRetry(payload: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming): Promise<OpenAI.Chat.Completions.ChatCompletion> {
        let attempt = 0;
        let lastError: unknown = null;

        while (attempt < DEFAULT_RETRY_ATTEMPTS) {
            try {
                return await this.getClient().chat.completions.create({
                    ...payload,
                    stream: false,
                });
            } catch (error) {
                lastError = error;
                const message = error instanceof Error ? error.message : String(error);
                const isRetryable = /429|rate[_\s-]?limit|too many requests|timeout|ECONNRESET|ETIMEDOUT/i.test(message);
                attempt += 1;

                if (!isRetryable || attempt >= DEFAULT_RETRY_ATTEMPTS) {
                    break;
                }

                const delayMs = DEFAULT_RETRY_BASE_DELAY_MS * attempt + Math.floor(Math.random() * 400);
                logger.warn('[OpenAITextService] Retry por erro transiente', { attempt, delayMs, model: this.model });
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }

        throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }

    private buildMessages(prompt: string, systemPrompt?: string): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }

        messages.push({ role: 'user', content: prompt });
        return messages;
    }

    private parseJSONSafely<T>(rawText: string): T {
        const stripped = rawText
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

        const candidates = [rawText.trim(), stripped];
        const objectStart = stripped.indexOf('{');
        const objectEnd = stripped.lastIndexOf('}');
        if (objectStart >= 0 && objectEnd > objectStart) {
            candidates.push(stripped.slice(objectStart, objectEnd + 1));
        }

        for (const candidate of Array.from(new Set(candidates.filter(Boolean)))) {
            try {
                return JSON.parse(candidate) as T;
            } catch {
                continue;
            }
        }

        throw new Error('Nao foi possivel interpretar JSON valido na resposta da OpenAI.');
    }

    private handleError(message: string, error: unknown): Error {
        const details = error instanceof Error ? error.message : String(error);
        logger.error('[OpenAITextService] Erro', { message, details });
        return new Error(`${message}: ${details}`);
    }
}

export const openAITextService = new OpenAITextService();
