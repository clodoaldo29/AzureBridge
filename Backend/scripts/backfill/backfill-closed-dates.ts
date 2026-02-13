/**
 * backfill-closed-dates.ts
 *
 * Recupera closedDate para work items em estado "Done" via API de revisoes do Azure DevOps.
 * O processo Scrum nao preenche System.ClosedDate para items "Done" (so para "Closed"),
 * entao usamos o historico de revisoes para encontrar a data exata da transicao.
 *
 * Uso: npx tsx scripts/backfill/backfill-closed-dates.ts
 *
 * Variaveis de ambiente opcionais:
 *   BATCH_SIZE       - items por lote (default: 10)
 *   BATCH_DELAY_MS   - delay entre lotes em ms (default: 500)
 *   DRY_RUN          - se "true", nao grava no banco (default: false)
 */
import { PrismaClient } from '@prisma/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';

const prisma = new PrismaClient();

const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '10', 10);
const BATCH_DELAY_MS = parseInt(process.env.BATCH_DELAY_MS || '500', 10);
const DRY_RUN = process.env.DRY_RUN === 'true';

const DONE_STATES = new Set(['done', 'closed', 'completed']);

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log('BACKFILL CLOSED DATES VIA REVISOES');
    console.log('='.repeat(60));
    if (DRY_RUN) console.log('*** DRY RUN - nenhuma alteracao sera gravada ***\n');

    // 1. Setup Azure DevOps connection
    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;

    if (!orgUrl || !pat) {
        throw new Error('Missing AZURE_DEVOPS_ORG_URL or AZURE_DEVOPS_PAT');
    }

    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const witApi = await connection.getWorkItemTrackingApi();

    // 2. Find work items in Done state with closedDate null
    const items = await prisma.workItem.findMany({
        where: {
            state: { in: ['Done', 'Closed', 'Completed'] },
            closedDate: null,
            isRemoved: false,
        },
        select: {
            id: true,
            state: true,
            activatedDate: true,
            changedDate: true,
        },
        orderBy: { id: 'asc' },
    });

    console.log(`Encontrados: ${items.length} work items Done sem closedDate`);
    console.log(`Batch size: ${BATCH_SIZE} | Delay: ${BATCH_DELAY_MS}ms\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(items.length / BATCH_SIZE);

        process.stdout.write(`Lote ${batchNum}/${totalBatches} (IDs ${batch[0].id}-${batch[batch.length - 1].id})...`);

        for (const item of batch) {
            try {
                const closedDate = await findDoneDate(item.id, witApi);

                if (closedDate) {
                    if (!DRY_RUN) {
                        await prisma.workItem.update({
                            where: { id: item.id },
                            data: { closedDate },
                        });
                    }
                    updated++;
                } else {
                    // Fallback: use changedDate as approximation
                    if (!DRY_RUN && item.changedDate) {
                        await prisma.workItem.update({
                            where: { id: item.id },
                            data: { closedDate: item.changedDate },
                        });
                    }
                    skipped++;
                }
            } catch (err: any) {
                errors++;
                console.error(`\n  Erro #${item.id}: ${err.message}`);
            }
        }

        console.log(` OK (${updated} atualizados, ${skipped} fallback, ${errors} erros)`);

        if (i + BATCH_SIZE < items.length) {
            await sleep(BATCH_DELAY_MS);
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`RESULTADO:`);
    console.log(`  Revisoes encontradas:  ${updated}`);
    console.log(`  Fallback changedDate:  ${skipped}`);
    console.log(`  Erros:                 ${errors}`);
    console.log(`  Total processado:      ${items.length}`);
    console.log('='.repeat(60));

    await prisma.$disconnect();
}

/**
 * Busca revisoes do work item no Azure DevOps e encontra a data
 * em que o estado mudou para Done/Closed/Completed.
 */
async function findDoneDate(
    workItemId: number,
    witApi: any,
): Promise<Date | null> {
    const revisions = await witApi.getRevisions(workItemId);

    let previousState = '';

    for (const rev of revisions) {
        const state = (rev.fields?.['System.State'] || '').toString().toLowerCase();
        const changedDate = rev.fields?.['System.ChangedDate'];

        if (DONE_STATES.has(state) && !DONE_STATES.has(previousState)) {
            // Transicao para Done encontrada
            if (changedDate) {
                return new Date(changedDate);
            }
        }

        previousState = state;
    }

    return null;
}

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});
