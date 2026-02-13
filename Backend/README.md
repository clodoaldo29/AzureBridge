# AzureBridge — Backend

API REST responsável por sincronizar dados do Azure DevOps, calcular métricas e servir o dashboard.

## Stack

- **Node.js 20** + TypeScript
- **Fastify** — framework HTTP
- **Prisma 5** — ORM com PostgreSQL
- **BullMQ** — fila de jobs assíncronos
- **Redis** — cache e backend de filas
- **azure-devops-node-api** — integração com Azure DevOps
- **Pino** — logging estruturado
- **Zod** — validação de schemas

## Arquitetura interna

```
HTTP Request
     │
     ▼
 Controller          (src/controllers/)
     │  valida entrada, chama service
     ▼
  Service            (src/services/)
     │  lógica de negócio, combina dados
     ▼
 Repository          (src/repositories/)
     │  queries ao banco via Prisma
     ▼
 PostgreSQL (Supabase)

Paralelamente:
  BullMQ Worker      (src/jobs/)
     │  processa jobs em background
     ▼
  Azure Integration  (src/integrations/azure/)
     │  sync de projetos, sprints, work items, times
     ▼
  PostgreSQL
```

## Estrutura de diretórios

```
src/
├── server.ts              # Entry point: inicializa Fastify
├── app.ts                 # Registra plugins, middlewares e rotas
├── worker.ts              # Entry point do processo worker (BullMQ)
│
├── controllers/           # Handlers das rotas HTTP
│   ├── capacity.controller.ts
│   ├── dashboard.controller.ts
│   ├── project.controller.ts
│   ├── sprint.controller.ts
│   ├── sync.controller.ts
│   └── work-item.controller.ts
│
├── services/              # Lógica de negócio
│   ├── capacity.service.ts    # Cálculo de capacidade vs planejado
│   ├── metrics.service.ts     # Velocity, cycle time, lead time
│   ├── snapshot.service.ts    # Geração de snapshots diários
│   ├── sprint.service.ts      # Dados e métricas de sprint
│   ├── sync.service.ts        # Orquestra o processo de sync
│   └── work-item.service.ts   # Consultas de work items
│
├── repositories/          # Acesso ao banco (Prisma)
│   ├── project.repository.ts
│   ├── sprint.repository.ts
│   └── work-item.repository.ts
│
├── integrations/azure/    # Clientes Azure DevOps
│   ├── client.ts              # Configuração do cliente autenticado
│   ├── sprints.service.ts     # Busca de sprints e iterações
│   ├── teams.service.ts       # Membros e capacidade dos times
│   ├── work-items.service.ts  # Work items e histórico
│   └── types.ts               # Tipos da API Azure
│
├── jobs/                  # Workers BullMQ
│   ├── queue.ts               # Definição das filas
│   ├── worker.ts              # Processador dos jobs
│   └── definitions/
│       ├── sync.job.ts        # Job de sincronização
│       ├── snapshot.job.ts    # Job de snapshot diário
│       └── metrics.job.ts     # Job de cálculo de métricas
│
├── cache/                 # Redis
│   ├── redis.client.ts        # Conexão Redis
│   └── cache.service.ts       # Wrappers get/set com TTL
│
├── routes/
│   └── api.routes.ts          # Definição de todos os endpoints
│
├── schemas/               # Schemas Zod de validação
├── middleware/            # Error handler global
└── utils/                 # Logger, formatadores
```

## Instalação e configuração

