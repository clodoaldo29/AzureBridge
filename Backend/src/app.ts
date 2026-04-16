import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { apiRoutes } from '@/routes/api.routes';
import { authRoutes } from '@/routes/auth.routes';
import { rdaRoutes } from '@/routes/rda/rda.routes';
import { templateRoutes } from '@/routes/rda/template.routes';
import { preflightRoutes } from '@/routes/rda/preflight.routes';
import { generationRoutes } from '@/routes/rda/generation.routes';
import { reviewRoutes } from '@/routes/rda/review.routes';
import { errorHandler } from '@/middleware/error-handler';
import { requireAuth } from '@/middleware/auth.middleware';
import { getDatabaseHealthSnapshot } from '@/database/client';
import { logger } from '@/utils/logger';

export function buildApp() {
    const isRdaEnabled = (process.env.FEATURE_RDA_MODULE ?? 'false').toLowerCase() === 'true';
    const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    const app = fastify({
        logger: {
            transport: {
                target: 'pino-pretty',
                options: {
                    translateTime: 'HH:MM:ss Z',
                    ignore: 'pid,hostname'
                }
            }
        }
    });

    // Middlewares
    app.register(helmet);
    app.register(cors, {
        origin: (origin, callback) => {
            // Permite requests sem Origin (health checks, curl, server-to-server)
            if (!origin) {
                callback(null, true);
                return;
            }

            callback(null, allowedOrigins.includes(origin));
        },
        credentials: true,
    });
    app.register(multipart, {
        limits: {
            fileSize: 50 * 1024 * 1024, // 50 MB
        },
    });

    // ----------------------------------------
    // Rotas PÚBLICAS (sem autenticação)
    // ----------------------------------------

    // Health check — consultado pelo ServerCheck.tsx antes do login
    app.get('/api/health', async () => {
        const dbHealth = await getDatabaseHealthSnapshot();
        if (dbHealth.connected === false) {
            logger.warn('Health check em modo degradado: sem conexao com banco.');
        }

        return {
            status: dbHealth.connected === false ? 'degraded' : 'ok',
            database: dbHealth.connected === true
                ? 'connected'
                : (dbHealth.connected === false ? 'disconnected' : 'checking'),
            databaseCheckedAt: dbHealth.checkedAt,
            databaseFresh: !dbHealth.stale,
            timestamp: new Date(),
            version: '2.0.0',
        };
    });

    // Autenticação SSO — troca ID token Microsoft por JWT próprio
    app.register(authRoutes, { prefix: '/api/auth' });

    // ----------------------------------------
    // Rotas PROTEGIDAS (exigem JWT)
    // ----------------------------------------

    app.register(
        async (protectedApp) => {
            protectedApp.addHook('preHandler', requireAuth);
            protectedApp.register(apiRoutes);

            if (isRdaEnabled) {
                protectedApp.register(rdaRoutes, { prefix: '/rda' });
                protectedApp.register(templateRoutes, { prefix: '/rda/templates' });
                protectedApp.register(preflightRoutes, { prefix: '/rda/preflight' });
                protectedApp.register(generationRoutes, { prefix: '/rda/generations' });
                protectedApp.register(reviewRoutes, { prefix: '/rda/review' });
            } else {
                app.log.info('[FeatureFlag] RDA module disabled (FEATURE_RDA_MODULE=false)');
            }
        },
        { prefix: '/api' }
    );

    // Error Handler
    app.setErrorHandler(errorHandler);

    return app;
}
