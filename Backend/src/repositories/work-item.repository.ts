import { prisma } from '@/database/client';
import type { WorkItem, Prisma } from '@prisma/client';
import { logger } from '@/utils/logger';

/**
 * Repositorio de Work Items
 * Camada de acesso a dados para work items
 */
export class WorkItemRepository {
    /**
     * Criar ou atualizar um work item
     */
    async upsert(data: Prisma.WorkItemCreateInput): Promise<WorkItem> {
        try {
            const workItem = await prisma.workItem.upsert({
                where: { azureId: data.azureId },
                create: data,
                update: {
                    type: data.type,
                    state: data.state,
                    reason: data.reason,
                    title: data.title,
                    description: data.description,
                    acceptanceCriteria: data.acceptanceCriteria,
                    reproSteps: data.reproSteps,
                    originalEstimate: data.originalEstimate,
                    completedWork: data.completedWork,
                    remainingWork: data.remainingWork,
                    // @ts-ignore - Campo existe no BD mas o client pode nao estar gerado ainda
                    lastRemainingWork: (data as any).lastRemainingWork,
                    // @ts-ignore - Campo existe no BD mas o client pode nao estar gerado ainda
                    doneRemainingWork: (data as any).doneRemainingWork,
                    storyPoints: data.storyPoints,
                    effort: data.effort,
                    priority: data.priority,
                    severity: data.severity,
                    changedDate: data.changedDate,
                    closedDate: data.closedDate,
                    resolvedDate: data.resolvedDate,
                    stateChangeDate: data.stateChangeDate,
                    activatedDate: data.activatedDate,
                    changedBy: data.changedBy,
                    closedBy: data.closedBy,
                    resolvedBy: data.resolvedBy,
                    isBlocked: data.isBlocked,
                    isDelayed: data.isDelayed,
                    isRemoved: data.isRemoved,
                    tags: data.tags,
                    areaPath: data.areaPath,
                    iterationPath: data.iterationPath,
                    url: data.url,
                    rev: data.rev,
                    commentCount: data.commentCount,
                    attachmentCount: data.attachmentCount,
                    relationCount: data.relationCount,
                    assignedTo: (data as any).assignedTo
                        ? (data as any).assignedTo
                        : { disconnect: true },
                    lastSyncAt: new Date(),
                    updatedAt: new Date(),
                },
            });

            logger.info(`Upserted work item ${workItem.azureId}`, { id: workItem.id });
            return workItem;
        } catch (error) {
            logger.error('Failed to upsert work item', { azureId: data.azureId, error });
            throw error;
        }
    }

    /**
     * Buscar work item por Azure ID
     */
    async findByAzureId(azureId: number): Promise<WorkItem | null> {
        return prisma.workItem.findUnique({
            where: { azureId },
        });
    }

    /**
     * Buscar work item por ID
     */
    async findById(id: number): Promise<WorkItem | null> {
        return prisma.workItem.findUnique({
            where: { id },
        });
    }

    /**
     * Buscar work items por sprint
     */
    async findBySprint(sprintId: string): Promise<WorkItem[]> {
        return prisma.workItem.findMany({
            where: { sprintId },
            orderBy: [{ type: 'asc' }, { priority: 'asc' }],
        });
    }

    /**
     * Buscar work items por projeto
     */
    async findByProject(projectId: string, limit = 100): Promise<WorkItem[]> {
        return prisma.workItem.findMany({
            where: { projectId },
            orderBy: { changedDate: 'desc' },
            take: limit,
        });
    }

    /**
     * Buscar work item com relacoes
     */
    async findByIdWithRelations(id: number) {
        return prisma.workItem.findUnique({
            where: { id },
            include: {
                project: true,
                sprint: true,
                parent: true,
                children: true,
                assignedTo: true,
                revisions: {
                    orderBy: { revisedDate: 'desc' },
                },
                comments: {
                    orderBy: { createdDate: 'desc' },
                },
            },
        });
    }

    /**
     * Buscar work items bloqueados
     */
    async findBlocked(projectId?: string): Promise<WorkItem[]> {
        return prisma.workItem.findMany({
            where: {
                isBlocked: true,
                isRemoved: false,
                ...(projectId && { projectId }),
            },
            orderBy: { changedDate: 'desc' },
        });
    }

    /**
     * Buscar work items atrasados
     */
    async findDelayed(projectId?: string): Promise<WorkItem[]> {
        return prisma.workItem.findMany({
            where: {
                isDelayed: true,
                isRemoved: false,
                ...(projectId && { projectId }),
            },
            orderBy: { changedDate: 'desc' },
        });
    }

    /**
     * Buscar work items alterados desde uma data
     */
    async findChangedSince(since: Date, projectId?: string): Promise<WorkItem[]> {
        return prisma.workItem.findMany({
            where: {
                changedDate: { gte: since },
                ...(projectId && { projectId }),
            },
            orderBy: { changedDate: 'desc' },
        });
    }

    /**
     * Upsert em lote de work items
     */
    async bulkUpsert(items: Prisma.WorkItemCreateInput[]): Promise<number> {
        let count = 0;

        for (const item of items) {
            try {
                await this.upsert(item);
                count++;
            } catch (error) {
                logger.error(`Failed to upsert work item ${item.azureId}`, error);
            }
        }

        logger.info(`Bulk upserted ${count}/${items.length} work items`);
        return count;
    }

    /**
     * Excluir work item
     */
    async delete(id: number): Promise<void> {
        await prisma.workItem.delete({
            where: { id },
        });
        logger.info(`Deleted work item ${id}`);
    }

    /**
     * Buscar work items por sprint com estrutura hierarquica
     * Retorna apenas itens pais (PBIs, Features) com filhos carregados
     */
    async findBySprintHierarchical(sprintId: string) {
        return prisma.workItem.findMany({
            where: {
                sprintId,
                parentId: null, // Apenas itens de nivel superior
            },
            include: {
                children: {
                    include: {
                        assignedTo: true,
                    },
                    orderBy: [{ type: 'asc' }, { priority: 'asc' }],
                },
                assignedTo: true,
                sprint: true,
                project: true,
            },
            orderBy: [{ type: 'asc' }, { priority: 'asc' }],
        });
    }

    /**
     * Buscar apenas work items pais (PBIs, Features, Epics)
     * Util para listagem sem filhos
     */
    async findParentItems(sprintId: string) {
        return prisma.workItem.findMany({
            where: {
                sprintId,
                parentId: null,
                type: { in: ['Product Backlog Item', 'Feature', 'Epic'] },
            },
            include: {
                assignedTo: true,
            },
            orderBy: [{ type: 'asc' }, { priority: 'asc' }],
        });
    }

    /**
     * Buscar work items filhos de um pai
     */
    async findChildItems(parentId: number) {
        return prisma.workItem.findMany({
            where: { parentId },
            include: {
                assignedTo: true,
            },
            orderBy: [{ type: 'asc' }, { priority: 'asc' }],
        });
    }

    /**
     * Buscar work items por projeto com estrutura hierarquica
     * Retorna apenas itens pais com filhos carregados
     */
    async findByProjectHierarchical(projectId: string, limit = 100) {
        return prisma.workItem.findMany({
            where: {
                projectId,
                parentId: null, // Apenas itens de nivel superior
            },
            include: {
                children: {
                    include: {
                        assignedTo: true,
                    },
                    orderBy: [{ type: 'asc' }, { priority: 'asc' }],
                },
                assignedTo: true,
                sprint: true,
            },
            orderBy: { changedDate: 'desc' },
            take: limit,
        });
    }
}

// Exporta instancia singleton
export const workItemRepository = new WorkItemRepository();
