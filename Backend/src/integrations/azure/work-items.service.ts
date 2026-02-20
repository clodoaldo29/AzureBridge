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
 * Servico de Work Items do Azure DevOps
 * Gerencia todas as operacoes de work items
 */
export class WorkItemsService {
    private readonly unsupportedFields = new Set<string>();
    private availableFieldsCache: Set<string> | null = null;
    private availableFieldsCacheAt = 0;

    /**
     * Buscar work items por IDs
     */
    async getWorkItems(
        ids: number[],
        options: WorkItemQueryOptions = {}
    ): Promise<AzureWorkItem[]> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();

            let fields = options.fields || [
                'System.Id',
                'System.WorkItemType',
                'System.State',
                'System.Reason',
                'System.Title',
                'System.Description',
                'Microsoft.VSTS.Common.AcceptanceCriteria',
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
            fields = await this.filterSupportedFields(witApi, fields);

            // Azure DevOps pode rejeitar combinação de "fields" com "expand".
            // Para sincronização operacional do RDA, os campos já cobrem o necessário.
            // Só aplicamos expand quando não houver seleção explícita de fields.
            const hasFieldsSelection = Array.isArray(fields) && fields.length > 0;
            const expandValue = !hasFieldsSelection && options.expand
                ? (options.expand === 'all' ? WorkItemExpand.Relations : WorkItemExpand.Relations)
                : undefined;

            let workItems: unknown[] = [];
            let attempts = 0;

            while (attempts < 5) {
                attempts += 1;
                try {
                    workItems = await witApi.getWorkItems(
                        ids,
                        fields,
                        options.asOf,
                        expandValue,
                    ) as unknown[];
                    break;
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    const missingFieldMatch = message.match(/Cannot find field\s+([A-Za-z0-9._]+)/i);
                    const rawMissingField = missingFieldMatch?.[1];
                    const missingField = rawMissingField
                        ? rawMissingField.replace(/[^A-Za-z0-9_.]+$/g, '')
                        : undefined;

                    if (!missingField || !fields.includes(missingField) || attempts >= 5) {
                        throw error;
                    }

                    this.unsupportedFields.add(missingField);
                    fields = fields.filter((field) => field !== missingField);
                    logger.warn('Retrying getWorkItems without unsupported field', {
                        missingField,
                        attempts,
                    });
                }
            }

            logger.info(`Fetched ${workItems.length} work items from Azure DevOps`);
            return workItems as unknown as AzureWorkItem[];
        } catch (error) {
            logger.error('Failed to fetch work items', { ids, error });
            throw error;
        }
    }

    /**
     * Consultar work items usando WIQL
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
     * Buscar work items de uma sprint (com lotes)
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

        // Processar em lotes para evitar timeout da API
        const batchSize = 100;
        const allWorkItems: AzureWorkItem[] = [];

        logger.info(`Fetching ${ids.length} work items in batches of ${batchSize}...`);

        for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            logger.info(`Fetching batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(ids.length / batchSize)} (${batch.length} items)...`);

            const workItems = await this.getWorkItems(batch);
            allWorkItems.push(...workItems);

            // Pequeno delay entre lotes para evitar rate limiting
            if (i + batchSize < ids.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        logger.info(`Successfully fetched all ${allWorkItems.length} work items`);
        return allWorkItems;
    }

    /**
     * Buscar atualizacoes (revisoes) de um work item
     */
    async getWorkItemUpdates(workItemId: number): Promise<AzureWorkItemUpdate[]> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();

            // Corrigido: passando apenas o ID (a biblioteca infere o projeto)
            const updates = await witApi.getUpdates(workItemId);

            logger.info(`Fetched ${updates.length} updates for work item ${workItemId}`);
            return updates as unknown as AzureWorkItemUpdate[];
        } catch (error) {
            logger.error('Failed to fetch work item updates', { workItemId, error });
            throw error;
        }
    }

    /**
     * Buscar comentarios de um work item
     */
    async getWorkItemComments(workItemId: number): Promise<AzureComment[]> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();
            const config = client.getConfig();

            // Corrigido: argumentos invertidos para (project, workItemId)
            const comments = await witApi.getComments(config.project, workItemId);

            logger.info(`Fetched ${comments.comments?.length || 0} comments for work item ${workItemId}`);
            return (comments.comments || []) as unknown as AzureComment[];
        } catch (error) {
            logger.error('Failed to fetch work item comments', { workItemId, error });
            throw error;
        }
    }

    /**
     * Buscar todos os work items alterados desde uma data (com lotes)
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

        // Processar em lotes
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
     * Buscar work item com relacoes (para sincronizacao de hierarquia)
     */
    async getWorkItemWithRelations(id: number): Promise<any> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();

            const workItem = await witApi.getWorkItem(
                id,
                undefined,
                undefined,
                WorkItemExpand.Relations, // Expandir relacoes
                undefined
            );

            return workItem;
        } catch (error) {
            logger.error(`Failed to get work item ${id} with relations`, { error });
            throw error;
        }
    }

    /**
     * Extrair ID do work item de uma URL do Azure DevOps
     */
    extractIdFromUrl(url: string): number | null {
        const match = url.match(/workItems\/(\d+)/);
        return match ? parseInt(match[1], 10) : null;
    }

    private async filterSupportedFields(witApi: any, fields: string[]): Promise<string[]> {
        const available = await this.getAvailableFields(witApi);
        return fields.filter((field) => !this.unsupportedFields.has(field) && (!available || available.has(field)));
    }

    private async getAvailableFields(witApi: any): Promise<Set<string> | null> {
        const cacheTtlMs = 30 * 60 * 1000;
        const now = Date.now();
        if (this.availableFieldsCache && now - this.availableFieldsCacheAt < cacheTtlMs) {
            return this.availableFieldsCache;
        }

        try {
            const fields = await witApi.getFields();
            const refs = new Set<string>(
                (Array.isArray(fields) ? fields : [])
                    .map((item: { referenceName?: string }) => item?.referenceName)
                    .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0),
            );

            this.availableFieldsCache = refs;
            this.availableFieldsCacheAt = now;
            return refs;
        } catch (error) {
            logger.warn('Could not load Azure DevOps fields metadata. Falling back to runtime filtering.', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }
}

// Exporta instancia singleton
export const workItemsService = new WorkItemsService();
