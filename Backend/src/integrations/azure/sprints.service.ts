import { getAzureDevOpsClient } from './client';
import { logger } from '@/utils/logger';
import type { AzureSprint, AzureCapacity, SprintQueryOptions } from './types';
import { TreeStructureGroup } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { TeamContext } from 'azure-devops-node-api/interfaces/CoreInterfaces';

/**
 * Azure DevOps Sprints Service
 * Handles sprint/iteration operations
 */
export class SprintsService {
    /**
     * Get all sprints/iterations for the project
     * Falls back to discovering sprints from work items if team iterations are not configured
     */
    async getSprints(options: SprintQueryOptions = {}): Promise<AzureSprint[]> {
        try {
            const client = getAzureDevOpsClient();
            const workApi = await client.getWorkApi();
            const config = client.getConfig();

            const team = config.team || config.project;

            const teamContext: TeamContext = {
                project: config.project,
                team: team
            };

            const iterations = await workApi.getTeamIterations(teamContext);

            let sprints = iterations as AzureSprint[];

            // If no iterations found via team API, try Classification Nodes first
            if (!sprints || sprints.length === 0) {
                logger.warn('No team iterations found, trying Classification Nodes API...');
                sprints = await this.getSprintsFromClassificationNodes();

                // If still no sprints, fall back to work items discovery
                if (!sprints || sprints.length === 0) {
                    logger.warn('No iterations in Classification Nodes, discovering from work items...');
                    sprints = await this.getSprintsFromWorkItems();
                }
            }

            // Filter by timeframe if specified
            if (options.timeFrame && sprints.length > 0) {
                sprints = sprints.filter(
                    (sprint) => sprint.attributes?.timeFrame === options.timeFrame
                );
            }

            logger.info(`Fetched ${sprints.length} sprints from Azure DevOps`, {
                timeFrame: options.timeFrame,
            });

            return sprints;
        } catch (error) {
            logger.error('Failed to fetch sprints', { options, error });
            throw error;
        }
    }

    /**
     * Get sprints from Classification Nodes API (Iteration Paths)
     * This is the most reliable method as it queries the project structure directly
     */
    async getSprintsFromClassificationNodes(): Promise<AzureSprint[]> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();
            const config = client.getConfig();

            // Get the Iteration classification node tree
            const iterationNode = await witApi.getClassificationNode(
                config.project,
                TreeStructureGroup.Iterations,
                undefined, // path
                4 // depth - get up to 4 levels deep
            );

            if (!iterationNode || !iterationNode.children) {
                logger.warn('No iteration nodes found in project structure');
                return [];
            }

            // Recursively extract all iteration nodes
            const sprints: AzureSprint[] = [];
            const now = new Date();

            const extractIterations = (node: any, parentPath: string = config.project) => {
                if (!node) return;

                const nodePath = `${parentPath}\\${node.name}`;

                // If node has attributes (start/end dates), it's a sprint
                if (node.attributes) {
                    const startDate = node.attributes.startDate ? new Date(node.attributes.startDate) : undefined;
                    const endDate = node.attributes.finishDate ? new Date(node.attributes.finishDate) : undefined;

                    // Determine timeframe
                    let timeFrame = 'future';
                    if (startDate && endDate) {
                        if (now >= startDate && now <= endDate) {
                            timeFrame = 'current';
                        } else if (now > endDate) {
                            timeFrame = 'past';
                        }
                    }

                    sprints.push({
                        id: node.identifier || node.id?.toString() || `node-${sprints.length}`,
                        name: node.name,
                        path: nodePath,
                        attributes: {
                            startDate: node.attributes.startDate,
                            finishDate: node.attributes.finishDate,
                            timeFrame: timeFrame as any
                        },
                        url: node.url || ''
                    });
                }

                // Recursively process children
                if (node.children && node.children.length > 0) {
                    node.children.forEach((child: any) => extractIterations(child, nodePath));
                }
            };

            // Start extraction from root children
            iterationNode.children.forEach((child: any) => {
                extractIterations(child, config.project);
            });

