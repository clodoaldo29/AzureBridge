# AzureBridge — Arquitetura do Sistema

## Visão geral

O AzureBridge é composto por quatro processos principais que rodam em containers Docker separados:

| Container | Papel |
|---|---|
| `api` | Servidor HTTP (Fastify) que serve a API REST |
| `web` | Frontend React servido via Nginx |
| `auto-sync` | Scheduler que executa sincronizações automáticas |
| `redis` | Cache e backend de filas BullMQ |

O banco de dados PostgreSQL é externo (Supabase), acessado pelos containers `api` e `auto-sync`.

---

## Diagrama completo

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Azure DevOps                               │
│   Projects  │  Sprints  │  Work Items  │  Teams  │  Capacity         │
└──────────────────────┬───────────────────────────────────────────────┘
                       │  HTTPS (azure-devops-node-api)
          ┌────────────┼─────────────────────────────────┐
          │            │                                 │
          ▼            ▼                                 ▼
   ┌─────────────────────────┐                 ┌──────────────────┐
   │      Container: api      │                 │ Container:       │
   │   (Fastify, port 3001)   │                 │   auto-sync      │
   │                         │                 │  (cron/scheduler)│
   │  Routes → Controllers   │                 │                  │
   │  → Services             │                 │  hourly: smart   │
   │  → Repositories         │                 │  daily: full     │
   │  → Prisma ORM           │                 │  bootstrap: load │
   └─────────┬──────────┬───┘                 └────────┬─────────┘
             │          │                              │
             │          │ BullMQ Jobs                 │ direct scripts
             ▼          ▼                              │
   ┌──────────────┐  ┌───────────┐                    │
   │    Redis     │  │  Worker   │                    │
   │  (cache +    │  │ (BullMQ)  │                    │
   │   filas)     │  └─────┬─────┘                    │
   └──────────────┘        │                          │
                           ▼                          ▼
          ┌────────────────────────────────────────────────────┐
          │                PostgreSQL (Supabase)                │
          │    projects, sprints, work_items, capacities,       │
          │    sprint_snapshots, metric_snapshots, sync_logs    │
          └────────────────────────────────────────────────────┘
                           ▲
                           │ REST API (/health, /projects, /sprints...)
                           │
                  ┌────────────────┐
                  │ Container: web  │
                  │  (Nginx + React)│
                  │   port 80       │
                  └────────────────┘
                           ▲
                           │ HTTP
                     Usuário (browser)
```

---

## Fluxo de sincronização

### 1. Bootstrap (carga inicial)

Executado uma vez quando o sistema é configurado pela primeira vez:

```
auto-sync (bootstrap mode)
  │
  ├── sync-all-projects.js
  │     └── Busca projetos no Azure → salva em `projects`
  │
  ├── sync-all-team-members.js
  │     └── Busca membros por projeto → salva em `team_members`
  │
  ├── sync-capacity.js
  │     └── Busca capacidade por sprint/membro → salva em `team_capacities`
  │
  ├── complete-massive-sync.js
  │     └── Busca TODOS os work items → salva em `work_items`
  │
  └── backfill-burndown.ts
        └── Gera snapshots históricos → salva em `sprint_snapshots`
```

### 2. Sync incremental (hourly)

Executado automaticamente a cada hora pelo container `auto-sync`:

```
smart-sync.ts
  │
  ├── Busca work items alterados desde o último sync
  │     (usa campo `changedDate` para filtrar)
  │
  ├── Atualiza work items e hierarquia
  │
  ├── Recalcula métricas da sprint ativa
  │
  └── Atualiza `lastSyncAt` no SyncLog
```

### 3. Sync diário (daily)

Executado uma vez por dia pelo container `auto-sync`:

```
auto-sync.ts (daily mode)
  │
  ├── sync incremental (smart-sync)
  │
  ├── sync de membros e capacidade
  │
  ├── run-snapshot.ts
  │     └── Captura estado atual → salva em `sprint_snapshots`
  │
  └── cálculo de métricas (velocity, cycle time)
```

---

## Fluxo de um request HTTP

```
Browser → GET /sprints/:id/capacity/comparison
     │
     ▼
Fastify (api.routes.ts)
     │
     ▼
capacityController.getComparison()
     │
     ├── Verifica cache Redis
     │     └── HIT → retorna resposta cacheada
     │
     └── MISS → capacityService.getComparison(sprintId)
                   │
                   ├── sprintRepository.findById(sprintId)
                   │     └── Prisma: SELECT sprint + work_items + team_capacities
                   │
                   ├── Calcula horas disponíveis, planejadas, restantes por membro
                   │
                   ├── Calcula unassigned (itens sem membro)
                   │
                   ├── Salva resultado no Redis (TTL: 5min)
                   │
                   └── Retorna JSON para o controller
