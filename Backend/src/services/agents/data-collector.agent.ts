import { AgentContext } from '@/types/rda.types';
import { claudeService } from '@/services/rda/claude.service';
import { BaseAgent } from './base.agent';
import { buildDataCollectorPrompt } from './prompts';

interface SprintSummary {
    sprintName: string;
    startDate: string;
    endDate: string;
    velocity: number;
    capacityUtilization: number;
}

interface DataCollectorOutput {
    collectedData: {
        statistics: {
            totalWorkItems: number;
            totalSprints: number;
            totalDocuments: number;
            totalWikiPages: number;
        };
        workItemsByType: Record<string, number>;
        workItemsByState: Record<string, number>;
        sprintsSummary: SprintSummary[];
        evidenceSummary: {
            keyDeliveries: string[];
            keyPendingItems: string[];
            evidenceStats: {
                workItemUrls: number;
                designLinks: number;
                wikiLinks: number;
            };
        };
    };
    summary: string;
    tokensUsed: number;
}

interface CollectorLLMResponse {
    executiveSummary: string;
    keyDeliveries?: string[];
    keyPendingItems?: string[];
    evidenceStats?: {
        workItemUrls?: number;
        designLinks?: number;
        wikiLinks?: number;
    };
}

export class DataCollectorAgent extends BaseAgent {
    readonly name = 'DataCollectorAgent';
    readonly description = 'Coleta e organiza dados do período selecionado';

    protected async run(context: AgentContext): Promise<DataCollectorOutput> {
        await this.updateProgress(context.generationId, 10, 'data_collection_start');

        const workItemsByType = this.groupBy(context.workItems, (item) => item.type || 'Não informado');
        const workItemsByState = this.groupBy(context.workItems, (item) => item.state || 'Não informado');

        const statistics = {
            totalWorkItems: context.workItems.length,
            totalSprints: context.sprints.length,
            totalDocuments: context.documents.length,
            totalWikiPages: context.wikiPages.length,
        };

        const sprintsSummary = context.sprints.map((sprint) => {
            const velocity = sprint.totalStoryPoints && sprint.completedStoryPoints
                ? Number((sprint.completedStoryPoints / sprint.totalStoryPoints).toFixed(2))
                : 0;

            const capacityUtilization = sprint.teamCapacityHours && sprint.commitmentHours
                ? Number(((sprint.commitmentHours / sprint.teamCapacityHours) * 100).toFixed(2))
                : 0;

            return {
                sprintName: sprint.name,
                startDate: sprint.startDate.toISOString(),
                endDate: sprint.endDate.toISOString(),
                velocity,
                capacityUtilization,
            };
        });

        const promptBundle = buildDataCollectorPrompt(
            context,
            statistics,
            workItemsByType,
            workItemsByState,
            sprintsSummary,
        );

        const { data, tokensUsed } = await claudeService.completeJSON<CollectorLLMResponse>(promptBundle.prompt, {
            systemPrompt: promptBundle.systemPrompt,
            temperature: 0.4,
            maxTokens: 1600,
        });

        await this.updateProgress(context.generationId, 20, 'data_collection_done');

        return {
            collectedData: {
                statistics,
                workItemsByType,
                workItemsByState,
                sprintsSummary,
                evidenceSummary: {
                    keyDeliveries: data.keyDeliveries ?? [],
                    keyPendingItems: data.keyPendingItems ?? [],
                    evidenceStats: {
                        workItemUrls: data.evidenceStats?.workItemUrls ?? 0,
                        designLinks: data.evidenceStats?.designLinks ?? 0,
                        wikiLinks: data.evidenceStats?.wikiLinks ?? 0,
                    },
                },
            },
            summary: data.executiveSummary ?? '',
            tokensUsed,
        };
    }

    private groupBy<T>(items: T[], keySelector: (item: T) => string): Record<string, number> {
        return items.reduce<Record<string, number>>((accumulator, current) => {
            const key = keySelector(current);
            accumulator[key] = (accumulator[key] ?? 0) + 1;
            return accumulator;
        }, {});
    }
}
