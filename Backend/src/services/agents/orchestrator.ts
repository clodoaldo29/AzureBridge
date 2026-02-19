import { prisma } from '@/database/client';
import { AgentContext, AgentResult } from '@/types/rda.types';
import { logger } from '@/utils/logger';
import { BaseAgent } from './base.agent';
import { DataCollectorAgent } from './data-collector.agent';
import { AnalyzerAgent } from './analyzer.agent';
import { WriterAgent } from './writer.agent';
import { ReviewerAgent } from './reviewer.agent';
import { FormatterAgent } from './formatter.agent';

export class AgentOrchestrator {
    private readonly agents: BaseAgent[];

    constructor(agents?: BaseAgent[]) {
        this.agents = agents ?? [
            new DataCollectorAgent(),
            new AnalyzerAgent(),
            new WriterAgent(),
            new ReviewerAgent(),
            new FormatterAgent(),
        ];
    }

    async executeAgents(context: AgentContext): Promise<AgentResult[]> {
        const results: AgentResult[] = [];
        let tokensUsed = context.totalTokensUsed;

        for (const agent of this.agents) {
            const executionContext: AgentContext = {
                ...context,
                previousResults: results,
                totalTokensUsed: tokensUsed,
            };

            const result = await agent.execute(executionContext);

            if (!result.success) {
                await this.saveProgress(context.generationId, [...results, result], tokensUsed);
                await this.markAsFailed(context.generationId, result.error ?? `Falha no agente ${result.agentName}`);
                throw new Error(result.error ?? `Falha no agente ${result.agentName}`);
            }

            results.push(result);
            tokensUsed += result.tokensUsed;

            await this.saveProgress(context.generationId, results, tokensUsed);
        }

        return results;
    }

    async saveProgress(generationId: string, results: AgentResult[], tokensUsed: number): Promise<void> {
        try {
            const lastResult = results[results.length - 1];
            const prismaClient = prisma as unknown as {
                rDAGeneration?: {
                    update: (args: {
                        where: { id: string };
                        data: {
                            tokensUsed: number;
                            currentStep: string;
                            partialResults: unknown;
                        };
                    }) => Promise<unknown>;
                };
            };

            if (!prismaClient.rDAGeneration) {
                logger.warn('[AgentOrchestrator] Modelo RDAGeneration não disponível para salvar progresso');
                return;
            }

            await prismaClient.rDAGeneration.update({
                where: { id: generationId },
                data: {
                    tokensUsed,
                    currentStep: this.mapCompletedStep(lastResult?.agentName) ?? 'processing',
                    partialResults: results as unknown,
                },
            });
        } catch (error) {
            logger.warn('[AgentOrchestrator] Não foi possível salvar progresso parcial', {
                generationId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    async markAsFailed(generationId: string, errorMessage: string): Promise<void> {
        try {
            const prismaClient = prisma as unknown as {
                rDAGeneration?: {
                    update: (args: {
                        where: { id: string };
                        data: {
                            status: string;
                            errorMessage: string;
                            currentStep: string;
                        };
                    }) => Promise<unknown>;
                };
            };

            if (!prismaClient.rDAGeneration) {
                logger.warn('[AgentOrchestrator] Modelo RDAGeneration não disponível para marcar falha');
                return;
            }

            await prismaClient.rDAGeneration.update({
                where: { id: generationId },
                data: {
                    status: 'failed',
                    errorMessage,
                    currentStep: 'failed',
                },
            });
        } catch (error) {
            logger.error('[AgentOrchestrator] Falha ao atualizar status para failed', {
                generationId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private mapCompletedStep(agentName?: string): string | null {
        if (!agentName) {
            return null;
        }

        const mapping: Record<string, string> = {
            DataCollectorAgent: 'data_collection_done',
            AnalyzerAgent: 'analysis_done',
            WriterAgent: 'writing_done',
            ReviewerAgent: 'review_done',
            FormatterAgent: 'formatting_done',
        };

        return mapping[agentName] ?? agentName;
    }
}

export const agentOrchestrator = new AgentOrchestrator();
