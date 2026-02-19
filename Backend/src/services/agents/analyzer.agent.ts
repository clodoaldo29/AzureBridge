import { AgentContext } from '@/types/rda.types';
import { claudeService } from '@/services/rda/claude.service';
import { BaseAgent } from './base.agent';
import { buildAnalyzerPrompt } from './prompts';

interface AnalyzerOutput {
    performance: {
        velocity: string;
        throughput: string;
        leadTime: string;
    };
    quality: {
        bugRate: string;
        rework: string;
    };
    deliveryComparison?: {
        planned: string;
        delivered: string;
        gapAnalysis: string;
    };
    risks: Array<{
        type: string;
        description: string;
        severity: 'low' | 'medium' | 'high' | 'critical';
        mitigation: string;
    }>;
    trends: Record<string, string>;
    recommendations: string[];
    traceability?: {
        pbiReferences: Array<{ id: number; title: string; url: string }>;
        designReferences: Array<{ title: string; url: string; sourcePage: string }>;
    };
    tokensUsed: number;
}

export class AnalyzerAgent extends BaseAgent {
    readonly name = 'AnalyzerAgent';
    readonly description = 'Analisa dados e extrai insights acionáveis';

    protected async run(context: AgentContext): Promise<AnalyzerOutput> {
        await this.updateProgress(context.generationId, 30, 'analysis_start');

        const collectorResult = context.previousResults.find((result) => result.agentName === 'DataCollectorAgent');
        if (!collectorResult?.success || !collectorResult.data) {
            throw new Error('Resultado do DataCollectorAgent não encontrado para análise.');
        }

        const promptBundle = buildAnalyzerPrompt(context, collectorResult.data);

        const { data, tokensUsed } = await claudeService.completeJSON<Omit<AnalyzerOutput, 'tokensUsed'>>(promptBundle.prompt, {
            systemPrompt: promptBundle.systemPrompt,
            temperature: 0.3,
            maxTokens: 2800,
        });

        await this.updateProgress(context.generationId, 50, 'analysis_done');

        return {
            ...data,
            tokensUsed,
        };
    }
}
