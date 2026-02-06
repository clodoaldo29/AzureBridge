import { FastifyInstance } from 'fastify';
import { projectController } from '@/controllers/project.controller';
import { sprintController } from '@/controllers/sprint.controller';
import { workItemController } from '@/controllers/work-item.controller';
import { syncController } from '@/controllers/sync.controller';
import { dashboardController } from '@/controllers/dashboard.controller';
import { capacityController } from '@/controllers/capacity.controller';

export async function apiRoutes(fastify: FastifyInstance) {
    // Health Check
    fastify.get('/health', async () => ({
        status: 'ok',
        timestamp: new Date(),
        version: '2.0.0'
    }));

    // Projects
    fastify.get('/projects', projectController.listProjects);
    fastify.get('/projects/:id', projectController.getProject);
    fastify.get('/projects/:id/stats', projectController.getProjectStats);

    // Sprints
    fastify.get('/sprints', sprintController.listSprints);
    fastify.get('/sprints/:id', sprintController.getSprint);
    fastify.get('/sprints/:id/burndown', sprintController.getSprintBurndown);
    // Capacity specific
    fastify.get('/sprints/:sprintId/capacity/comparison', capacityController.getComparison);

    // Work Items
    fastify.get('/work-items', workItemController.listWorkItems);
    fastify.get('/work-items/:id', workItemController.getWorkItem);
    fastify.get('/work-items/:id/hierarchy', workItemController.getWorkItemWithChildren);
    fastify.get('/work-items/blocked', workItemController.getBlockedWorkItems);

    // Sync
    fastify.post('/sync/full', syncController.triggerFullSync);
    fastify.post('/sync/incremental', syncController.triggerIncrementalSync);

    // Dashboard
    fastify.get('/dashboard/overview', dashboardController.getOverview);
    fastify.get('/dashboard/current-sprints', dashboardController.getCurrentSprints);
    fastify.get('/dashboard/alerts', dashboardController.getAlerts);
}
