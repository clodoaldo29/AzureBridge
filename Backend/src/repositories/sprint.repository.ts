import { prisma } from '@/database/client';
import type { Sprint, Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';

/**
 * Repositorio de Sprints
 * Camada de acesso a dados para sprints
 */
export class SprintRepository {
    /**
     * Criar ou atualizar uma sprint
     */
    async upsert(data: Prisma.SprintCreateInput): Promise<Sprint> {
        try {
            const projectConnectId =
                (data as Prisma.SprintCreateInput & { project?: { connect?: { id: string } } }).project?.connect?.id;

            const sprint = await prisma.sprint.upsert({
                where: { azureId: data.azureId },
                create: data,
                update: {
                    name: data.name,
                    path: data.path,
                    startDate: data.startDate,
                    endDate: data.endDate,
                    state: data.state,
                    timeFrame: data.timeFrame,
                    ...(projectConnectId ? { project: { connect: { id: projectConnectId } } } : {}),
                    updatedAt: new Date(),
                },
            });

            logger.info(`Upserted sprint ${sprint.name}`, { id: sprint.id });
            return sprint;
        } catch (error) {
            logger.error('Failed to upsert sprint', { data, error });
            throw error;
        }
    }

    /**
     * Buscar sprint por Azure ID
     */
    async findByAzureId(azureId: string): Promise<Sprint | null> {
        return prisma.sprint.findUnique({
            where: { azureId },
        });
    }

    /**
     * Buscar sprint por ID
     */
    async findById(id: string): Promise<Sprint | null> {
        return prisma.sprint.findUnique({
            where: { id },
        });
    }

    /**
     * Buscar sprints por projeto
     */
    async findByProject(projectId: string): Promise<Sprint[]> {
        return prisma.sprint.findMany({
            where: { projectId },
            orderBy: { startDate: 'desc' },
        });
    }

    /**
     * Buscar todas as sprints
     */
    async findAll(): Promise<Sprint[]> {
        return prisma.sprint.findMany({
            orderBy: { startDate: 'desc' },
        });
    }

    /**
     * Buscar sprints ativas atuais
     */
    async findActive(projectId?: string): Promise<Sprint[]> {
        return prisma.sprint.findMany({
            where: {
                state: 'Active',
                ...(projectId && { projectId }),
            },
            orderBy: { startDate: 'desc' },
        });
    }

    /**
     * Buscar sprint com relacoes
     */
    async findByIdWithRelations(id: string) {
        return prisma.sprint.findUnique({
            where: { id },
            include: {
                project: true,
                workItems: {
                    orderBy: { changedDate: 'desc' },
                },
                capacities: {
                    include: {
                        member: true,
                    },
                },
                snapshots: {
                    orderBy: { snapshotDate: 'asc' },
                },
                alerts: {
                    where: { status: 'active' },
                },
            },
        });
    }

    /**
     * Buscar sprints por periodo
     */
    async findByTimeFrame(
        timeFrame: string,
        projectId?: string
    ): Promise<Sprint[]> {
        return prisma.sprint.findMany({
            where: {
                timeFrame,
                ...(projectId && { projectId }),
            },
            orderBy: { startDate: 'desc' },
        });
    }

    /**
     * Atualizar metricas da sprint
     */
    async updateMetrics(
        id: string,
        metrics: {
            totalPlannedHours?: number;
            totalCompletedHours?: number;
            totalRemainingHours?: number;
            totalStoryPoints?: number;
            completedStoryPoints?: number;
            teamCapacityHours?: number;
            commitmentHours?: number;
            isOnTrack?: boolean;
            riskLevel?: string;
        }
    ): Promise<Sprint> {
        return prisma.sprint.update({
            where: { id },
            data: {
                ...metrics,
                lastCalculatedAt: new Date(),
            },
        });
    }

    /**
     * Excluir sprint
     */
    async delete(id: string): Promise<void> {
        await prisma.sprint.delete({
            where: { id },
        });
        logger.info(`Deleted sprint ${id}`);
    }

    /**
     * Buscar sprint com work items hierarquicos
     */
    async findByIdWithHierarchy(id: string) {
        return prisma.sprint.findUnique({
            where: { id },
            include: {
                project: true,
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
        });
    }
}

// Exporta instancia singleton
export const sprintRepository = new SprintRepository();
