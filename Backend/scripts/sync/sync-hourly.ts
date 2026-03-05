/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║               SYNC HORÁRIO — AzureBridge                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Execução: a cada hora (ex: via cron, Docker, ou BullMQ)
 * Comando:  npx tsx scripts/sync-hourly.ts
 *
 * O que este script faz:
 *
 *   1. Conecta ao Azure DevOps e ao banco de dados
 *   2. Executa o pipeline central (sync-core.ts) que contém:
 *      ├─ FASE 1: Smart Sync — atualiza work items alterados recentemente
 *      ├─ FASE 2: Reconcile — corrige remoções, reativações e reatribuições
 *      └─ FASE 3: Rebuild Burndown — reconstrói os gráficos das sprints ativas
 *   3. Exibe resumo final com tempo de execução e estatísticas
 *
 * Este script é leve e incremental: só processa o que mudou desde
 * a última execução. Ideal para rodar com frequência (15min a 1h).
 *
 * Para sincronização estrutural completa (projetos, times, capacidade),
 * use o script diário: npx tsx scripts/sync-daily.ts
 */

import { PrismaClient } from '@prisma/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';
import { runCorePipeline, CorePipelineResult } from './sync-core';

// ─── Utilitários de display ────────────────────────────────────────────────────

function cls(): void {
    // Não limpa tela para não apagar logs anteriores em produção
}

function printHeader(): void {
    const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║        🔄  SYNC HORÁRIO — AzureBridge Dashboard             ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  📅  Início: ${now.padEnd(48)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
}

function printFooter(result: CorePipelineResult, startMs: number): void {
    const durationSec = Math.floor((Date.now() - startMs) / 1000);
    const min = Math.floor(durationSec / 60);
    const sec = durationSec % 60;
    const durationLabel = min > 0 ? `${min}min ${sec}s` : `${sec}s`;
    const status = result.hasErrors ? '⚠️  COM AVISOS' : '✅  CONCLUÍDO';

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log(`║  ${status.padEnd(60)}║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  ⏱  Duração total: ${durationLabel.padEnd(43)}║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log('║  📊  Resumo por fase:                                        ║');

    // Fase 1
    const p1 = result.phase1;
    if (p1.skipped) {
        console.log('║    Fase 1 (Smart Sync)   — Sem mudanças detectadas           ║');
    } else {
        console.log(`║    Fase 1 (Smart Sync)   — ${p1.evaluated} avaliados, ${p1.basicUpdated} atualizados`.padEnd(65) + '║');
        if (p1.historyRecovered > 0) {
            console.log(`║                            ${p1.historyRecovered} históricos recuperados`.padEnd(65) + '║');
        }
    }

    // Fase 2
    const p2 = result.phase2;
    const reconcileSummary = `${p2.sprintsProcessed} sprint(s), -${p2.markedRemoved}/+${p2.reactivated} itens`;
    console.log(`║    Fase 2 (Reconcile)     — ${reconcileSummary}`.padEnd(65) + '║');

    // Fase 3
    const p3 = result.phase3;
    const burndownSummary = `${p3.sprintsRebuilt} sprint(s), ${p3.snapshotsCreated} snapshots`;
    console.log(`║    Fase 3 (Burndown)      — ${burndownSummary}`.padEnd(65) + '║');

    if (result.hasErrors) {
        const totalErrors = p1.errors + p2.errors + p3.errors;
        console.log('╠══════════════════════════════════════════════════════════════╣');
        console.log(`║  ⚠️   ${totalErrors} erro(s) encontrado(s) — verifique os logs acima`.padEnd(65) + '║');
    }

    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
}

// ─── Função principal ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const startMs = Date.now();
    printHeader();

    // Valida credenciais antes de qualquer coisa
    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    const azureProject = process.env.AZURE_DEVOPS_PROJECT;

    if (!orgUrl || !pat) {
        console.error('\n  ❌  ERRO: AZURE_DEVOPS_ORG_URL e AZURE_DEVOPS_PAT devem estar definidos no .env');
        process.exit(1);
    }

    console.log('\n  🔌  Conectando ao Azure DevOps...');

    let witApi: any;
    let prisma: PrismaClient;

    try {
        // Conexão Azure
        const authHandler = azdev.getPersonalAccessTokenHandler(pat);
        const connection = new azdev.WebApi(orgUrl, authHandler);
        witApi = await connection.getWorkItemTrackingApi();
        console.log('  ✅  Azure DevOps conectado');

        // Conexão banco de dados
        prisma = new PrismaClient();
        await prisma.$connect();
        console.log('  ✅  Banco de dados conectado');

    } catch (err: any) {
        console.error(`\n  ❌  Falha na conexão: ${err.message}`);
        process.exit(1);
    }

    // Executa o pipeline central
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
        console.error(`\n  ❌  Pipeline falhou com erro inesperado: ${err.message}`);
        await prisma.$disconnect();
        process.exit(1);
    }

    // Desconecta e exibe resumo
    await prisma.$disconnect();
    printFooter(result, startMs);

    // Sai com código de erro se houve problemas (útil para monitoramento)
    if (result.hasErrors) {
        process.exit(1);
    }
}

// Retry em caso de erro transitório de banco de dados
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
                console.error('\n  ❌  Sync horário falhou definitivamente:', error.message);
                process.exit(1);
            }

            const delay = DB_RETRY_DELAYS_MS[attempt - 1];
            console.warn(`\n  ⚠️  Banco indisponível (tentativa ${attempt}). Retentando em ${Math.floor(delay / 1000)}s...`);
            await sleep(delay);
        }
    }
})();
