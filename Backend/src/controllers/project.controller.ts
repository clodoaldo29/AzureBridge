import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@/database/client';
import { projectParamsSchema } from '@/schemas/project.schema';
import { logger } from '@/utils/logger';
import { isMissingDatabaseTableError } from '@/utils/prisma-errors';

export class ProjectController {
    /**
     * Listar todos os projetos ativos
     */
    async listProjects(_req: FastifyRequest, reply: FastifyReply) {
        // Usando prisma diretamente aqui por ser simples
        // Guarda para tabelas faltantes, mantendo a UI funcional quando migrations nao foram aplicadas.
        try {
            const projects = await prisma.project.findMany({
                where: {
                    state: { not: 'deleting' }
                },
                orderBy: { name: 'asc' },
                include: {
                    _count: {
                        select: { sprints: true, workItems: true }
                    }
                }
            });

            return reply.send({
                success: true,
                data: projects
            });
        } catch (error) {
            if (isMissingDatabaseTableError(error)) {
                logger.warn('Projects table missing, returning empty list.');
                return reply.send({ success: true, data: [] });
            }

            throw error;
        }
    }

    /**
     * Obter detalhes do projeto
     */
    async getProject(req: FastifyRequest, reply: FastifyReply) {
        const { id } = projectParamsSchema.parse(req.params);

        const project = await prisma.project.findUnique({
            where: { id },
            include: {
                teamMembers: true
            }
        });

        if (!project) {
            return reply.status(404).send({
                success: false,
                error: 'Project not found'
            });
        }

        return reply.send({
            success: true,
            data: project
        });
    }

    /**
     * Obter Estatisticas do Projeto (Work Items por Estado, etc)
     */
    async getProjectStats(req: FastifyRequest, reply: FastifyReply) {
        const { id } = projectParamsSchema.parse(req.params);

        // Buscar contagens agregadas
        const [totalSprints, totalMembers, workItemStats] = await Promise.all([
            prisma.sprint.count({ where: { projectId: id } }),
            prisma.teamMember.count({ where: { projectId: id, isActive: true } }),
            prisma.workItem.groupBy({
                by: ['state'],
                where: { projectId: id, isRemoved: false },
                _count: true
            })
        ]);

        const stats = {
            counts: {
                sprints: totalSprints,
                members: totalMembers,
                workItems: workItemStats.reduce((acc, curr) => acc + curr._count, 0)
            },
            byState: workItemStats.reduce((acc, curr) => {
                acc[curr.state] = curr._count;
                return acc;
            }, {} as Record<string, number>)
        };

        return reply.send({
            success: true,
            data: stats
        });
    }
}

export const projectController = new ProjectController();
