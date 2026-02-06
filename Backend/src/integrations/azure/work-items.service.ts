import { getAzureDevOpsClient } from './client';
import { logger } from '@/utils/logger';
import type {
    AzureWorkItem,
    AzureWorkItemUpdate,
    AzureComment,
    WorkItemQueryOptions,
} from './types';
import { TeamContext } from 'azure-devops-node-api/interfaces/CoreInterfaces';
import { WorkItemExpand } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';

/**
 * Azure DevOps Work Items Service
 * Handles all work item operations
 */
export class WorkItemsService {
    /**
     * Get work items by IDs
     */
    async getWorkItems(
        ids: number[],
        options: WorkItemQueryOptions = {}
    ): Promise<AzureWorkItem[]> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();

            const fields = options.fields || [
                'System.Id',
                'System.WorkItemType',
                'System.State',
                'System.Reason',
                'System.Title',
                'System.Description',
                'System.AcceptanceCriteria',
                'Microsoft.VSTS.TCM.ReproSteps',
                'System.AssignedTo',
                'Microsoft.VSTS.Scheduling.OriginalEstimate',
                'Microsoft.VSTS.Scheduling.CompletedWork',
                'Microsoft.VSTS.Scheduling.RemainingWork',
                'Microsoft.VSTS.Scheduling.StoryPoints',
                'Microsoft.VSTS.Common.Priority',
                'Microsoft.VSTS.Common.Severity',
                'System.CreatedDate',
                'System.ChangedDate',
                'System.ClosedDate',
                'System.ResolvedDate',
                'System.StateChangeDate',
                'Microsoft.VSTS.Common.ActivatedDate',
                'System.CreatedBy',
                'System.ChangedBy',
                'System.ClosedBy',
                'System.ResolvedBy',
                'System.Tags',
                'System.AreaPath',
                'System.IterationPath',
                'System.Parent',
            ];

            // Mapping simplisticly for now
            const expandValue = options.expand ?
                (options.expand === 'all' ? WorkItemExpand.Relations : WorkItemExpand.Relations)
                : WorkItemExpand.Relations;

            const workItems = await witApi.getWorkItems(
                ids,
                fields,
                options.asOf,
                expandValue
            );

            logger.info(`Fetched ${workItems.length} work items from Azure DevOps`);
            return workItems as unknown as AzureWorkItem[];
        } catch (error) {
            logger.error('Failed to fetch work items', { ids, error });
            throw error;
        }
    }

    /**
     * Query work items using WIQL
     */
    async queryWorkItems(wiql: string): Promise<number[]> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();
            const config = client.getConfig();

            const teamContext: TeamContext = {
                project: config.project
            };

            const result = await witApi.queryByWiql(
                { query: wiql },
                teamContext
            );

            const ids = result.workItems?.map((wi) => wi.id!) || [];
            logger.info(`WIQL query returned ${ids.length} work items`);

            return ids;
        } catch (error) {
            logger.error('Failed to query work items', { wiql, error });
            throw error;
        }
    }

    /**
     * Get work items for a sprint (with batching)
     */
    async getWorkItemsForSprint(iterationPath: string): Promise<AzureWorkItem[]> {
        const wiql = `
      SELECT [System.Id]
      FROM WorkItems
      WHERE [System.IterationPath] = '${iterationPath}'
      AND [System.WorkItemType] IN ('Product Backlog Item', 'Bug', 'Task', 'Feature')
      ORDER BY [System.WorkItemType], [Microsoft.VSTS.Common.Priority]
    `;

        const ids = await this.queryWorkItems(wiql);

        if (ids.length === 0) {
            return [];
        }

        // Process in batches to avoid API timeout
        const batchSize = 100;
        const allWorkItems: AzureWorkItem[] = [];

        logger.info(`Fetching ${ids.length} work items in batches of ${batchSize}...`);

        for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            logger.info(`Fetching batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(ids.length / batchSize)} (${batch.length} items)...`);

            const workItems = await this.getWorkItems(batch);
            allWorkItems.push(...workItems);

            // Small delay between batches to avoid rate limiting
            if (i + batchSize < ids.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        logger.info(`Successfully fetched all ${allWorkItems.length} work items`);
        return allWorkItems;
    }

    /**
     * Get work item updates (revisions)
     */
    async getWorkItemUpdates(workItemId: number): Promise<AzureWorkItemUpdate[]> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();

            // Fixed: passed only ID (library infers project or it takes just ID)
            const updates = await witApi.getUpdates(workItemId);

            logger.info(`Fetched ${updates.length} updates for work item ${workItemId}`);
            return updates as unknown as AzureWorkItemUpdate[];
        } catch (error) {
            logger.error('Failed to fetch work item updates', { workItemId, error });
            throw error;
        }
    }

    /**
     * Get work item comments
     */
    async getWorkItemComments(workItemId: number): Promise<AzureComment[]> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();
            const config = client.getConfig();

            // Fixed: swapped arguments to match (project, workItemId)
            const comments = await witApi.getComments(config.project, workItemId);

            logger.info(`Fetched ${comments.comments?.length || 0} comments for work item ${workItemId}`);
            return (comments.comments || []) as unknown as AzureComment[];
        } catch (error) {
            logger.error('Failed to fetch work item comments', { workItemId, error });
            throw error;
        }
    }

    /**
     * Get all work items changed since a date (with batching)
     */
    async getWorkItemsChangedSince(since: Date): Promise<AzureWorkItem[]> {
        const sinceStr = since.toISOString().split('T')[0];

        const wiql = `
      SELECT [System.Id]
      FROM WorkItems
      WHERE [System.ChangedDate] >= '${sinceStr}'
      ORDER BY [System.ChangedDate] DESC
    `;

        const ids = await this.queryWorkItems(wiql);

        if (ids.length === 0) {
            return [];
        }

        // Process in batches
        const batchSize = 100;
        const allWorkItems: AzureWorkItem[] = [];

        logger.info(`Fetching ${ids.length} changed work items in batches of ${batchSize}...`);

        for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            const workItems = await this.getWorkItems(batch);
            allWorkItems.push(...workItems);

            if (i + batchSize < ids.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        return allWorkItems;
    }

    /**
     * Get work item with relations (for hierarchy sync)
     */
    async getWorkItemWithRelations(id: number): Promise<any> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();

            const workItem = await witApi.getWorkItem(
                id,
                undefined,
                undefined,
                WorkItemExpand.Relations, // Expand relations
                undefined
            );

            return workItem;
        } catch (error) {
            logger.error(`Failed to get work item ${id} with relations`, { error });
            throw error;
        }
    }

    /**
     * Extract work item ID from Azure DevOps URL
     */
    extractIdFromUrl(url: string): number | null {
        const match = url.match(/workItems\/(\d+)/);
        return match ? parseInt(match[1], 10) : null;
    }
}

// Export singleton instance
export const workItemsService = new WorkItemsService();
