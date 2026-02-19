import { getAzureDevOpsClient } from './client';
import { logger } from '@/utils/logger';
import type { AzureProject, AzureTeamMember } from './types';

/**
 * Servico de Times do Azure DevOps
 * Gerencia operacoes de times e projetos
 */
export class TeamsService {
    /**
     * Buscar todos os projetos
     */
    async getProjects(): Promise<AzureProject[]> {
        try {
            const client = getAzureDevOpsClient();
            const coreApi = await client.getCoreApi();

            const projects = await coreApi.getProjects();

            logger.info(`Fetched ${projects.length} projects from Azure DevOps`);
            return projects as unknown as AzureProject[];
        } catch (error) {
            logger.error('Failed to fetch projects', error);
            throw error;
        }
    }

    /**
     * Get a specific project
     */
    async getProject(projectId: string): Promise<AzureProject | null> {
        try {
            const client = getAzureDevOpsClient();
            const coreApi = await client.getCoreApi();

            const project = await coreApi.getProject(projectId);

            logger.info(`Fetched project ${projectId} from Azure DevOps`);
            return project as unknown as AzureProject;
        } catch (error) {
            logger.error('Failed to fetch project', { projectId, error });
            return null;
        }
    }

    /**
     * Get team members
     */
    async getTeamMembers(
        projectId?: string,
        teamId?: string
    ): Promise<AzureTeamMember[]> {
        try {
            const client = getAzureDevOpsClient();
            const coreApi = await client.getCoreApi();
            const config = client.getConfig();

            const project = projectId || config.project;
            const team = teamId || config.team || project;

            const members = await coreApi.getTeamMembersWithExtendedProperties(
                project,
                team
            );

            logger.info(`Fetched ${members.length} team members from Azure DevOps`, {
                project,
                team,
            });

            return members as AzureTeamMember[];
        } catch (error) {
            logger.error('Failed to fetch team members', { projectId, teamId, error });
            throw error;
        }
    }

    /**
     * Get all teams in a project
     */
    async getTeams(projectId?: string): Promise<any[]> {
        try {
            const client = getAzureDevOpsClient();
            const coreApi = await client.getCoreApi();
            const config = client.getConfig();

            const project = projectId || config.project;
            const teams = await coreApi.getTeams(project);

            logger.info(`Fetched ${teams.length} teams from project ${project}`);
            return teams;
        } catch (error) {
            logger.error('Failed to fetch teams', { projectId, error });
            throw error;
        }
    }
}

// Export singleton instance
export const teamsService = new TeamsService();
