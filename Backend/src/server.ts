import { buildApp } from './app';
import 'dotenv/config';

const PORT = process.env.PORT || 3001;

async function startServer() {
    const app = buildApp();

    try {
        await app.listen({ port: Number(PORT), host: '0.0.0.0' });
        console.log(`🚀 AzureBridge API server running on http://localhost:${PORT}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

startServer();
