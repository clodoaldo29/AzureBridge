import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
    FinalizeReviewRequestSchema,
    ReprocessSectionRequestSchema,
    SaveBatchOverridesRequestSchema,
    SaveOverrideRequestSchema,
} from '@/modules/rda/schemas/review.schema';
import { reprocessService } from '@/modules/rda/services/reprocess.service';
import { reviewService } from '@/modules/rda/services/review.service';
import { prisma } from '@/database/client';

const paramsSchema = z.object({
    projectId: z.string().min(1),
    generationId: z.string().min(1),
});

const removeParamsSchema = paramsSchema.extend({
    fieldKey: z.string().min(1),
});

export async function reviewRoutes(fastify: FastifyInstance) {
    fastify.get('/:projectId/:generationId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, generationId } = paramsSchema.parse(req.params);
        const data = await reviewService.getReviewData(projectId, generationId);
        return reply.send({ success: true, data });
    });

    fastify.put('/:projectId/:generationId/overrides', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, generationId } = paramsSchema.parse(req.params);
        const body = SaveOverrideRequestSchema.parse(req.body ?? {});
        const data = await reviewService.saveOverride(projectId, generationId, body);
        return reply.send({ success: true, data });
    });

    fastify.put('/:projectId/:generationId/overrides/batch', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, generationId } = paramsSchema.parse(req.params);
        const body = SaveBatchOverridesRequestSchema.parse(req.body ?? {});
        const data = await reviewService.saveBatchOverrides(projectId, generationId, body);
        return reply.send({ success: true, data });
    });

    fastify.delete('/:projectId/:generationId/overrides/:fieldKey', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, generationId, fieldKey } = removeParamsSchema.parse(req.params);
        const decodedFieldKey = decodeURIComponent(fieldKey);
        const data = await reviewService.removeOverride(projectId, generationId, decodedFieldKey);
        return reply.send({ success: true, data });
    });

    fastify.post('/:projectId/:generationId/reprocess', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, generationId } = paramsSchema.parse(req.params);
        const body = ReprocessSectionRequestSchema.parse(req.body ?? {});
        const data = await reprocessService.reprocessSections(projectId, generationId, body.sections, body.reason);
        return reply.send({ success: true, data });
    });

    fastify.post('/:projectId/:generationId/finalize', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, generationId } = paramsSchema.parse(req.params);
        const body = FinalizeReviewRequestSchema.parse(req.body ?? {});
        const data = await reviewService.finalizeReview(projectId, generationId, body.saveAsExample);
        return reply.send({ success: true, data });
    });

    fastify.get('/:projectId/:generationId/download', async (req: FastifyRequest, reply: FastifyReply) => {
        const { generationId } = paramsSchema.parse(req.params);
        const generation = await prisma.rDAGeneration.findUnique({
            where: { id: generationId },
            select: {
                outputFilePath: true,
                status: true,
            },
        });

        if (!generation || generation.status !== 'completed' || !generation.outputFilePath || !fs.existsSync(generation.outputFilePath)) {
            return reply.status(404).send({
                success: false,
                error: 'Arquivo final do RDA nao disponivel.',
            });
        }

        const filename = path.basename(generation.outputFilePath);
        return reply
            .header('Content-Disposition', `attachment; filename="${filename}"`)
            .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            .send(fs.createReadStream(generation.outputFilePath));
    });
}
