import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '@/utils/logger';

export async function errorHandler(
    error: FastifyError,
    request: FastifyRequest,
    reply: FastifyReply
) {
    // Log error
    logger.error('Request error', {
        method: request.method,
        url: request.url,
        error: error.message,
        stack: error.stack,
    });

    // Zod validation errors
    if (error instanceof ZodError) {
        return reply.status(400).send({
            success: false,
            error: 'Validation Error',
            details: error.errors,
        });
    }

    // Prisma errors (Basic check, can be expanded)
    if (error.message?.includes('Prisma')) {
        return reply.status(500).send({
            success: false,
            error: 'Database Error',
            message: 'An error occurred while processing your request',
        });
    }

    // Default error
    return reply.status(error.statusCode || 500).send({
        success: false,
        error: error.name || 'Internal Server Error',
        message: error.message || 'An unexpected error occurred',
    });
}
