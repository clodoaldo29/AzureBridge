import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@/database/client';
import { logger } from '@/utils/logger';
import { isMissingDatabaseTableError } from '@/utils/prisma-errors';
import { getAzureDevOpsClient } from '@/integrations/azure/client';
import { buildAzureWorkItemUrl } from '@/utils/azure-url';
import { z } from 'zod';

async function resolveBlockedIdsFromAzureTaskboard(): Promise<number[]> {
    const client = getAzureDevOpsClient();
    const [coreApi, workApi] = await Promise.all([
        client.getCoreApi(),
        client.getWorkApi()
    ]);

    const activeSprints = await prisma.sprint.findMany({
        where: { state: { in: ['active', 'Active'] } },
        include: { project: true },
    });

    const blockedIds = new Set<number>();

    for (const sprint of activeSprints) {
        const projectName = sprint.project.name;
        const teams = await coreApi.getTeams(projectName);
        const defaultTeam = teams.find((t) => t.name === `${projectName} Team`) || teams[0];
        if (!defaultTeam) continue;

        try {
            const columns = await workApi.getWorkItemColumns(
                { project: projectName, team: defaultTeam.id || defaultTeam.name },
                String(sprint.azureId)
            );

            for (const col of columns || []) {
                const columnName = String(col.column || '').toLowerCase();
                if (!columnName.includes('block') && !columnName.includes('imped')) continue;
                if (typeof col.workItemId === 'number') blockedIds.add(col.workItemId);
            }
        } catch (error) {
            logger.warn('Failed to read taskboard columns for blocked items', {
                project: projectName,
                sprint: sprint.name,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return [...blockedIds];
}

export class WorkItemController {
    /**
     * Listar Work Items com filtros
     */
    async listWorkItems(req: FastifyRequest, reply: FastifyReply) {
        const querySchema = z.object({
            sprintId: z.string().optional(),
            projectId: z.string().optional(),
            type: z.string().optional(),
            state: z.string().optional(),
            assignedTo: z.string().optional(),
            includeRemoved: z.coerce.boolean().optional().default(false),
            limit: z.coerce.number().optional().default(50),
            offset: z.coerce.number().optional().default(0)
        });

        try {
            const filters = querySchema.parse(req.query);
            const where: any = {};
            if (!filters.includeRemoved) where.isRemoved = false;

            if (filters.sprintId) where.sprintId = filters.sprintId;
            if (filters.projectId) where.projectId = filters.projectId;
            if (filters.type) where.type = filters.type;
            if (filters.state) where.state = filters.state;
            if (filters.assignedTo) where.assignedToId = filters.assignedTo;

            // Filtros de Pendente/Bloqueado podem ser adicionados aqui

            const [total, items] = await Promise.all([
                prisma.workItem.count({ where }),
                prisma.workItem.findMany({
                    where,
                    take: filters.limit,
                    skip: filters.offset,
                    orderBy: { changedDate: 'desc' },
                    include: {
                        assignedTo: { select: { displayName: true, imageUrl: true } },
                        project: { select: { name: true } }
                    }
                })
            ]);
            const normalizedItems = items.map((item: any) => {
                const azureUrl = buildAzureWorkItemUrl({
                    id: item.id,
                    rawUrl: item.url,
                    projectName: item.project?.name || null
                });
                const { project, ...rest } = item;
                return {
                    ...rest,
                    azureUrl
                };
            });

            return reply.send({
                success: true,
                data: normalizedItems,
                meta: {
                    total,
                    limit: filters.limit,
                    offset: filters.offset
                }
            });
        } catch (error) {
            if (isMissingDatabaseTableError(error)) {
                logger.warn('Work items table missing, returning empty list.');
                return reply.send({
                    success: true,
                    data: [],
                    meta: {
                        total: 0,
                        limit: 0,
                        offset: 0
                    }
                });
            }

            return reply.status(500).send({ success: false, error: 'Failed to list work items' });
        }
    }

    /**
     * Obter detalhes do Work Item
     */
    async getWorkItem(req: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({ id: z.coerce.number() });

        try {
            const { id } = paramsSchema.parse(req.params);

            const item = await prisma.workItem.findUnique({
                where: { id },
                include: {
                    assignedTo: true,
                    project: true,
                    sprint: true,
                    parent: true,
                    children: {
                        select: { id: true, title: true, state: true, type: true }
                    }
                }
            });

            if (!item) return reply.status(404).send({ success: false, error: 'Work Item not found' });

            return reply.send({ success: true, data: item });
        } catch (error) {
            return reply.status(500).send({ success: false, error: 'Internal Error' });
        }
    }

    /**
     * Obter Hierarquia de Work Item (Arvore)
     * Util para visualizacao Feature -> PBI -> Task
     */
    async getWorkItemWithChildren(req: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({ id: z.coerce.number() });

        try {
            const { id } = paramsSchema.parse(req.params);

            // Buscar filhos recursivamente (ate alguns niveis, Prisma nao suporta include recursivo profundo facilmente)
            // Por enquanto, 2 niveis: Item -> Filhos -> Netos
            const item = await prisma.workItem.findUnique({
                where: { id },
                include: {
                    children: {
                        include: {
                            children: true // Netos
                        }
                    }
                }
            });

            if (!item) return reply.status(404).send({ success: false, error: 'Work Item not found' });

            return reply.send({ success: true, data: item });

        } catch (error) {
            return reply.status(500).send({ success: false, error: 'Failed to fetch hierarchy' });
        }
    }

    /**
     * Buscar Itens Bloqueados
     */
    async getBlockedWorkItems(_req: FastifyRequest, reply: FastifyReply) {
        try {
            const azureBlockedIds = await resolveBlockedIdsFromAzureTaskboard();
            const items = await prisma.workItem.findMany({
                where: {
                    isRemoved: false,
                    OR: [
                        { isBlocked: true },
                        ...(azureBlockedIds.length > 0 ? [{ id: { in: azureBlockedIds } }] : []),
                        { state: { in: ['Blocked', 'blocked', 'Impedido', 'impedido'] } },
                        { tags: { hasSome: ['Blocked', 'blocked', 'Blocker', 'blocker', 'Impedimento', 'impedimento'] } }
                    ]
                },
                include: { assignedTo: true }
            });

            return reply.send({ success: true, data: items });
        } catch (error) {
            if (isMissingDatabaseTableError(error)) {
                logger.warn('Work items table missing, returning empty list.');
                return reply.send({ success: true, data: [] });
            }

            logger.error('Failed to load blocked work items', {
                error: error instanceof Error ? error.message : String(error),
            });
            return reply.status(500).send({ success: false, error: 'Failed' });
        }
    }
}

export const workItemController = new WorkItemController();