```

---

## Arquitetura do Frontend

```
App.tsx (React Router)
  │
  └── AppLayout (Header + Sidebar)
        │
        └── Dashboard (features/dashboard/pages/Dashboard.tsx)
              │
              ├── Seletor de projeto (Zustand: selectedProjectId)
              │
              ├── Data fetching (React Query)
              │     ├── useSprints({ state: 'Active' })
              │     ├── useCapacityComparison(sprintId)
              │     ├── useSprintBurndown(sprintId)
              │     └── useBlockedWorkItems()
              │
              └── Componentes
                    ├── StatCard (×5) — métricas do topo
                    ├── ProgressBar — progresso da sprint em horas
                    ├── SprintHealthCard — score e penalidades
                    ├── BlockersAlert — work items bloqueados
                    ├── CapacityTable — capacidade vs planejado
                    ├── MemberCapacityProgress — progresso por pessoa
                    └── BurndownChart — gráfico de burndown interativo
```

---

## Modelo de dados de burndown

O burndown é construído a partir de `SprintSnapshot`, capturado diariamente:

```
Dia 1 (sprint start)
  snapshot: { remainingWork: 120, totalWork: 120, idealRemaining: 120 }

Dia 2
  snapshot: { remainingWork: 110, totalWork: 120, idealRemaining: 108 }

Dia 3 (scope adicionado: +20h)
  snapshot: { remainingWork: 122, totalWork: 140, idealRemaining: 104 }
  → scopeAdded = 140 - 120 = 20h
  → ideal recalculado: 122h / dias restantes

...
```

O frontend recebe os snapshots e constrói o gráfico no cliente:
1. Linha **Ideal**: recalculada a cada mudança de escopo (piecewise ideal burn)
2. Linha **Remaining**: `remainingWork` de cada snapshot
3. Linha **Projeção**: extrapolação linear pela velocidade média (`burnedTotal / workedDays`)
4. Barras **Escopo**: diferença positiva em `totalWork` entre dias consecutivos

---

## Sprint Health Score

O score é calculado no frontend (`src/utils/calculations.ts`) a partir dos dados da API:

```
Score inicial: 100

Penalidades aplicadas:
  - Capacidade < 60%:        -15
  - Capacidade > 90%:        -10
  - Capacidade > 100%:       -20
  - Desvio progresso > 0.1:  -10
  - Desvio progresso > 0.2:  -20
  - Desvio progresso > 0.3:  -30
  - Blockers (n × 5, max):   -20
  - Sprint fora de tracking:  -10

Score final = max(0, min(100, score))

Classificação:
  ≥ 80 → Excelente
  ≥ 60 → Bom
  ≥ 40 → Atenção
  < 40 → Crítico
```

O "desvio de progresso" compara o percentual do tempo da sprint decorrido com o percentual de horas concluídas. Ex: se 50% do tempo passou mas apenas 20% do trabalho foi concluído, o desvio é 0.3 → penalidade de -30.

---

## Containers Docker

### `api` — Backend

```dockerfile
# Multi-stage build
# Stage 1: deps + build TypeScript
# Stage 2: runtime Node.js com dist/ compilado
```

Expõe a porta `3001`. Aguarda o Redis estar disponível antes de iniciar.

### `web` — Frontend

```dockerfile
# Stage 1: build Vite (node)
# Stage 2: Nginx serve dist/
```

O `nginx.conf` configura:
- Serve arquivos estáticos de `/usr/share/nginx/html`
- Proxy `/api/*` → `http://api:3001/*`
- Fallback para `index.html` (SPA routing)

### `auto-sync` — Scheduler

Usa o `Dockerfile.scheduler`. Executa scripts de sync via cron com três modos:
- `hourly`: só `smart-sync.ts`
- `daily`: smart-sync + snapshot + métricas
- `bootstrap`: carga completa inicial

### `redis` — Cache

Redis 7 com persistência em volume `redis-data`.

---

## Decisões de arquitetura notáveis

**Por que dois processos no backend?**
O servidor HTTP (`server.ts`) e o worker de jobs (`worker.ts`) são processos separados. Isso garante que jobs longos de sync não bloqueiem as respostas HTTP.

**Por que snapshots diários em vez de calcular on-demand?**
O burndown histórico não pode ser reconstruído após o fato sem snapshots, pois os dados de `remainingWork` são sobrescritos com cada sync. O snapshot diário garante que sempre haverá dados históricos para visualizar a evolução da sprint.

**Por que Redis além do banco?**
As queries de capacidade e burndown envolvem JOINs complexos. O Redis evita recalcular esses dados a cada request do dashboard, com TTL de 5 minutos para manter a atualidade.

**Por que `DATABASE_URL` e `DIRECT_DATABASE_URL`?**
O Supabase usa PgBouncer (pooler) para conexões em runtime, mas as migrations precisam de uma conexão direta. Prisma exige as duas URLs separadas nesse cenário.
