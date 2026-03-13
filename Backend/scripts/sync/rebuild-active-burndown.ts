import { PrismaClient } from '@prisma/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';
import { rebuildActiveSprintBurndownOnly } from './sync-core';

function printHeader(): void {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║   REBUILD BURNDOWN - Sprints Ativas                        ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Inicio: ${now.padEnd(51)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
}

function printFooter(durationMs: number, sprintsRebuilt: number, snapshotsCreated: number, outcomesCreated: number): void {
    const durationSec = Math.floor(durationMs / 1000);
    const min = Math.floor(durationSec / 60);
    const sec = durationSec % 60;
    const durationLabel = min > 0 ? `${min}min ${sec}s` : `${sec}s`;

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  REBUILD CONCLUIDO                                         ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Duracao total: ${durationLabel.padEnd(43)}║`);
    console.log(`║  Sprints reconstruidas: ${String(sprintsRebuilt).padEnd(34)}║`);
    console.log(`║  Snapshots gerados: ${String(snapshotsCreated).padEnd(38)}║`);
    console.log(`║  Outcomes gerados: ${String(outcomesCreated).padEnd(39)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
}

async function main(): Promise<void> {
    const startMs = Date.now();
    printHeader();

    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;

    if (!orgUrl || !pat) {
        console.error('\n  ERRO: AZURE_DEVOPS_ORG_URL e AZURE_DEVOPS_PAT devem estar definidos no .env');
        process.exit(1);
    }

    console.log('\n  Conectando ao Azure DevOps...');

    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const witApi = await connection.getWorkItemTrackingApi();
    console.log('  Azure DevOps conectado');

    const prisma = new PrismaClient();
    await prisma.$connect();
    console.log('  Banco de dados conectado');

    try {
        const result = await rebuildActiveSprintBurndownOnly({ prisma, witApi });
        printFooter(Date.now() - startMs, result.sprintsRebuilt, result.snapshotsCreated, result.outcomesCreated);
        if (result.errors > 0) {
            process.exit(1);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: any) => {
    console.error(`\n  Rebuild falhou: ${error?.message || error}`);
    process.exit(1);
});
