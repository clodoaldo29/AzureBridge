import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@/database/client';
import { logger } from '@/utils/logger';
import { isMissingDatabaseTableError } from '@/utils/prisma-errors';
import { z } from 'zod';

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
            limit: z.coerce.number().optional().default(50),
            offset: z.coerce.number().optional().default(0)
        });

        try {
            const filters = querySchema.parse(req.query);
            const where: any = { isRemoved: false };

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
                        assignedTo: { select: { displayName: true, imageUrl: true } }
                    }
                })
            ]);

            return reply.send({
                success: true,
                data: items,
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
            const items = await prisma.workItem.findMany({
                where: {
                    isRemoved: false,
                    // Assumindo que boolean/tag 'isBlocked' existe
                    // Usando verificacoes basicas de estado por enquanto
                    isBlocked: true
                },
                include: { assignedTo: true }
            });

            return reply.send({ success: true, data: items });
        } catch (error) {
            if (isMissingDatabaseTableError(error)) {
                logger.warn('Work items table missing, returning empty list.');
                return reply.send({ success: true, data: [] });
            }

            return reply.status(500).send({ success: false, error: 'Failed' });
        }
    }
}

export const workItemController = new WorkItemController();
