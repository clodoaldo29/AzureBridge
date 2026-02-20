import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { apiRoutes } from '@/routes/api.routes';
import { rdaRoutes } from '@/routes/rda/rda.routes';
import { templateRoutes } from '@/routes/rda/template.routes';
import { preflightRoutes } from '@/routes/rda/preflight.routes';
import { generationRoutes } from '@/routes/rda/generation.routes';
import { reviewRoutes } from '@/routes/rda/review.routes';
import { errorHandler } from '@/middleware/error-handler';

export function buildApp() {
    const isRdaEnabled = (process.env.FEATURE_RDA_MODULE ?? 'false').toLowerCase() === 'true';

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
    if (isRdaEnabled) {
        app.register(rdaRoutes, { prefix: '/api/rda' });
        app.register(templateRoutes, { prefix: '/api/rda/templates' });
        app.register(preflightRoutes, { prefix: '/api/rda/preflight' });
        app.register(generationRoutes, { prefix: '/api/rda/generations' });
        app.register(reviewRoutes, { prefix: '/api/rda/review' });
    } else {
        app.log.info('[FeatureFlag] RDA module disabled (FEATURE_RDA_MODULE=false)');
    }

    // Error Handler
    app.setErrorHandler(errorHandler);

    return app;
}
