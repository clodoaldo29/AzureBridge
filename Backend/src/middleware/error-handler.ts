import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '@/utils/logger';

export async function errorHandler(
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply
) {
    const statusCodeRaw = (error as unknown as { statusCode?: number; status?: number }).statusCode
        ?? (error as unknown as { statusCode?: number; status?: number }).status;
    const statusCode = Number.isInteger(statusCodeRaw) ? Number(statusCodeRaw) : 500;

    // Registrar erro
    logger.error('Request error', {
        method: request.method,
        url: request.url,
        error: error.message,
        statusCode,
        stack: error.stack,
    });

    // Erros de validacao Zod
    if (error instanceof ZodError) {
        return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            details: error.errors,
        });
    }

    // Erros do Prisma (verificacao basica, pode ser expandida)
    if (error.message?.includes('Prisma')) {
        return reply.status(500).send({
            success: false,
            error: 'Database Error',
            message: 'An error occurred while processing your request',
        });
    }

    // Erro padrao
    return reply.status(statusCode).send({
        success: false,
        error: error.name || 'Internal Server Error',
        message: error.message || 'An unexpected error occurred',
    });
}
