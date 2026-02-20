import { AgentContext } from '@/types/rda.types';
import { claudeService } from '@/services/rda/claude.service';
import { BaseAgent } from './base.agent';
import { buildWriterPrompt } from './prompts';

interface WriterSection {
    title: string;
    content: string;
    subsections: Array<{
        title: string;
        content: string;
    }>;
}

interface WriterOutput {
    sections: WriterSection[];
    metadata: {
        wordCount: number;
        keyHighlights: string[];
        templateAlignmentNotes?: string[];
    };
    templateFieldValues?: Record<string, string>;
    tokensUsed: number;
}

export class WriterAgent extends BaseAgent {
    readonly name = 'WriterAgent';
    readonly description = 'Escreve o conteúdo completo do relatório em português';

    protected async run(context: AgentContext): Promise<WriterOutput> {
        await this.updateProgress(context.generationId, 60, 'writing_start');

        const collectorResult = context.previousResults.find((result) => result.agentName === 'DataCollectorAgent');
        const analyzerResult = context.previousResults.find((result) => result.agentName === 'AnalyzerAgent');

        if (!collectorResult?.success || !collectorResult.data) {
            throw new Error('Dados do DataCollectorAgent não encontrados para escrita.');
        }

        if (!analyzerResult?.success || !analyzerResult.data) {
            throw new Error('Dados do AnalyzerAgent não encontrados para escrita.');
        }

        const promptBundle = buildWriterPrompt(context, collectorResult.data, analyzerResult.data);

        const { data, tokensUsed } = await claudeService.completeJSON<Omit<WriterOutput, 'tokensUsed'>>(promptBundle.prompt, {
            systemPrompt: promptBundle.systemPrompt,
            temperature: 0.6,
            maxTokens: 4200,
        });

        if (!Array.isArray(data.sections) || data.sections.length === 0) {
            throw new Error('WriterAgent retornou conteúdo inválido: sections vazio.');
        }

        if (data.templateFieldValues && typeof data.templateFieldValues !== 'object') {
            throw new Error('WriterAgent retornou templateFieldValues inválido.');
        }

        await this.updateProgress(context.generationId, 75, 'writing_done');

        return {
            ...data,
            tokensUsed,
        };
    }
}
