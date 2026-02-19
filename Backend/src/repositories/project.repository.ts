import { prisma } from '@/database/client';
import type { Project, Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';

/**
 * Repositorio de Projetos
 * Camada de acesso a dados para projetos
 */
export class ProjectRepository {
    /**
     * Criar ou atualizar um projeto
     */
    async upsert(data: Prisma.ProjectCreateInput): Promise<Project> {
        try {
            const project = await prisma.project.upsert({
                where: { azureId: data.azureId },
                create: data,
                update: {
                    name: data.name,
                    description: data.description,
                    state: data.state,
                    visibility: data.visibility,
                    lastSyncAt: new Date(),
                    updatedAt: new Date(),
                },
            });

            logger.info(`Upserted project ${project.name}`, { id: project.id });
            return project;
        } catch (error) {
            logger.error('Failed to upsert project', { data, error });
            throw error;
        }
    }

    /**
     * Buscar projeto por Azure ID
     */
    async findByAzureId(azureId: string): Promise<Project | null> {
        return prisma.project.findUnique({
            where: { azureId },
        });
    }

    /**
     * Buscar projeto por ID
     */
    async findById(id: string): Promise<Project | null> {
        return prisma.project.findUnique({
            where: { id },
        });
    }

    /**
     * Buscar todos os projetos
     */
    async findAll(): Promise<Project[]> {
        return prisma.project.findMany({
            orderBy: { name: 'asc' },
        });
    }

    /**
     * Buscar projeto com relacoes
     */
    async findByIdWithRelations(id: string) {
        return prisma.project.findUnique({
            where: { id },
            include: {
                sprints: {
                    orderBy: { startDate: 'desc' },
                    take: 10,
                },
                teamMembers: {
                    where: { isActive: true },
                },
                workItems: {
                    take: 100,
                    orderBy: { changedDate: 'desc' },
                },
                alerts: {
                    where: { status: 'active' },
                    orderBy: { detectedAt: 'desc' },
                },
            },
        });
    }

    /**
     * Atualizar horario da ultima sincronizacao
     */
    async updateLastSync(id: string): Promise<Project> {
        return prisma.project.update({
            where: { id },
            data: { lastSyncAt: new Date() },
        });
    }

    /**
     * Excluir projeto
     */
    async delete(id: string): Promise<void> {
        await prisma.project.delete({
            where: { id },
        });
        logger.info(`Deleted project ${id}`);
    }

    /**
     * Buscar projeto com hierarquia completa (sprints -> work items -> filhos)
     */
    async findByIdWithHierarchy(id: string) {
        return prisma.project.findUnique({
            where: { id },
            include: {
                sprints: {
                    include: {
                        workItems: {
                            where: { parentId: null },
                            include: {
                                children: {
                                    include: { assignedTo: true },
                                    orderBy: [{ type: 'asc' }, { priority: 'asc' }],
                                },
                                assignedTo: true,
                            },
                            orderBy: [{ type: 'asc' }, { priority: 'asc' }],
                        },
                    },
                    orderBy: { startDate: 'desc' },
                },
                teamMembers: {
                    where: { isActive: true },
                },
            },
        });
    }
}

// Exporta instancia singleton
export const projectRepository = new ProjectRepository();
