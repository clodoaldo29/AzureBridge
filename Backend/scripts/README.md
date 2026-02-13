# Scripts

Este diretorio contem os scripts ativos de sincronizacao e manutencao.

## Estrutura atual

- `orchestrators/`: orquestradores e cron.
- `sync/`: sincronizacoes Azure DevOps.
- `backfill/`: recomputacao de historico/snapshots.
- `maintenance/`: operacoes de manutencao e diagnostico.
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

### Orquestracao

- `orchestrators/auto-sync.ts`: orquestrador dos modos `hourly`, `daily` e `bootstrap`.

### Sincronizacao

- `sync/smart-sync.ts`: sincronizacao incremental de work items alterados + hierarquia + historico faltante. Tambem captura `closedDate` via revisoes Azure DevOps para items Done.
- `sync/sync-all-projects.js`: sincroniza projetos e sprints.
- `sync/sync-all-team-members.js`: sincroniza membros dos times por projeto.
- `sync/sync-capacity.js`: sincroniza capacidade por sprint/membro.
- `sync/sync-target-projects.js`: bootstrap seletivo de projetos novos/target.
- `sync/complete-massive-sync.js`: carga completa de work items (uso excepcional).
- `sync/sync-hierarchy.js`: sincronizacao de hierarquia sob demanda.

### Backfill

- `backfill/backfill-burndown.ts`: gera snapshots de burndown por sprint (`new` ou `rebuild`). Calcula contadores de estado (`todoCount`, `inProgressCount`, `doneCount`) com base em `activatedDate` e `closedDate`.
- `backfill/backfill-project-history-batch.ts`: backfill de historico (`initialRemainingWork`, `lastRemainingWork`, `doneRemainingWork`).
- `backfill/backfill-closed-dates.ts`: recupera `closedDate` para work items "Done" via API de revisoes do Azure DevOps. O processo Scrum nao preenche `System.ClosedDate` para items "Done" (so "Closed"), entao usa `witApi.getRevisions(id)` para encontrar a transicao de estado. Env vars opcionais: `BATCH_SIZE` (default 10), `BATCH_DELAY_MS` (default 500), `DRY_RUN` (default false).
- `backfill/rebuild-snapshot-counts.ts`: reconstroi contadores de estado (`todoCount`, `inProgressCount`, `doneCount`) nos SprintSnapshots usando `activatedDate` e `closedDate` dos work items. Modos: `REBUILD_MODE=empty` (default, so atualiza contadores zerados) ou `REBUILD_MODE=all`. Filtro opcional: `TARGET_SPRINTS=id1,id2`. Suporta `DRY_RUN`.
- `backfill/rebuild-current-sprints.ts`: recalcula contadores de estado nos snapshots de sprints ativas especificas. Util para corrigir sprints correntes apos backfill de closedDate.

### Snapshot

- `maintenance/run-snapshot.ts`: executa snapshot operacional diario. Inclui `blockedCount` corretamente (usa `isBlocked` no select do Prisma).

## Scripts manuais de suporte

### Diagnostico e validacao

- `maintenance/check-db-state.ts`: exibe visao completa do banco — todas as sprints com projeto, estado, datas, contagem de WIs e snapshots. Mostra totais e sprints sem work items.
- `maintenance/check-date-fields.ts`: verifica preenchimento de campos de data nos work items (`activatedDate`, `closedDate`, `resolvedDate`, `stateChangeDate`). Mostra distribuicao de estados e amostra de items Done.
- `maintenance/validate-snapshot-counts.ts`: valida contadores dos snapshots contra a contagem real de work items da sprint. Marca com `!!!` snapshots cujo total (todo+inProgress+done) diverge do numero real de WIs.
- `maintenance/get-current-sprints.ts`: lista sprints nao-Past (Active/Future) com ID, projeto e nome. Util para obter IDs para outros scripts.

### Correcao

- `maintenance/fix-snapshot-counts.ts`: corrige snapshots com contadores zerados (`todoCount=inProgressCount=doneCount=0`) mas com `totalWork > 0`. Preenche snapshots anteriores ao primeiro valido com `todoCount = total items`.
- `maintenance/reset-db.ts`: reset de banco para ambiente de desenvolvimento.

### Legados

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

# Recuperar closedDate para items Done (via revisoes Azure)
npx tsx scripts/backfill/backfill-closed-dates.ts

# Reconstruir contadores nos snapshots (modo empty — so zerados)
npx tsx scripts/backfill/rebuild-snapshot-counts.ts

# Reconstruir contadores (todos os snapshots)
REBUILD_MODE=all npx tsx scripts/backfill/rebuild-snapshot-counts.ts

# Verificar estado do banco
npx tsx scripts/maintenance/check-db-state.ts

# Verificar campos de data nos work items
npx tsx scripts/maintenance/check-date-fields.ts

# Validar contadores dos snapshots
npx tsx scripts/maintenance/validate-snapshot-counts.ts

# Corrigir snapshots com contadores zerados
npx tsx scripts/maintenance/fix-snapshot-counts.ts

# Listar sprints ativas/futuras
npx tsx scripts/maintenance/get-current-sprints.ts

# Executar snapshot manualmente
npx tsx scripts/maintenance/run-snapshot.ts
```
