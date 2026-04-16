import { buildApp } from './app';
import 'dotenv/config';

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '::';

async function startServer() {
    const app = buildApp();

    try {
        await app.listen({ port: Number(PORT), host: HOST });
        console.log(`🚀 AzureBridge API server running on http://localhost:${PORT}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

startServer();
