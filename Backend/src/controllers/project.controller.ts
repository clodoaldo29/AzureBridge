import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '@/database/client';
import { z } from 'zod';

export class ProjectController {
    /**
     * List all active projects
     */
    async listProjects(_req: FastifyRequest, reply: FastifyReply) {
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
            console.error('Error listing projects:', error);
            return reply.status(500).send({
                success: false,
                error: 'Internal Server Error'
            });
        }
    }

    /**
     * Get project details
     */
    async getProject(req: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({
            id: z.string()
        });

        try {
            const { id } = paramsSchema.parse(req.params);

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
        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request',
                    details: error.errors
                });
            }
            return reply.status(500).send({
                success: false,
                error: (error as Error).message
            });
        }
    }

    /**
     * Get Project Statistics (Work Items by State, etc)
     */
    async getProjectStats(req: FastifyRequest, reply: FastifyReply) {
        const paramsSchema = z.object({
            id: z.string()
        });

        try {
            const { id } = paramsSchema.parse(req.params);

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

        } catch (error) {
            if (error instanceof z.ZodError) {
                return reply.status(400).send({ success: false, error: 'Invalid ID' });
            }
            return reply.status(500).send({ success: false, error: 'Internal Server Error' });
        }
    }
}

export const projectController = new ProjectController();
