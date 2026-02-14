# Scripts

Este diretorio contem os scripts ativos de sincronizacao e manutencao.

## Estrutura atual

- `orchestrators/`: orquestradores e cron.
- `sync/`: sincronizacoes Azure DevOps.
- `backfill/`: recomputacao de historico/snapshots.
- `maintenance/`: manutencao essencial.

## Wrappers de compatibilidade

- `scripts/auto-sync.ts` -> `scripts/orchestrators/auto-sync.ts`
- `scripts/run-snapshot.ts` -> `scripts/maintenance/run-snapshot.ts`

## Modos do pipeline

O container `auto-sync` executa `scripts/auto-sync.ts` via cron:

- `AUTO_SYNC_MODE=hourly`: somente sync incremental.
- `AUTO_SYNC_MODE=daily`: sync incremental + capacidade + snapshots/rebuild.
- `AUTO_SYNC_MODE=full` (ou `bootstrap`): carga completa + historico + rebuild.
- `AUTO_SYNC_STEP_RETRIES`: tentativas por etapa (padrao: `3`).

Arquivos de cron:

- `scripts/auto-sync-cron.sh` (wrapper)
- `scripts/orchestrators/auto-sync-cron.sh` (implementacao)

### Etapas por modo

**hourly:** smart-sync → run-snapshot → rebuild-active-burndown-event-model

**daily:** sync-all-projects → sync-all-team-members → sync-target-projects (novos) → smart-sync → backfill-project-history-batch → backfill-closed-dates → sync-capacity → run-snapshot → rebuild-active-burndown-event-model → validate-snapshot-counts

**full/bootstrap:** tudo do daily + complete-massive-sync + rebuilds completos

## Scripts principais

### Orquestracao

- `orchestrators/auto-sync.ts`: orquestrador principal. Le `AUTO_SYNC_MODE` e executa as etapas sequencialmente com retry (exponential backoff). Loga timing e status de cada etapa.
- `hourly-sync.ts`: wrapper que seta `AUTO_SYNC_MODE=hourly` e chama o orquestrador.
- `daily-sync.ts`: wrapper que seta `AUTO_SYNC_MODE=daily` e chama o orquestrador.
- `full-sync.ts`: wrapper que seta `AUTO_SYNC_MODE=full` e chama o orquestrador.

### Sync Azure DevOps

- `sync/smart-sync.ts`: sincronizacao incremental. Busca work items alterados desde o ultimo sync via WIQL (`changedDate`), atualiza hierarquia, captura `closedDate` via revisoes para items Done.
- `sync/sync-all-projects.js`: sincroniza projetos e sprints do Azure DevOps.
- `sync/sync-all-team-members.js`: sincroniza membros dos times por projeto.
- `sync/sync-capacity.js`: sincroniza capacidade (horas disponiveis, dias off) por sprint/membro.
- `sync/sync-target-projects.js`: bootstrap seletivo de projetos novos ou target.
- `sync/complete-massive-sync.js`: carga completa de todos os work items (uso excepcional, bootstrap).
- `sync/sync-hierarchy.js`: sincronizacao de hierarquia parent/child sob demanda.

### Backfill/Rebuild

- `backfill/backfill-project-history-batch.ts`: backfill de campos historicos (`initialRemainingWork`, `lastRemainingWork`, `doneRemainingWork`) usando revisoes Azure DevOps.
- `backfill/backfill-closed-dates.ts`: recupera `closedDate` para work items "Done" via API de revisoes. O processo Scrum nao preenche `System.ClosedDate` para items "Done" (so "Closed"), entao usa `witApi.getRevisions(id)` para encontrar a transicao de estado.
- `backfill/rebuild-snapshot-counts.ts`: reconstroi contadores de estado (`todoCount`, `inProgressCount`, `doneCount`) nos snapshots usando `activatedDate` e `closedDate`. Modos: `REBUILD_MODE=empty` (default) ou `all`.
- `backfill/rebuild-active-burndown-event-model.ts`: reconstroi burndown de sprints ativas usando modelo baseado em eventos. Processa revisoes de work items para rastrear mudancas de estado e `remainingWork` dia a dia. Calcula baseline D0, delta de escopo, linha ideal piecewise e contadores de estado. Tipos contabilizados: Task, Bug, Test Case.

### Maintenance

- `maintenance/run-snapshot.ts`: captura snapshot operacional para sprints ativas (`remainingWork`, `completedWork`, `totalWork`, contadores de estado incluindo `blockedCount`).
- `maintenance/validate-snapshot-counts.ts`: valida contadores dos snapshots contra a contagem real de work items. Marca divergencias.
- `maintenance/reset-db.ts`: reset completo do banco (apenas desenvolvimento).

## Comandos uteis

```bash
# Pipeline por modo
npx tsx scripts/hourly-sync.ts
npx tsx scripts/daily-sync.ts
npx tsx scripts/full-sync.ts

# Pipeline via orquestrador
AUTO_SYNC_MODE=hourly npx tsx scripts/auto-sync.ts
AUTO_SYNC_MODE=daily npx tsx scripts/auto-sync.ts
AUTO_SYNC_MODE=full npx tsx scripts/auto-sync.ts

# Backfill/Rebuild
npx tsx scripts/backfill/backfill-project-history-batch.ts
npx tsx scripts/backfill/backfill-closed-dates.ts
npx tsx scripts/backfill/rebuild-snapshot-counts.ts
npx tsx scripts/backfill/rebuild-active-burndown-event-model.ts

# Maintenance
npx tsx scripts/maintenance/validate-snapshot-counts.ts
npx tsx scripts/maintenance/run-snapshot.ts
```
