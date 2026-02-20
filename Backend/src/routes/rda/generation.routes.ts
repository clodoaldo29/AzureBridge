import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@/database/client';
import { rdaQueueService } from '@/modules/rda/services/rda-queue.service';

const paramsSchema = z.object({
    projectId: z.string().min(1),
    generationId: z.string().min(1),
});

const listParamsSchema = z.object({
    projectId: z.string().min(1),
});

const querySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    status: z.string().optional(),
});

export async function generationRoutes(fastify: FastifyInstance) {
    fastify.get('/:projectId/:generationId/progress', async (req: FastifyRequest, reply: FastifyReply) => {
        const { generationId } = paramsSchema.parse(req.params);
        const row = await prisma.rDAGeneration.findUnique({
            where: { id: generationId },
            select: { status: true, progress: true, currentStep: true },
        });

        if (!row) {
            return reply.status(404).send({ success: false, error: 'Geracao nao encontrada.' });
        }

        return reply.send({ success: true, data: row });
    });

    fastify.get('/:projectId/:generationId/download', async (req: FastifyRequest, reply: FastifyReply) => {
        const { generationId } = paramsSchema.parse(req.params);
        const row = await prisma.rDAGeneration.findUnique({
            where: { id: generationId },
            select: { status: true, outputFilePath: true },
        });

        if (!row || row.status !== 'completed' || !row.outputFilePath || !fs.existsSync(row.outputFilePath)) {
            return reply.status(404).send({ success: false, error: 'Arquivo nao disponivel.' });
        }

        const filename = path.basename(row.outputFilePath);
        return reply
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            .send(fs.createReadStream(row.outputFilePath));
    });

    fastify.post('/:projectId/:generationId/cancel', async (req: FastifyRequest, reply: FastifyReply) => {
        const { generationId } = paramsSchema.parse(req.params);
        const current = await prisma.rDAGeneration.findUnique({ where: { id: generationId }, select: { status: true } });

        if (!current || !['queued', 'processing'].includes(current.status)) {
            return reply.status(400).send({ success: false, error: 'Geracao nao pode ser cancelada neste estado.' });
        }

        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: { status: 'cancelled', currentStep: 'cancelled_by_user' },
        });

        return reply.send({ success: true, data: { success: true } });
    });

    fastify.post('/:projectId/:generationId/retry', async (req: FastifyRequest, reply: FastifyReply) => {
        const { generationId } = paramsSchema.parse(req.params);
        const generation = await prisma.rDAGeneration.findUnique({ where: { id: generationId } });

        if (!generation || generation.status !== 'failed') {
            return reply.status(400).send({ success: false, error: 'Apenas geracoes falhadas podem ser reenfileiradas.' });
        }

        const period = `${generation.periodStart.getUTCFullYear()}-${String(generation.periodStart.getUTCMonth() + 1).padStart(2, '0')}`;

        await prisma.rDAGeneration.update({
            where: { id: generationId },
            data: { status: 'queued', progress: 0, currentStep: 'retry_queued', errorMessage: null },
        });

        const jobId = await rdaQueueService.enqueue({
            generationId,
            projectId: generation.projectId,
            templateId: generation.templateId,
            periodKey: period,
        });

        return reply.send({ success: true, data: { success: true, jobId } });
    });

    fastify.get('/:projectId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = listParamsSchema.parse(req.params);
        const { page, limit, status } = querySchema.parse(req.query ?? {});

        const where: { projectId: string; status?: string } = { projectId };
        if (status) where.status = status;

        const [items, total] = await Promise.all([
            prisma.rDAGeneration.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    status: true,
                    progress: true,
                    currentStep: true,
                    periodStart: true,
                    periodEnd: true,
                    tokensUsed: true,
                    outputFilePath: true,
                    createdAt: true,
                    updatedAt: true,
                    errorMessage: true,
                },
            }),
            prisma.rDAGeneration.count({ where }),
        ]);

        return reply.send({ success: true, data: { items, total } });
    });

    fastify.get('/:projectId/:generationId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { generationId } = paramsSchema.parse(req.params);
        const row = await prisma.rDAGeneration.findUnique({ where: { id: generationId } });

        if (!row) {
            return reply.status(404).send({ success: false, error: 'Geracao nao encontrada.' });
        }

        return reply.send({ success: true, data: row });
    });
}