```bash
npm install

cp .env.example .env
# Preencha as variáveis — ver seção abaixo
```

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `NODE_ENV` | Sim | `development` ou `production` |
| `PORT` | Não | Porta da API (padrão: `3001`) |
| `AZURE_DEVOPS_ORG_URL` | Sim | URL da organização: `https://dev.azure.com/org` |
| `AZURE_DEVOPS_PAT` | Sim | Personal Access Token do Azure DevOps |
| `DATABASE_URL` | Sim | Connection string PostgreSQL (pooler, para runtime) |
| `DIRECT_DATABASE_URL` | Sim | Connection string PostgreSQL (direta, para migrations) |
| `REDIS_HOST` | Sim | Host do Redis (ex: `localhost` ou `redis`) |
| `REDIS_PORT` | Não | Porta Redis (padrão: `6379`) |
| `REDIS_PASSWORD` | Não | Senha Redis (se aplicável) |
| `CORS_ORIGIN` | Não | Origin permitida (padrão: `http://localhost:5173`) |
| `SYNC_INTERVAL_HOURS` | Não | Intervalo entre syncs automáticos (padrão: `1`) |
| `SNAPSHOT_INTERVAL_HOURS` | Não | Intervalo entre snapshots (padrão: `4`) |
| `LOG_LEVEL` | Não | `debug`, `info`, `warn`, `error` (padrão: `info`) |

Ver arquivo completo em [.env.example](.env.example).

## Executando

### Desenvolvimento

```bash
npm run dev          # servidor com hot-reload (tsx watch)
npm run worker       # processo worker BullMQ separado
```

### Produção

```bash
npm run build        # compila TypeScript para dist/
npm start            # inicia servidor compilado
npm run worker:prod  # inicia worker compilado
```

### Banco de dados

```bash
npm run db:generate       # gera o Prisma Client após mudanças no schema
npm run db:migrate        # cria e aplica migration (desenvolvimento)
npm run db:migrate:prod   # aplica migrations existentes (produção)
npm run db:push           # sync direto do schema sem migration (dev rápido)
npm run db:studio         # abre Prisma Studio no browser
npm run db:seed           # popula dados iniciais
npm run db:reset          # reseta banco e re-seed (apenas dev)
```

## Testes

```bash
npm test              # todos os testes com coverage
npm run test:watch    # modo watch
npm run test:e2e      # testes end-to-end
```

## Jobs e Workers

O backend possui três tipos de jobs processados pelo BullMQ:

| Job | Trigger | Descrição |
|---|---|---|
| `sync` | Manual (API) ou scheduler | Sincroniza dados do Azure DevOps para o banco |
| `snapshot` | Diário (cron) | Captura estado atual da sprint para o burndown histórico |
| `metrics` | Após sync | Calcula velocity, cycle time, lead time, throughput |

O processo worker (`src/worker.ts`) é separado do servidor HTTP e deve rodar em paralelo em produção.

## Sistema de cache

As respostas das rotas mais pesadas são cacheadas no Redis com TTL configurável via `REDIS_KEY_PREFIX`. O cache é invalidado automaticamente após um sync bem-sucedido.

## Rotas da API

Ver documentação completa em [../docs/API.md](../docs/API.md).

Grupos de endpoints:

| Grupo | Método | Prefixo |
|---|---|---|
| Health | GET | `/health` |
| Projetos | GET | `/projects` |
| Sprints | GET | `/sprints` |
| Work Items | GET | `/work-items` |
| Capacidade | GET | `/sprints/:id/capacity/comparison` |
| Sync | POST | `/sync/*` |
| Dashboard | GET | `/dashboard/*` |

## Scripts de manutenção

O diretório `scripts/` contém scripts de sincronização, backfill, manutenção e diagnóstico, incluindo:

- **Backfill**: recuperação de `closedDate` via revisões, reconstrução de contadores de snapshots, geração de burndown histórico
- **Manutenção**: verificação de estado do banco, validação de snapshots, correção de contadores, execução manual de snapshots
- **Sync**: sincronização incremental (smart-sync) e completa, com captura automática de `closedDate`

Ver documentação completa em [scripts/README.md](scripts/README.md).

## Docker

```bash
# Build da imagem
docker build -t azurebridge-api .

# Executar standalone (com .env configurado)
docker run -p 3001:3001 --env-file .env azurebridge-api
```

Para orquestração completa, use o `docker-compose.yml` na raiz do projeto.
