# 🔄 AzureBridge — Scripts de Sincronização e Manutenção

> Pipeline de sincronização com Azure DevOps, scripts de backfill e ferramentas de manutenção.

---

## 📋 Índice

- [Estrutura](#-estrutura)
- [Modos do pipeline](#-modos-do-pipeline)
- [Scripts por categoria](#-scripts-por-categoria)
- [Comandos úteis](#️-comandos-úteis)

---

## 📁 Estrutura

```
scripts/
├── auto-sync.ts           # Wrapper → orchestrators/auto-sync.ts
├── run-snapshot.ts        # Wrapper → maintenance/run-snapshot.ts
│
├── orchestrators/         # Orquestradores e cron
│   ├── auto-sync.ts       # Orquestrador principal
│   └── auto-sync-cron.sh  # Implementação do cron
│
├── sync/                  # Sincronizações com Azure DevOps
│   ├── smart-sync.ts
│   ├── sync-all-projects.js
│   ├── sync-all-team-members.js
│   ├── sync-capacity.js
│   ├── sync-target-projects.js
│   ├── complete-massive-sync.js
│   └── sync-hierarchy.js
│
├── backfill/              # Reconstrução de histórico e snapshots
│   ├── backfill-project-history-batch.ts
│   ├── backfill-closed-dates.ts
│   ├── rebuild-snapshot-counts.ts
│   └── rebuild-active-burndown-event-model.ts
│
└── maintenance/           # Manutenção essencial
    ├── run-snapshot.ts
    ├── validate-snapshot-counts.ts
    └── reset-db.ts
```

---

## 🚦 Modos do pipeline

O container `auto-sync` executa `scripts/auto-sync.ts` via cron, controlado pela variável `AUTO_SYNC_MODE`:

| Modo | Frequência | Uso |
|---|---|---|
| `hourly` _(padrão)_ | A cada hora | Sync incremental rápido |
| `daily` | Uma vez por dia | Pipeline completo |
| `full` / `bootstrap` | Manual | Carga inicial completa |

Variável de retry: `AUTO_SYNC_STEP_RETRIES` (padrão: `3` tentativas com exponential backoff).

### Etapas por modo

**⏰ hourly:**
```
smart-sync → run-snapshot → rebuild-active-burndown-event-model
```

**📅 daily:**
```
sync-all-projects → sync-all-team-members → sync-target-projects
→ smart-sync → backfill-project-history-batch → backfill-closed-dates
→ sync-capacity → run-snapshot → rebuild-active-burndown-event-model
→ validate-snapshot-counts
```

**🏁 full / bootstrap:**
```
tudo do daily + complete-massive-sync + rebuilds completos
```

---

## 📦 Scripts por categoria

### 🎯 Orquestração

| Script | Descrição |
|---|---|
| `orchestrators/auto-sync.ts` | Orquestrador principal. Lê `AUTO_SYNC_MODE` e executa as etapas sequencialmente com retry (exponential backoff). Loga timing e status de cada etapa. |
| `hourly-sync.ts` | Wrapper que define `AUTO_SYNC_MODE=hourly` e chama o orquestrador |
| `daily-sync.ts` | Wrapper que define `AUTO_SYNC_MODE=daily` e chama o orquestrador |
| `full-sync.ts` | Wrapper que define `AUTO_SYNC_MODE=full` e chama o orquestrador |

---

### 📡 Sync Azure DevOps

| Script | Descrição |
|---|---|
| `sync/smart-sync.ts` | Sync incremental. Busca work items alterados via WIQL (`changedDate`), atualiza hierarquia e captura `closedDate` via revisões para items Done |
| `sync/sync-all-projects.js` | Sincroniza projetos e sprints do Azure DevOps |
| `sync/sync-all-team-members.js` | Sincroniza membros dos times por projeto |
| `sync/sync-capacity.js` | Sincroniza capacidade (horas disponíveis, dias off) por sprint/membro |
| `sync/sync-target-projects.js` | Bootstrap seletivo de projetos novos ou específicos |
| `sync/complete-massive-sync.js` | Carga completa de todos os work items (uso apenas no bootstrap) |
| `sync/sync-hierarchy.js` | Sincronização de hierarquia parent/child sob demanda |

---

### 🔧 Backfill / Rebuild

| Script | Descrição |
|---|---|
| `backfill/backfill-project-history-batch.ts` | Backfill de campos históricos (`initialRemainingWork`, `lastRemainingWork`, `doneRemainingWork`) usando revisões do Azure DevOps |
| `backfill/backfill-closed-dates.ts` | Recupera `closedDate` para work items "Done" via API de revisões. O processo Scrum não preenche `System.ClosedDate` para items "Done" (apenas "Closed"), por isso usa `witApi.getRevisions(id)` para encontrar a transição de estado |
| `backfill/rebuild-snapshot-counts.ts` | Reconstrói contadores de estado (`todoCount`, `inProgressCount`, `doneCount`) nos snapshots usando `activatedDate` e `closedDate`. Modos: `REBUILD_MODE=empty` (padrão) ou `all` |
| `backfill/rebuild-active-burndown-event-model.ts` | Reconstrói burndown de sprints ativas usando modelo baseado em eventos. Processa revisões de work items para rastrear mudanças de estado e `remainingWork` dia a dia. Calcula baseline D0, delta de escopo, linha ideal piecewise e contadores de estado. Tipos contabilizados: Task, Bug, Test Case |

---

### 🛠️ Manutenção

| Script | Descrição |
|---|---|
| `maintenance/run-snapshot.ts` | Captura snapshot operacional para sprints ativas (`remainingWork`, `completedWork`, `totalWork`, contadores de estado incluindo `blockedCount`) |
| `maintenance/validate-snapshot-counts.ts` | Valida contadores dos snapshots contra a contagem real de work items. Marca divergências |
| `maintenance/reset-db.ts` | Reset completo do banco — **apenas desenvolvimento** |

---

## ⌨️ Comandos úteis

```bash
# Pipeline por modo (dentro do container)
docker exec -it azurebridge-api npx tsx scripts/hourly-sync.ts
docker exec -it azurebridge-api npx tsx scripts/daily-sync.ts
docker exec -it azurebridge-api npx tsx scripts/full-sync.ts

# Pipeline via orquestrador diretamente
docker exec -it azurebridge-api sh -c "AUTO_SYNC_MODE=hourly npx tsx scripts/auto-sync.ts"
docker exec -it azurebridge-api sh -c "AUTO_SYNC_MODE=daily npx tsx scripts/auto-sync.ts"
docker exec -it azurebridge-api sh -c "AUTO_SYNC_MODE=full npx tsx scripts/auto-sync.ts"

# Backfill / Rebuild
docker exec -it azurebridge-api npx tsx scripts/backfill/backfill-project-history-batch.ts
docker exec -it azurebridge-api npx tsx scripts/backfill/backfill-closed-dates.ts
docker exec -it azurebridge-api npx tsx scripts/backfill/rebuild-snapshot-counts.ts
docker exec -it azurebridge-api npx tsx scripts/backfill/rebuild-active-burndown-event-model.ts

# Manutenção
docker exec -it azurebridge-api npx tsx scripts/maintenance/validate-snapshot-counts.ts
docker exec -it azurebridge-api npx tsx scripts/maintenance/run-snapshot.ts
```
