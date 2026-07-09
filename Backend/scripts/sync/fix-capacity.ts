import { PrismaClient } from '@prisma/client';
import * as azdev from 'azure-devops-node-api';
import 'dotenv/config';
import { reconcileHistoricalCapacities } from './capacity-reconcile';

function parseBoolean(value: string | undefined): boolean {
    return ['true', '1', 'yes', 'sim'].includes(String(value || '').trim().toLowerCase());
}

async function main(): Promise<void> {
    const orgUrl = process.env.AZURE_DEVOPS_ORG_URL;
    const pat = process.env.AZURE_DEVOPS_PAT;
    const dryRun = parseBoolean(process.env.DRY_RUN);
    const projectFilters = (process.env.CAPACITY_FIX_PROJECT_FILTERS || 'Retrabalho,Plataforma de Melhoria,Tempos e Movimentos')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const sprintNameContains = process.env.CAPACITY_FIX_SPRINT_FILTER?.trim() || undefined;
    const limit = process.env.CAPACITY_FIX_LIMIT ? Number(process.env.CAPACITY_FIX_LIMIT) : undefined;

    if (!orgUrl || !pat) {
        throw new Error('AZURE_DEVOPS_ORG_URL e AZURE_DEVOPS_PAT sao obrigatorios.');
    }

    console.log('');
    console.log('FIX CAPACITY - reconcile historico');
    console.log('='.repeat(72));
    console.log(`Modo: ${dryRun ? 'DRY_RUN (sem gravar)' : 'APLICANDO NO BANCO'}`);
    console.log(`Projetos: ${projectFilters.join(', ') || 'todos'}`);
    console.log(`Sprint filtro: ${sprintNameContains || 'nenhum'}`);
    console.log(`Limit: ${limit || 'nenhum'}`);

    const authHandler = azdev.getPersonalAccessTokenHandler(pat);
    const connection = new azdev.WebApi(orgUrl, authHandler);
    const [coreApi, workApi] = await Promise.all([
        connection.getCoreApi(),
        connection.getWorkApi(),
    ]);

    const prisma = new PrismaClient();
    try {
        const results = await reconcileHistoricalCapacities({
            prisma,
            coreApi,
            workApi,
            orgUrl,
            pat,
            dryRun,
            projectNameContains: projectFilters,
            sprintNameContains,
            limit: Number.isFinite(limit) ? limit : undefined,
        });

        let changed = 0;
        let skipped = 0;
        let added = 0;
        let updated = 0;
        let removed = 0;

        for (const result of results) {
            if (result.skipped) {
                skipped++;
                console.log(`[SKIP] ${result.projectName} / ${result.sprintName}: ${result.reason || 'ignorada'}`);
                continue;
            }

            if (result.changed) changed++;
            added += result.addedRows;
            updated += result.updatedRows;
            removed += result.removedRows;

            const status = result.changed ? 'CHANGE' : 'OK';
            console.log(
                `[${status}] ${result.projectName} / ${result.sprintName} | ` +
                `local=${result.localRows}/${result.localAvailableHours}h | ` +
                `final=${result.finalRows}/${result.finalAvailableHours}h | ` +
                `agg=${result.aggregateExpectedHours ?? 'n/a'}h | ` +
                `visible=${result.visibleRows} hidden=${result.recoveredHiddenRows} | ` +
                `+${result.addedRows} ~${result.updatedRows} -${result.removedRows}`
            );
        }

        console.log('='.repeat(72));
        console.log(`Sprints avaliadas: ${results.length}`);
        console.log(`Sprints alteradas: ${changed}`);
        console.log(`Sprints ignoradas: ${skipped}`);
        console.log(`Linhas: +${added} ~${updated} -${removed}`);
        if (dryRun) {
            console.log('DRY_RUN ativo: nenhuma alteracao foi gravada.');
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error('Falha no fix-capacity:', error?.message || error);
    process.exit(1);
});
