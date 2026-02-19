import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { apiRoutes } from '@/routes/api.routes';
import { rdaRoutes } from '@/routes/rda/rda.routes';
import { templateRoutes } from '@/routes/rda/template.routes';
import { preflightRoutes } from '@/routes/rda/preflight.routes';
import { errorHandler } from '@/middleware/error-handler';

export function buildApp() {
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
    app.register(helmet); // Security headers
    app.register(cors, {
        origin: true // Allow all for dev
    });
    app.register(multipart, {
        limits: {
            fileSize: 50 * 1024 * 1024, // 50 MB
        },
    });

    // Routes
    app.register(apiRoutes, { prefix: '/api' });
    app.register(rdaRoutes, { prefix: '/api/rda' });
    app.register(templateRoutes, { prefix: '/api/rda/templates' });
    app.register(preflightRoutes, { prefix: '/api/rda/preflight' });

    // Error Handler
    app.setErrorHandler(errorHandler);

    return app;
}
