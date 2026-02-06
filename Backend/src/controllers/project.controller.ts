import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@/database/client';
import { projectParamsSchema } from '@/schemas/project.schema';
import { logger } from '@/utils/logger';
import { isMissingDatabaseTableError } from '@/utils/prisma-errors';

export class ProjectController {
    /**
     * List all active projects
     */
    async listProjects(_req: FastifyRequest, reply: FastifyReply) {
        // Keeping prisma direct here as it's simple, or move to project.service if strict
        // Use a narrow guard for missing tables to keep the UI usable when migrations aren't applied.
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
     * Get project details
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
     * Get Project Statistics (Work Items by State, etc)
     */
    async getProjectStats(req: FastifyRequest, reply: FastifyReply) {
        const { id } = projectParamsSchema.parse(req.params);

        // Fetch aggregate counts
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
