import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '@/database/client';
import { MonthPeriodSchema, PeriodKeySchema } from '@/modules/rda/schemas/monthly.schema';
import { PreflightConfigSchema } from '@/modules/rda/schemas/preflight.schema';
import { preflightService } from '@/modules/rda/services/preflight.service';

const projectParamsSchema = z.object({
    projectId: z.string().min(1),
});

const readinessParamsSchema = z.object({
    projectId: z.string().min(1),
    period: PeriodKeySchema,
});

function validateEnv(): string[] {
    const missing: string[] = [];
    if (!process.env.AZURE_DEVOPS_ORG_URL) missing.push('AZURE_DEVOPS_ORG_URL');
    if (!process.env.AZURE_DEVOPS_PAT) missing.push('AZURE_DEVOPS_PAT');
    return missing;
}

async function ensureProjectExists(projectId: string): Promise<boolean> {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    return Boolean(project?.id);
}

export async function preflightRoutes(fastify: FastifyInstance) {
    fastify.post('/run', async (req: FastifyRequest, reply: FastifyReply) => {
        const body = PreflightConfigSchema.parse(req.body ?? {});

        const missingEnv = validateEnv();
        if (missingEnv.length > 0) {
            return reply.status(400).send({
                success: false,
                error: `Variaveis obrigatorias ausentes: ${missingEnv.join(', ')}`,
            });
        }

        if (!(await ensureProjectExists(body.projectId))) {
            return reply.status(404).send({
                success: false,
                error: `Projeto nao encontrado: ${body.projectId}`,
            });
        }

        const result = await preflightService.run(body);
        return reply.send({ success: true, data: result });
    });

    fastify.post('/dry-run', async (req: FastifyRequest, reply: FastifyReply) => {
        const body = z.object({
            projectId: z.string().min(1),
            period: MonthPeriodSchema,
        }).parse(req.body ?? {});

        const missingEnv = validateEnv();
        if (missingEnv.length > 0) {
            return reply.status(400).send({
                success: false,
                error: `Variaveis obrigatorias ausentes: ${missingEnv.join(', ')}`,
            });
        }

        if (!(await ensureProjectExists(body.projectId))) {
            return reply.status(404).send({
                success: false,
                error: `Projeto nao encontrado: ${body.projectId}`,
            });
        }

        const result = await preflightService.run({
            ...body,
            options: {
                skipWikiCheck: false,
                allowPartialData: false,
                dryRun: true,
            },
        });

        return reply.send({ success: true, data: result });
    });

    fastify.get('/template-info/:projectId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = projectParamsSchema.parse(req.params);

        if (!(await ensureProjectExists(projectId))) {
            return reply.status(404).send({
                success: false,
                error: `Projeto nao encontrado: ${projectId}`,
            });
        }

        try {
            const result = await preflightService.getTemplateInfo(projectId);
            return reply.send({ success: true, data: result });
        } catch (error) {
            // Fallback para manter preview funcional mesmo em cenarios de divergencia de leitura detalhada.
            const activeTemplate = await prisma.rDATemplate.findFirst({
                where: { isActive: true },
                orderBy: { updatedAt: 'desc' },
                select: {
                    id: true,
                    name: true,
                    filePath: true,
                    placeholders: true,
                },
            });

            if (!activeTemplate) {
                return reply.status(404).send({
                    success: false,
                    error: error instanceof Error ? error.message : String(error),
                });
            }

            const normalizedPlaceholders = activeTemplate.placeholders.map((value) => ({
                name: String(value).replace(/[{}#/]/g, '').replace(/\//g, '').trim(),
                type: 'simple' as const,
                required: false,
                section: 'template',
            }));

            return reply.send({
                success: true,
                data: {
                    template: {
                        id: activeTemplate.id,
                        name: activeTemplate.name,
                        filePath: activeTemplate.filePath,
                        placeholders: activeTemplate.placeholders,
                    },
                    placeholders: normalizedPlaceholders,
                },
            });
        }
    });

    fastify.get('/readiness/:projectId/:period', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId, period } = readinessParamsSchema.parse(req.params);

        if (!(await ensureProjectExists(projectId))) {
            return reply.status(404).send({
                success: false,
                error: `Projeto nao encontrado: ${projectId}`,
            });
        }

        const result = await preflightService.getReadiness(projectId, period);
        return reply.send({ success: true, data: result });
    });

    fastify.get('/filling-guide/:projectId', async (req: FastifyRequest, reply: FastifyReply) => {
        const { projectId } = projectParamsSchema.parse(req.params);

        if (!(await ensureProjectExists(projectId))) {
            return reply.status(404).send({
                success: false,
                error: `Projeto nao encontrado: ${projectId}`,
            });
        }

        try {
            const result = preflightService.getFillingGuide(projectId);
            return reply.send({ success: true, data: result });
        } catch (error) {
            return reply.status(404).send({
                success: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    });
}
