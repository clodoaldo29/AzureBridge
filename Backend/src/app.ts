import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { apiRoutes } from '@/routes/api.routes';

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

    // Routes
    app.register(apiRoutes, { prefix: '/api' });

    return app;
}
