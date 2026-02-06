import * as azdev from 'azure-devops-node-api';
import { IWorkItemTrackingApi } from 'azure-devops-node-api/WorkItemTrackingApi';
import { IWorkApi } from 'azure-devops-node-api/WorkApi';
import { ICoreApi } from 'azure-devops-node-api/CoreApi';
import { logger } from '@/utils/logger';
import type { AzureDevOpsConfig } from './types';

/**
 * Azure DevOps Client
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
     * Get Work Item Tracking API
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
     * Get Work API (for sprints, iterations, capacity)
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
     * Get Core API (for projects, teams)
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
     * Test connection to Azure DevOps
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
     * Get project configuration
     */
    getConfig(): AzureDevOpsConfig {
        return { ...this.config };
    }
}

// Singleton instance
let clientInstance: AzureDevOpsClient | null = null;

/**
 * Get or create Azure DevOps Client instance
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
 * Reset client instance (useful for testing)
 */
export function resetAzureDevOpsClient(): void {
    clientInstance = null;
}
