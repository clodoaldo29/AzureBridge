import { AgentContext } from '@/types/rda.types';
import { claudeService } from '@/services/rda/claude.service';
import { BaseAgent } from './base.agent';
import { buildReviewerPrompt } from './prompts';

interface ReviewerIssue {
    section: string;
    type: 'error' | 'warning' | 'suggestion';
    description: string;
    suggestion: string;
}

interface ReviewerOutput {
    issues: ReviewerIssue[];
    overallQuality: 'excellent' | 'good' | 'needs_improvement' | 'poor';
    improvements: string[];
    approved: boolean;
    traceabilityCheck?: {
        hasPbiUrls: boolean;
        hasDesignLinks: boolean;
        missingEvidenceSections: string[];
    };
    tokensUsed: number;
}

export class ReviewerAgent extends BaseAgent {
    readonly name = 'ReviewerAgent';
    readonly description = 'Revisa e valida a qualidade final do conteúdo';

    protected async run(context: AgentContext): Promise<ReviewerOutput> {
        await this.updateProgress(context.generationId, 80, 'review_start');

        const writerResult = context.previousResults.find((result) => result.agentName === 'WriterAgent');
        if (!writerResult?.success || !writerResult.data) {
            throw new Error('Resultado do WriterAgent não encontrado para revisão.');
        }

        const promptBundle = buildReviewerPrompt(writerResult.data);

        const { data, tokensUsed } = await claudeService.completeJSON<Omit<ReviewerOutput, 'tokensUsed'>>(promptBundle.prompt, {
            systemPrompt: promptBundle.systemPrompt,
            temperature: 0.2,
            maxTokens: 1800,
        });

        await this.updateProgress(context.generationId, 85, 'review_done');

        return {
            ...data,
            tokensUsed,
        };
    }
}
