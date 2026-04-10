/**
 * Sync horario incremental.
 *
 * O script:
 * 1. Conecta no Azure DevOps e no banco
 * 2. Executa o pipeline central
 * 3. Exibe um resumo final da execucao
 */

import { PrismaClient } from '@prisma/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';
import { getTripleTimezoneParts } from '../../src/utils/timezone-display';
import { runCorePipeline, CorePipelineResult } from './sync-core';

function cls(): void {
    // Nao limpa a tela para preservar logs em producao.
}

function printHeader(): void {
    const now = getTripleTimezoneParts();
    console.log('');
    console.log('==============================================================');
    console.log('  SYNC HORARIO - AzureBridge Dashboard');
    console.log(`  UTC:       ${now.utc}`);
    console.log(`  Brasilia: ${now.brasilia}`);
    console.log(`  Manaus:   ${now.manaus}`);
    console.log('==============================================================');
}

function printFooter(result: CorePipelineResult, startMs: number): void {
    const durationSec = Math.floor((Date.now() - startMs) / 1000);
    const min = Math.floor(durationSec / 60);
    const sec = durationSec % 60;
    const durationLabel = min > 0 ? `${min}min ${sec}s` : `${sec}s`;
    const status = result.hasErrors ? 'COM AVISOS' : 'CONCLUIDO';

    console.log('');
    console.log('==============================================================');
    console.log(`  STATUS: ${status}`);
    console.log(`  Duracao total: ${durationLabel}`);
    console.log('  Resumo por fase:');

    const p1 = result.phase1;
    if (p1.skipped) {
        console.log('    Fase 1 (Smart Sync): sem mudancas detectadas');
    } else {
        console.log(`    Fase 1 (Smart Sync): ${p1.evaluated} avaliados, ${p1.basicUpdated} atualizados`);
        if (p1.historyRecovered > 0) {
            console.log(`      Historicos recuperados: ${p1.historyRecovered}`);
        }
    }

    const p2 = result.phase2;
    console.log(`    Fase 2 (Reconcile): ${p2.sprintsProcessed} sprint(s), -${p2.markedRemoved}/+${p2.reactivated} itens`);

    const p3 = result.phase3;
    console.log(`    Fase 3 (Burndown): ${p3.sprintsRebuilt} sprint(s), ${p3.snapshotsCreated} snapshots`);

    if (result.hasErrors) {
        const totalErrors = p1.errors + p2.errors + p3.errors;
        console.log(`  Erros encontrados: ${totalErrors}`);
    }

    console.log('==============================================================');
    console.log('');
}

async function main(): Promise<void> {
    const startMs = Date.now();
    cls();
    printHeader();

    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    const azureProject = process.env.AZURE_DEVOPS_PROJECT;

    if (!orgUrl || !pat) {
        console.error('\n  ERRO: AZURE_DEVOPS_ORG_URL e AZURE_DEVOPS_PAT devem estar definidos no .env');
        process.exit(1);
    }

    console.log('\n  Conectando ao Azure DevOps...');

    let witApi: any;
    let prisma: PrismaClient;

    try {
        const authHandler = azdev.getPersonalAccessTokenHandler(pat);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        witApi = await connection.getWorkItemTrackingApi();
        console.log('  Azure DevOps conectado');

        prisma = new PrismaClient();
        await prisma.$connect();
        console.log('  Banco de dados conectado');
    } catch (err: any) {
        console.error(`\n  Falha na conexao: ${err.message}`);
        process.exit(1);
    }

    let result: CorePipelineResult;
    try {
        result = await runCorePipeline({
            prisma,
            witApi,
            orgUrl,
            pat,
            azureProject,
        });
    } catch (err: any) {
        console.error(`\n  Pipeline falhou com erro inesperado: ${err.message}`);
        await prisma.$disconnect();
        process.exit(1);
    }

    await prisma.$disconnect();
    printFooter(result, startMs);

    if (result.hasErrors) {
        process.exit(1);
    }
}

const DB_RETRY_DELAYS_MS = [5000, 15000, 30000];

function isTransientDbError(error: any): boolean {
    const msg = String(error?.message || error || '');
    return (
        msg.includes('PrismaClientInitializationError') ||
        msg.includes("Can't reach database server") ||
        msg.includes('Connection terminated unexpectedly') ||
        msg.includes('Timed out fetching a new connection')
    );
}

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
    for (let attempt = 1; attempt <= DB_RETRY_DELAYS_MS.length + 1; attempt++) {
        try {
            await main();
            break;
        } catch (error: any) {
            const retriable = isTransientDbError(error);
            const hasNext = attempt <= DB_RETRY_DELAYS_MS.length;

            if (!retriable || !hasNext) {
                console.error('\n  Sync horario falhou definitivamente:', error.message);
                process.exit(1);
            }

            const delay = DB_RETRY_DELAYS_MS[attempt - 1];
            console.warn(`\n  Banco indisponivel (tentativa ${attempt}). Retentando em ${Math.floor(delay / 1000)}s...`);
            await sleep(delay);
        }
    }
})();
