# ⚙️ AzureBridge — Backend

> API REST responsável por sincronizar dados do Azure DevOps, calcular métricas e servir o dashboard.

---

## 📋 Índice

- [Stack](#️-stack)
- [Arquitetura interna](#-arquitetura-interna)
- [Estrutura de diretórios](#-estrutura-de-diretórios)
- [Variáveis de ambiente](#️-variáveis-de-ambiente)
- [Comandos](#-comandos)
- [Jobs e Workers](#-jobs-e-workers)
- [Cache Redis](#-cache-redis)
- [Endpoints da API](#-endpoints-da-api)
- [Docker](#-docker)

---

## 🛠️ Stack

| Tecnologia | Uso |
|---|---|
| **Node.js 20** + TypeScript | Runtime e linguagem |
| **Fastify 4** | Framework HTTP |
| **Prisma 5** | ORM com PostgreSQL |
| **BullMQ 5** | Fila de jobs assíncronos |
| **Redis 7** | Cache e backend de filas |
| **azure-devops-node-api** | Integração com Azure DevOps |
| **Pino** | Logging estruturado |
| **Zod** | Validação de schemas |

---

## 🏗️ Arquitetura interna

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

---

## 📁 Estrutura de diretórios

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
│   ├── work-items.service.ts  # Work items e histórico de revisões
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

---

## ⚙️ Variáveis de ambiente

```bash
cp .env.example .env
# Preencha com seus valores
```

| Variável | Obrigatória | Padrão | Descrição |
|---|:---:|---|---|
| `NODE_ENV` | ✅ | — | `development` ou `production` |
| `PORT` | — | `3001` | Porta da API |
| `AZURE_DEVOPS_ORG_URL` | ✅ | — | URL da organização: `https://dev.azure.com/org` |
| `AZURE_DEVOPS_PAT` | ✅ | — | Personal Access Token do Azure DevOps |
| `DATABASE_URL` | ✅ | — | Connection string PostgreSQL (pooler, para runtime) |
| `DIRECT_DATABASE_URL` | ✅ | — | Connection string PostgreSQL (direta, para migrations Prisma) |
| `REDIS_HOST` | ✅ | — | Host do Redis (ex: `localhost` ou `redis`) |
| `REDIS_PORT` | — | `6379` | Porta Redis |
| `REDIS_PASSWORD` | — | — | Senha Redis (se aplicável) |
| `CORS_ORIGIN` | — | `http://localhost:5173` | Origin permitida pelo CORS |
| `SYNC_INTERVAL_HOURS` | — | `1` | Intervalo entre syncs automáticos (horas) |
| `SNAPSHOT_INTERVAL_HOURS` | — | `4` | Intervalo entre snapshots |
| `LOG_LEVEL` | — | `info` | `debug`, `info`, `warn`, `error` |

Ver arquivo completo em [.env.example](.env.example).

---

## 🚀 Comandos

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

### Sync manual

```bash
# Executado no container auto-sync
docker exec -it azurebridge-auto-sync sh -c "AUTO_SYNC_MODE=hourly npx tsx scripts/orchestrators/auto-sync.ts"
docker exec -it azurebridge-auto-sync sh -c "AUTO_SYNC_MODE=daily npx tsx scripts/orchestrators/auto-sync.ts"
docker exec -it azurebridge-auto-sync sh -c "AUTO_SYNC_MODE=full npx tsx scripts/orchestrators/auto-sync.ts"
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

### Testes

```bash
npm test              # todos os testes com coverage
npm run test:watch    # modo watch
npm run test:e2e      # testes end-to-end
```

---

## ⚡ Jobs e Workers

O backend possui três tipos de jobs processados pelo BullMQ:

| Job | Trigger | Descrição |
|---|---|---|
| `sync` | Manual (API) ou scheduler | Sincroniza dados do Azure DevOps para o banco |
| `snapshot` | Diário (cron) | Captura estado atual da sprint para o burndown histórico |
| `metrics` | Após sync | Calcula velocity, cycle time, lead time, throughput |

> O processo worker (`src/worker.ts`) é separado do servidor HTTP e deve rodar em paralelo em produção.

---

## 🗃️ Cache Redis

As respostas das rotas mais pesadas são cacheadas no Redis com TTL configurável. O cache é invalidado automaticamente após um sync bem-sucedido.

---

## 🔌 Endpoints da API

Ver documentação completa em [../docs/API.md](../docs/API.md).

| Grupo | Método | Prefixo |
|---|---|---|
| Health | `GET` | `/health` |
| Projetos | `GET` | `/projects` |
| Sprints | `GET` | `/sprints` |
| Work Items | `GET` | `/work-items` |
| Capacidade | `GET` | `/sprints/:id/capacity/comparison` |
| Sync | `POST` | `/sync/*` |
| Dashboard | `GET` | `/dashboard/*` |

---

## 🐳 Docker

```bash
# Build da imagem
docker build -t azurebridge-api .

# Executar standalone (com .env configurado)
docker run -p 3001:3001 --env-file .env azurebridge-api
```

Para orquestração completa, use o `docker-compose.yml` na raiz do projeto.
