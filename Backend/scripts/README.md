# AzureBridge — Scripts de Sincronização e Manutenção

> Pipeline de sincronização com Azure DevOps, scripts de manutenção e orquestração via cron.

---

## Estrutura

```
scripts/
├── README.md
│
├── orchestrators/             # Orquestradores e cron
│   ├── auto-sync.ts           # Orquestrador principal (lê AUTO_SYNC_MODE)
│   └── auto-sync-cron.sh      # Configura cron e inicializa o scheduler
│
├── sync/                      # Pipeline de sincronização
│   ├── sync-core.ts           # Núcleo compartilhado (fases de sync)
│   ├── sync-daily.ts          # Pipeline diário completo
│   └── sync-hourly.ts         # Pipeline horário incremental
│
└── maintenance/               # Manutenção do banco
    └── reset-db.ts            # Reset completo do banco (apenas desenvolvimento)
```

---

## Modos do pipeline

O container `auto-sync` executa via cron, controlado pela variável `AUTO_SYNC_MODE`:

| Modo | Frequência padrão | Script | Descrição |
|---|---|---|---|
| `hourly` | A cada hora (`0 * * * *`) | `sync/sync-hourly.ts` | Sync incremental: work items alterados + snapshot ativo |
| `daily` | 02:00 (`0 2 * * *`) | `sync/sync-daily.ts` | Pipeline completo com backfill de sprints passadas |
| `full` / `bootstrap` | Manual | `sync/sync-daily.ts` + `FULL_SYNC=true` | Carga inicial completa |

Variável de retry: `AUTO_SYNC_STEP_RETRIES` (padrão: `3` tentativas com backoff).

---

## Fases do pipeline

### Hourly (`sync-hourly.ts`)

| Fase | Descrição |
|---|---|
| 1 | Sync incremental de work items alterados nas últimas horas |
| 2 | Reconciliação de work items removidos da sprint ativa |
| 3 | Snapshot do burndown da sprint ativa |

### Daily (`sync-daily.ts`)

| Fase | Descrição |
|---|---|
| 1 | Sync de projetos e sprints do Azure DevOps |
| 2 | Sync de membros dos times |
| 3 | Sync de capacidade da sprint ativa |
| 4 | Sync massivo de work items dos projetos alvo |
| 5 | Backfill de sprints passadas (delta por `rev`) + capacidade histórica |
| 6 | Backfill de `closedDate` via revisões para items Done |
| 7 | Snapshot do burndown da sprint ativa |

> No modo `full` (`FULL_SYNC=true`), a Fase 4 processa todos os work items sem filtro de data.

---

## Comandos úteis

### Executar sync manualmente

```bash
# Sync horário
docker exec -it azurebridge-auto-sync sh -c "AUTO_SYNC_MODE=hourly npx tsx scripts/orchestrators/auto-sync.ts"

# Sync diário
docker exec -it azurebridge-auto-sync sh -c "AUTO_SYNC_MODE=daily npx tsx scripts/orchestrators/auto-sync.ts"

# Sync full (carga completa)
docker exec -it azurebridge-auto-sync sh -c "AUTO_SYNC_MODE=full npx tsx scripts/orchestrators/auto-sync.ts"
```

### Acompanhar logs do scheduler

```bash
docker logs azurebridge-auto-sync -f
```

### Variáveis de controle do scheduler

| Variável | Padrão | Descrição |
|---|---|---|
| `AUTO_SYNC_MODE` | `daily` | Modo de execução: `hourly`, `daily`, `full` |
| `AUTO_SYNC_STEP_RETRIES` | `3` | Tentativas por etapa em caso de falha |
| `AUTO_SYNC_CRON_HOURLY` | `0 * * * *` | Expressão cron do sync horário |
| `AUTO_SYNC_CRON_DAILY` | `0 2 * * *` | Expressão cron do sync diário |
| `AUTO_SYNC_RUN_ON_START` | `false` | Executa sync imediatamente ao iniciar o container |
| `AUTO_SYNC_RUN_ON_START_MODE` | `daily` | Modo usado quando `RUN_ON_START=true` |
