import { prisma } from '@/database/client';
import { AgentContext, AgentResult } from '@/types/rda.types';
import { logger } from '@/utils/logger';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export abstract class BaseAgent {
    abstract readonly name: string;
    abstract readonly description: string;

    async execute(context: AgentContext): Promise<AgentResult> {
        const startedAt = new Date();
        const startedAtIso = startedAt.toISOString();

        logger.info(`[${this.name}] Início da execução`, {
            generationId: context.generationId,
            description: this.description,
        });

        try {
            const data = await this.runWithTimeout(context, DEFAULT_TIMEOUT_MS);
            const finishedAt = new Date();
            const durationMs = finishedAt.getTime() - startedAt.getTime();
            const tokensUsed = this.extractTokensUsed(data);

            logger.info(`[${this.name}] Execução concluída`, {
                generationId: context.generationId,
                durationMs,
                tokensUsed,
            });

            return {
                agentName: this.name,
                success: true,
                startedAt: startedAtIso,
                finishedAt: finishedAt.toISOString(),
                durationMs,
                tokensUsed,
                data,
            };
        } catch (error) {
            const finishedAt = new Date();
            const durationMs = finishedAt.getTime() - startedAt.getTime();
            const message = error instanceof Error ? error.message : String(error);

            logger.error(`[${this.name}] Falha na execução`, {
                generationId: context.generationId,
                durationMs,
                error: message,
            });

            return {
                agentName: this.name,
                success: false,
                startedAt: startedAtIso,
                finishedAt: finishedAt.toISOString(),
                durationMs,
                tokensUsed: 0,
                error: message,
            };
        }
    }

    protected abstract run(context: AgentContext): Promise<unknown>;

    protected async updateProgress(generationId: string, progress: number, currentStep: string): Promise<void> {
        try {
            const prismaClient = prisma as unknown as {
                rDAGeneration?: {
                    update: (args: { where: { id: string }; data: { progress: number; currentStep: string } }) => Promise<unknown>;
                };
            };

            if (!prismaClient.rDAGeneration) {
                logger.warn(`[${this.name}] Modelo RDAGeneration não disponível no Prisma Client`);
                return;
            }

            await prismaClient.rDAGeneration.update({
                where: { id: generationId },
                data: { progress, currentStep },
            });
        } catch (error) {
            logger.warn(`[${this.name}] Não foi possível atualizar progresso`, {
                generationId,
                progress,
                currentStep,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private extractTokensUsed(data: unknown): number {
        if (!data || typeof data !== 'object') {
            return 0;
        }

        const maybeTokens = (data as { tokensUsed?: unknown }).tokensUsed;
        return typeof maybeTokens === 'number' ? maybeTokens : 0;
    }

    private async runWithTimeout(context: AgentContext, timeoutMs: number): Promise<unknown> {
        let timeoutRef: NodeJS.Timeout | null = null;

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutRef = setTimeout(() => {
                reject(new Error(`Timeout de ${timeoutMs}ms excedido na execução do agente ${this.name}`));
            }, timeoutMs);
        });

        try {
            const result = await Promise.race([this.run(context), timeoutPromise]);
            return result;
        } finally {
            if (timeoutRef) {
                clearTimeout(timeoutRef);
            }
        }
    }
}
