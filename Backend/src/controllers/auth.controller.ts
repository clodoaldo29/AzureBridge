import { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { verifyMicrosoftToken, upsertUser, issueAppToken } from '@/services/auth.service';

const exchangeBodySchema = z.object({
    idToken: z.string().min(1, 'idToken é obrigatório'),
});

export const authController = {
    async exchangeToken(request: FastifyRequest, reply: FastifyReply) {
        const parsed = exchangeBodySchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.status(400).send({
                success: false,
                error: 'Body inválido',
                details: parsed.error.flatten().fieldErrors,
            });
        }

        const { idToken } = parsed.data;

        try {
            const claims = await verifyMicrosoftToken(idToken);
            const user = await upsertUser(claims);
            const token = issueAppToken(user);

            return reply.status(200).send({
                success: true,
                data: {
                    token,
                    user: {
                        id: user.id,
                        email: user.email,
                        displayName: user.displayName,
                    },
                },
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Erro ao autenticar';
            request.log.warn({ err }, 'Falha na troca de token Microsoft');
            return reply.status(401).send({
                success: false,
                error: message,
            });
        }
    },
};
