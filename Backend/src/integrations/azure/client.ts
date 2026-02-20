import * as azdev from 'azure-devops-node-api';
import { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import { IWorkApi } from 'azure-devops-node-api/WorkApi';
import { ICoreApi } from 'azure-devops-node-api/CoreApi';
import { IGitApi } from 'azure-devops-node-api/GitApi';
import { IWikiApi } from 'azure-devops-node-api/WikiApi';
import { logger } from '@/utils/logger';
import type { AzureDevOpsConfig } from './types';

/**
 * Cliente Azure DevOps
 * Gerencia conexão e autenticação com Azure DevOps API
 */
export class AzureDevOpsClient {
    private connection: azdev.WebApi;
    private config: AzureDevOpsConfig;

    constructor(config: AzureDevOpsConfig) {
        this.config = config;

        const authHandler = azdev.getPersonalAccessTokenHandler(config.pat);
        this.connection = new azdev.WebApi(config.orgUrl, authHandler);

        logger.info('Azure DevOps Client initialized', {
            org: config.orgUrl,
            project: config.project,
        });
    }

    /**
     * Obter API de Rastreamento de Work Items
     */
    async getWorkItemTrackingApi(): Promise<IWorkItemTrackingApi> {
        try {
            return await this.connection.getWorkItemTrackingApi();
        } catch (error) {
            logger.error('Failed to get Work Item Tracking API', error);
            throw new Error('Failed to connect to Azure DevOps Work Item Tracking API');
        }
    }

    /**
     * Obter API de Work (para sprints, iteracoes, capacidade)
     */
    async getWorkApi(): Promise<IWorkApi> {
        try {
            return await this.connection.getWorkApi();
        } catch (error) {
            logger.error('Failed to get Work API', error);
            throw new Error('Failed to connect to Azure DevOps Work API');
        }
    }

    /**
     * Obter API Core (para projetos, equipes)
     */
    async getCoreApi(): Promise<ICoreApi> {
        try {
            return await this.connection.getCoreApi();
        } catch (error) {
            logger.error('Failed to get Core API', error);
            throw new Error('Failed to connect to Azure DevOps Core API');
        }
    }

    /**
     * Obter API Git
     */
    async getGitApi(): Promise<IGitApi> {
        try {
            return await this.connection.getGitApi();
        } catch (error) {
            logger.error('Failed to get Git API', error);
            throw new Error('Failed to connect to Azure DevOps Git API');
        }
    }

    /**
     * Obter API Wiki (para acesso a páginas Wiki do projeto)
     */
    async getWikiApi(): Promise<IWikiApi> {
        try {
            return await this.connection.getWikiApi();
        } catch (error) {
            logger.error('Failed to get Wiki API', error);
            throw new Error('Failed to connect to Azure DevOps Wiki API');
        }
    }

    /**
     * Testar conexao com Azure DevOps
     */
    async testConnection(): Promise<boolean> {
        try {
            const coreApi = await this.getCoreApi();
            const projects = await coreApi.getProjects();

            logger.info('Azure DevOps connection test successful', {
                projectsCount: projects.length,
            });

            return true;
        } catch (error) {
            logger.error('Azure DevOps connection test failed', error);
            return false;
        }
    }

    /**
     * Obter configuracao do projeto
     */
    getConfig(): AzureDevOpsConfig {
        return { ...this.config };
    }
}

// Instancia singleton
let clientInstance: AzureDevOpsClient | null = null;

/**
 * Obter ou criar instancia do cliente Azure DevOps
 */
export function getAzureDevOpsClient(): AzureDevOpsClient {
    if (!clientInstance) {
        const config: AzureDevOpsConfig = {
            orgUrl: process.env.AZURE_DEVOPS_ORG_URL!,
            pat: process.env.AZURE_DEVOPS_PAT!,
            project: process.env.AZURE_DEVOPS_PROJECT!,
            team: process.env.AZURE_DEVOPS_TEAM,
        };

        if (!config.orgUrl || !config.pat || !config.project) {
            throw new Error(
                'Azure DevOps configuration missing. Please set AZURE_DEVOPS_ORG_URL, AZURE_DEVOPS_PAT, and AZURE_DEVOPS_PROJECT environment variables.'
            );
        }

        clientInstance = new AzureDevOpsClient(config);
    }

    return clientInstance;
}

/**
 * Resetar instancia do cliente (util para testes)
 */
export function resetAzureDevOpsClient(): void {
    clientInstance = null;
}
