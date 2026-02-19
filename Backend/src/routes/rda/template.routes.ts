import fs from 'fs';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { rdaTemplateService } from '@/services/rda/rda-template.service';

const idParamsSchema = z.object({
    id: z.string().min(1),
});

export async function templateRoutes(fastify: FastifyInstance) {
    fastify.post('/upload', async (_req: FastifyRequest, reply: FastifyReply) => {
        return reply.status(403).send({
            success: false,
            error: 'Gestao manual de templates desativada. O sistema usa template oficial global.',
        });
    });

    fastify.get('/', async (_req: FastifyRequest, reply: FastifyReply) => {
        const templates = await rdaTemplateService.getTemplates();
        return reply.send({ success: true, data: templates });
    });

    fastify.get('/:id', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = idParamsSchema.parse(req.params);
        const template = await rdaTemplateService.getTemplateById(id);
        return reply.send({ success: true, data: template });
    });

    fastify.get('/:id/download', async (req: FastifyRequest, reply: FastifyReply) => {
        const { id } = idParamsSchema.parse(req.params);
        const template = await rdaTemplateService.getTemplateById(id);

        if (!fs.existsSync(template.filePath)) {
            return reply.status(404).send({ success: false, error: 'Arquivo do template nao encontrado.' });
        }

        const file = fs.readFileSync(template.filePath);
        reply
            .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
            .header('Content-Disposition', `attachment; filename="template-${template.id}.docx"`);

        return reply.send(file);
    });

    fastify.put('/:id/activate', async (_req: FastifyRequest, reply: FastifyReply) => {
        return reply.status(403).send({
            success: false,
            error: 'Ativacao manual desativada. O sistema usa template oficial global.',
        });
    });

    fastify.delete('/:id', async (_req: FastifyRequest, reply: FastifyReply) => {
        return reply.status(403).send({
            success: false,
            error: 'Remocao manual desativada. O sistema usa template oficial global.',
        });
    });
}