            logger.info(`Discovered ${sprints.length} sprints from Classification Nodes`);
            return sprints;
        } catch (error) {
            logger.error('Failed to get sprints from Classification Nodes', error);
            return [];
        }
    }

    /**
     * Discover sprints from work item iteration paths
     * This is a fallback when team iterations are not configured
     */
    async getSprintsFromWorkItems(): Promise<AzureSprint[]> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();
            const config = client.getConfig();

            // Query to get unique iteration paths
            const wiql = {
                query: `SELECT [System.Id], [System.IterationPath] 
                        FROM WorkItems 
                        WHERE [System.TeamProject] = '${config.project}'
                        ORDER BY [System.IterationPath]`
            };

            const teamContext: TeamContext = {
                project: config.project
            };

            // queryByWiql expects (wiql, teamContext?)
            const result = await witApi.queryByWiql(wiql, teamContext);

            if (!result.workItems || result.workItems.length === 0) {
                logger.warn('No work items found to discover sprints');
                return [];
            }

            // Get work items to extract iteration paths
            const ids = result.workItems.slice(0, 100).map(wi => wi.id!);
            const workItems = await witApi.getWorkItems(ids, ['System.IterationPath']);

            // Extract unique iteration paths
            const iterationPaths = new Set<string>();
            workItems.forEach(wi => {
                const path = wi.fields?.['System.IterationPath'];
                if (path && path !== config.project) {
                    iterationPaths.add(path);
                }
            });

            // Convert iteration paths to sprint objects
            const sprints: AzureSprint[] = Array.from(iterationPaths).map((path, index) => {
                const parts = path.split('\\');
                const name = parts[parts.length - 1];

                return {
                    id: `discovered-${index}`,
                    name,
                    path,
                    attributes: {
                        timeFrame: 'current' // Default to current since we don't have dates
                    },
                    url: ''
                } as AzureSprint;
            });

            logger.info(`Discovered ${sprints.length} sprints from work items`);
            return sprints;
        } catch (error) {
            logger.error('Failed to discover sprints from work items', error);
            return [];
        }
    }

    /**
     * Get a specific sprint by ID
     */
    async getSprint(sprintId: string): Promise<AzureSprint | null> {
        try {
            const client = getAzureDevOpsClient();
            const workApi = await client.getWorkApi();
            const config = client.getConfig();

            const team = config.team || config.project;

            const teamContext: TeamContext = {
                project: config.project,
                team: team
            };

            // Correct call: (teamContext, iterationId)
            const sprint = await workApi.getTeamIteration(
                teamContext,
                sprintId
            );

            logger.info(`Fetched sprint ${sprintId} from Azure DevOps`);
            return sprint as AzureSprint;
        } catch (error) {
            logger.error('Failed to fetch sprint', { sprintId, error });
            return null;
        }
    }

    /**
     * Get current active sprint
     */
    async getCurrentSprint(): Promise<AzureSprint | null> {
        const sprints = await this.getSprints({ timeFrame: 'current' });
        return sprints.length > 0 ? sprints[0] : null;
    }

    /**
     * Get team capacity for a sprint
     */
    async getSprintCapacity(sprintId: string): Promise<AzureCapacity[]> {
        try {
            const client = getAzureDevOpsClient();
            const workApi = await client.getWorkApi();
            const config = client.getConfig();

            const team = config.team || config.project;
            const teamContext: TeamContext = {
                project: config.project,
                team: team
            };

            // Use 'any' cast because the Typedef might not include getCapacitiesWithIdentityRefAndTotals or similar
            // But we know it's a Team Capacity call. 
            // The standard method is getCapacities(teamContext, iterationId)
            let capacities;
            if ((workApi as any).getCapacitiesWithIdentityRefAndTotals) {
                capacities = await (workApi as any).getCapacitiesWithIdentityRefAndTotals(teamContext, sprintId);
            } else if ((workApi as any).getCapacities) {
                capacities = await (workApi as any).getCapacities(teamContext, sprintId);
            } else {
                throw new Error("Capacity API method not found");
            }

            // Adjust return type if it returns an wrapper object
            if (capacities.teamMembers) return capacities.teamMembers as AzureCapacity[];
            return capacities as AzureCapacity[];

        } catch (error) {
            logger.error('Failed to fetch sprint capacity', { sprintId, error });
            throw error;
        }
    }

    /**
     * Get all sprints with their capacities
     */
    async getSprintsWithCapacity(): Promise<
        Array<{ sprint: AzureSprint; capacities: AzureCapacity[] }>
    > {
        const sprints = await this.getSprints();
        const results = [];

        for (const sprint of sprints) {
            try {
                const capacities = await this.getSprintCapacity(sprint.id);
                results.push({ sprint, capacities });
            } catch (error) {
                logger.warn(`Failed to fetch capacity for sprint ${sprint.id}`, error);
                results.push({ sprint, capacities: [] });
            }
        }

        return results;
    }
}

// Export singleton instance
export const sprintsService = new SprintsService();
