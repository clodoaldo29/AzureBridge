import { FastifyInstance } from 'fastify';
import { projectController } from '@/controllers/project.controller';
import { sprintController } from '@/controllers/sprint.controller';
import { workItemController } from '@/controllers/work-item.controller';
import { syncController } from '@/controllers/sync.controller';
import { dashboardController } from '@/controllers/dashboard.controller';
import { capacityController } from '@/controllers/capacity.controller';
import { logger } from '@/utils/logger';
import { checkDatabaseConnection } from '@/database/client';

export async function apiRoutes(fastify: FastifyInstance) {
    // Verificacao de saude
    fastify.get('/health', async () => {
        const dbConnected = await checkDatabaseConnection();
        if (!dbConnected) {
            logger.warn('Health check em modo degradado: sem conexao com banco.');
        }

        return {
            status: dbConnected ? 'ok' : 'degraded',
            database: dbConnected ? 'connected' : 'disconnected',
            timestamp: new Date(),
            version: '2.0.0',
        };
    });

    // Projetos
    fastify.get('/projects', projectController.listProjects);
    fastify.get('/projects/:id', projectController.getProject);
    fastify.get('/projects/:id/stats', projectController.getProjectStats);

    // Sprints
    fastify.get('/sprints', sprintController.listSprints);
    fastify.get('/sprints/:id', sprintController.getSprint);
    fastify.get('/sprints/:id/burndown', sprintController.getSprintBurndown);
    // Especifico de capacidade
    fastify.get('/sprints/:sprintId/capacity/comparison', capacityController.getComparison);

    // Work Items
    fastify.get('/work-items', workItemController.listWorkItems);
    fastify.get('/work-items/:id', workItemController.getWorkItem);
    fastify.get('/work-items/:id/hierarchy', workItemController.getWorkItemWithChildren);
    fastify.get('/work-items/blocked', workItemController.getBlockedWorkItems);

    // Sincronizacao
    fastify.post('/sync/full', syncController.triggerFullSync);
    fastify.post('/sync/incremental', syncController.triggerIncrementalSync);

    // Dashboard
    fastify.get('/dashboard/overview', dashboardController.getOverview);
    fastify.get('/dashboard/current-sprints', dashboardController.getCurrentSprints);
    fastify.get('/dashboard/alerts', dashboardController.getAlerts);
}
