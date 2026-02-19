import { getAzureDevOpsClient } from './client';
import { logger } from '@/utils/logger';
import type { AzureSprint, AzureCapacity, SprintQueryOptions } from './types';
import { TreeStructureGroup } from 'azure-devops-node-api/interfaces/WorkItemTrackingInterfaces';
import { TeamContext } from 'azure-devops-node-api/interfaces/CoreInterfaces';

/**
 * Servico de Sprints do Azure DevOps
 * Gerencia operacoes de sprints/iteracoes
 */
export class SprintsService {
    /**
     * Buscar todas as sprints/iteracoes do projeto
     * Fallback para descoberta de sprints via work items se iteracoes do time nao estiverem configuradas
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

            // Se nao encontrou iteracoes via API do time, tenta Classification Nodes primeiro
            if (!sprints || sprints.length === 0) {
                logger.warn('No team iterations found, trying Classification Nodes API...');
                sprints = await this.getSprintsFromClassificationNodes();

                // Se ainda sem sprints, recorre a descoberta via work items
                if (!sprints || sprints.length === 0) {
                    logger.warn('No iterations in Classification Nodes, discovering from work items...');
                    sprints = await this.getSprintsFromWorkItems();
                }
            }

            // Filtrar por periodo se especificado
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
     * Buscar sprints via API de Classification Nodes (Iteration Paths)
     * Metodo mais confiavel pois consulta a estrutura do projeto diretamente
     */
    async getSprintsFromClassificationNodes(): Promise<AzureSprint[]> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();
            const config = client.getConfig();

            // Obter a arvore de nodos de classificacao de iteracao
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

            // Extrair recursivamente todos os nodos de iteracao
            const sprints: AzureSprint[] = [];
            const now = new Date();

            const extractIterations = (node: any, parentPath: string = config.project) => {
                if (!node) return;

                const nodePath = `${parentPath}\\${node.name}`;

                // Se o nodo tem atributos (datas inicio/fim), e uma sprint
                if (node.attributes) {
                    const startDate = node.attributes.startDate ? new Date(node.attributes.startDate) : undefined;
                    const endDate = node.attributes.finishDate ? new Date(node.attributes.finishDate) : undefined;

                    // Determinar periodo
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

                // Processar filhos recursivamente
                if (node.children && node.children.length > 0) {
                    node.children.forEach((child: any) => extractIterations(child, nodePath));
                }
            };

            // Iniciar extracao a partir dos filhos da raiz
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
     * Descobrir sprints a partir dos caminhos de iteracao dos work items
     * Fallback quando iteracoes do time nao estao configuradas
     */
    async getSprintsFromWorkItems(): Promise<AzureSprint[]> {
        try {
            const client = getAzureDevOpsClient();
            const witApi = await client.getWorkItemTrackingApi();
            const config = client.getConfig();

            // Consulta para obter caminhos de iteracao unicos
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

            // Buscar work items para extrair caminhos de iteracao
            const ids = result.workItems.slice(0, 100).map(wi => wi.id!);
            const workItems = await witApi.getWorkItems(ids, ['System.IterationPath']);

            // Extrair caminhos de iteracao unicos
            const iterationPaths = new Set<string>();
            workItems.forEach(wi => {
                const path = wi.fields?.['System.IterationPath'];
                if (path && path !== config.project) {
                    iterationPaths.add(path);
                }
            });

            // Converter caminhos de iteracao em objetos sprint
            const sprints: AzureSprint[] = Array.from(iterationPaths).map((path, index) => {
                const parts = path.split('\\');
                const name = parts[parts.length - 1];

                return {
                    id: `discovered-${index}`,
                    name,
                    path,
                    attributes: {
                        timeFrame: 'current' // Padrao 'current' pois nao temos datas
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
     * Buscar uma sprint especifica por ID
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

            // Chamada correta: (teamContext, iterationId)
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
     * Buscar sprint ativa atual
     */
    async getCurrentSprint(): Promise<AzureSprint | null> {
        const sprints = await this.getSprints({ timeFrame: 'current' });
        return sprints.length > 0 ? sprints[0] : null;
    }

    /**
     * Buscar capacidade do time para uma sprint
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

            // Cast para 'any' pois o typedef pode nao incluir getCapacitiesWithIdentityRefAndTotals
            // Mas sabemos que e uma chamada de Capacity do Time
            // O metodo padrao e getCapacities(teamContext, iterationId)
            let capacities;
            if ((workApi as any).getCapacitiesWithIdentityRefAndTotals) {
                capacities = await (workApi as any).getCapacitiesWithIdentityRefAndTotals(teamContext, sprintId);
            } else if ((workApi as any).getCapacities) {
                capacities = await (workApi as any).getCapacities(teamContext, sprintId);
            } else {
                throw new Error("Capacity API method not found");
            }

            // Ajustar tipo de retorno se retorna objeto wrapper
            if (capacities.teamMembers) return capacities.teamMembers as AzureCapacity[];
            return capacities as AzureCapacity[];

        } catch (error) {
            logger.error('Failed to fetch sprint capacity', { sprintId, error });
            throw error;
        }
    }

    /**
     * Buscar todas as sprints com suas capacidades
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

// Exporta instancia singleton
export const sprintsService = new SprintsService();
