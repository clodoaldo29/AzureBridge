# Scripts

Este diretorio contem os scripts ativos de sincronizacao e manutencao.

## Estrutura atual

- `orchestrators/`: orquestradores e cron.
- `sync/`: sincronizacoes Azure DevOps.
- `backfill/`: recomputacao de historico/snapshots.
- `maintenance/`: operacoes de manutencao.
- `diagnostics/`: scripts de diagnostico pontual.

## Compatibilidade

Os caminhos antigos na raiz de `scripts/` foram mantidos como wrappers.
Isso evita quebrar agendamentos e comandos existentes.

Exemplos:

- `scripts/auto-sync.ts` -> `scripts/orchestrators/auto-sync.ts`
- `scripts/backfill-burndown.ts` -> `scripts/backfill/backfill-burndown.ts`
- `scripts/run-snapshot.ts` -> `scripts/maintenance/run-snapshot.ts`

## Fluxo automatico (Docker scheduler)

O container `auto-sync` executa `scripts/auto-sync.ts` via cron:

- `AUTO_SYNC_MODE=hourly`: roda apenas `scripts/sync/smart-sync.ts`
- `AUTO_SYNC_MODE=daily`: roda o fluxo diario completo
- `AUTO_SYNC_MODE=bootstrap`: roda carga completa inicial

Arquivo de cron:

- `scripts/auto-sync-cron.sh` (wrapper)
- `scripts/orchestrators/auto-sync-cron.sh` (implementacao)

## Scripts principais

- `orchestrators/auto-sync.ts`: orquestrador dos modos `hourly`, `daily` e `bootstrap`.
- `sync/smart-sync.ts`: sincronizacao incremental de work items alterados + hierarquia + historico faltante.
- `sync/sync-all-projects.js`: sincroniza projetos e sprints.
- `sync/sync-all-team-members.js`: sincroniza membros dos times por projeto.
- `sync/sync-capacity.js`: sincroniza capacidade por sprint/membro.
- `backfill/backfill-project-history-batch.ts`: backfill de historico (`initialRemainingWork`, `lastRemainingWork`, `doneRemainingWork`).
- `backfill/backfill-burndown.ts`: gera snapshots de burndown por sprint (`new` ou `rebuild`).
- `maintenance/run-snapshot.ts`: executa snapshot operacional diario.
- `sync/sync-target-projects.js`: bootstrap seletivo de projetos novos/target.
- `sync/complete-massive-sync.js`: carga completa de work items (uso excepcional).
- `sync/sync-hierarchy.js`: sincronizacao de hierarquia sob demanda.

## Scripts manuais de suporte

- `maintenance/reset-db.ts`: reset de banco para ambiente de desenvolvimento.
- `diagnostics/create-baseline-snapshot.ts`: cria baseline para cenarios especificos de historico.
- `backfill/backfill-project-history.ts`: versao legada de backfill (preferir `backfill-project-history-batch.ts`).

## Comandos uteis

```bash
# Rodar fluxo diario manualmente
npx tsx scripts/auto-sync.ts

# Rodar fluxo hourly manualmente
AUTO_SYNC_MODE=hourly npx tsx scripts/auto-sync.ts

# Rodar bootstrap manualmente
AUTO_SYNC_MODE=bootstrap npx tsx scripts/auto-sync.ts
```
