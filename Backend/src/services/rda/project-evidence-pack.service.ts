import { DocumentData, ProjectEvidencePack, SprintData, WikiPageData, WorkItemData } from '@/types/rda.types';

interface BuildEvidencePackInput {
    projectId: string;
    projectName: string;
    periodStart: string;
    periodEnd: string;
    periodType: 'monthly' | 'general';
    workItems: WorkItemData[];
    sprints: SprintData[];
    wikiPages: WikiPageData[];
    documents: DocumentData[];
}

function extractUrls(text: string): string[] {
    const matches = text.match(/https?:\/\/[^\s)>"'<]+/gi) ?? [];
    return Array.from(new Set(matches));
}

function isDeliveredState(state: string): boolean {
    return /done|closed|resolved/i.test(state);
}

export class ProjectEvidencePackService {
    build(input: BuildEvidencePackInput): ProjectEvidencePack {
        const pbiReferences = input.workItems
            .filter((item) => Boolean(item.url))
            .map((item) => ({
                id: item.azureId,
                title: item.title,
                type: item.type,
                state: item.state,
                url: item.url,
            }));

        const deliveredItems = input.workItems.filter((item) => isDeliveredState(item.state));
        const plannedStoryPoints = input.workItems.reduce((sum, item) => sum + (item.storyPoints ?? 0), 0);
        const deliveredStoryPoints = deliveredItems.reduce((sum, item) => sum + (item.storyPoints ?? 0), 0);
        const completionRatePercent = plannedStoryPoints > 0
            ? Number(((deliveredStoryPoints / plannedStoryPoints) * 100).toFixed(2))
            : 0;

        const wikiLinkCandidates = input.wikiPages.flatMap((page) => extractUrls(page.content).map((url) => ({
            title: page.title,
            path: page.path,
            url,
        })));

        const designLinks = wikiLinkCandidates.filter((item) => /figma|design|prototype|wireframe|mockup/i.test(item.url));
        const wikiLinks = wikiLinkCandidates.filter((item) => !/figma|design|prototype|wireframe|mockup/i.test(item.url));

        const sprintPlan = input.sprints.map((sprint) => ({
            sprintName: sprint.name,
            startDate: sprint.startDate.toISOString(),
            endDate: sprint.endDate.toISOString(),
            plannedStoryPoints: sprint.totalStoryPoints ?? 0,
            deliveredStoryPoints: sprint.completedStoryPoints ?? 0,
        }));

        return {
            project: {
                id: input.projectId,
                name: input.projectName,
            },
            period: {
                start: input.periodStart,
                end: input.periodEnd,
                type: input.periodType,
            },
            plannedVsDelivered: {
                plannedStoryPoints,
                deliveredStoryPoints,
                completionRatePercent,
                plannedItems: input.workItems.length,
                deliveredItems: deliveredItems.length,
            },
            pbiReferences,
            designLinks,
            wikiLinks,
            sprintPlan,
        };
    }
}

export const projectEvidencePackService = new ProjectEvidencePackService();

