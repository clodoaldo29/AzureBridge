import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { AppTokenPayload } from '@/services/auth.service';

// Augmentation de tipo para disponibilizar request.user em toda a aplicação
declare module 'fastify' {
    interface FastifyRequest {
        user: AppTokenPayload;
    }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({
            success: false,
            error: 'Token de autenticação ausente',
        });
    }

    const token = authHeader.slice(7); // Remove "Bearer "
    const secret = process.env.JWT_SECRET;

    if (!secret) {
        request.log.error('JWT_SECRET não configurado');
        return reply.status(500).send({
            success: false,
            error: 'Erro de configuração do servidor',
        });
    }

    try {
        const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as AppTokenPayload;
        request.user = payload;
    } catch (err) {
        return reply.status(401).send({
            success: false,
            error: 'Token inválido ou expirado',
        });
    }
}
