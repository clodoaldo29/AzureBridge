import { FastifyInstance } from 'fastify';
import { authController } from '@/controllers/auth.controller';

export async function authRoutes(fastify: FastifyInstance) {
    // POST /api/auth/microsoft
    // Troca o ID token Microsoft por um JWT da aplicação
    fastify.post('/microsoft', authController.exchangeToken);
}
