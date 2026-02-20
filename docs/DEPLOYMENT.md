# 🚀 AzureBridge — Guia de Deployment

> Guia completo para configurar e rodar o AzureBridge em produção usando Docker Compose.

---

## 📋 Índice

- [Pré-requisitos](#-pré-requisitos)
- [Passo 1 — Azure DevOps PAT](#-passo-1--azure-devops-pat)
- [Passo 2 — Banco de dados (Supabase)](#-passo-2--banco-de-dados-supabase)
- [Passo 3 — Variáveis de ambiente](#️-passo-3--variáveis-de-ambiente)
- [Passo 4 — Subindo o ambiente](#-passo-4--subindo-o-ambiente)
- [Passo 5 — Migrations](#-passo-5--migrations)
- [Passo 6 — Bootstrap inicial](#-passo-6--bootstrap-inicial)
- [Sync automático](#-sync-automático)
- [Serviços Docker Compose](#-serviços-docker-compose)
- [Comandos de manutenção](#️-comandos-de-manutenção)
- [Troubleshooting](#-troubleshooting)

---

## ✅ Pré-requisitos

- **Docker Engine** ≥ 24 e **Docker Compose** ≥ 2
- Conta no [Supabase](https://supabase.com) ou instância PostgreSQL 16+ própria
- **Personal Access Token (PAT)** do Azure DevOps
- Domínio ou IP público (para acesso externo)

---

## 🔑 Passo 1 — Azure DevOps PAT

1. Acesse `https://dev.azure.com/{sua-org}` → **User Settings** → **Personal Access Tokens**
2. Clique em **New Token**
3. Configure as permissões mínimas necessárias:

| Escopo | Permissão |
|---|---|
| Work Items | Read |
| Project and Team | Read |
| Identity | Read |

4. Copie o token gerado — **ele não será exibido novamente**.

---

## 🗄️ Passo 2 — Banco de dados (Supabase)

1. Crie um projeto no [Supabase](https://supabase.com)
2. Acesse **Project Settings** → **Database**
3. Copie as duas connection strings:
   - **Connection Pooling** (porta `6543`) → use como `DATABASE_URL`
   - **Direct Connection** (porta `5432`) → use como `DIRECT_DATABASE_URL`

```
DATABASE_URL=postgresql://postgres.xxxxx:[SENHA]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_DATABASE_URL=postgresql://postgres.xxxxx:[SENHA]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

> O Supabase usa PgBouncer para conexões em runtime, mas migrations precisam de conexão direta — por isso são necessárias duas URLs.

---

## ⚙️ Passo 3 — Variáveis de ambiente

```bash
cp Backend/.env.example Backend/.env
```

Edite `Backend/.env` com os valores reais:

### Variáveis obrigatórias

```env
# Azure DevOps
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/sua-organizacao
AZURE_DEVOPS_PAT=seu-pat-gerado-no-passo-1

# Banco de dados
DATABASE_URL=postgresql://postgres.xxxxx:[SENHA]@pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_DATABASE_URL=postgresql://postgres.xxxxx:[SENHA]@db.supabase.com:5432/postgres

# Redis (no Docker Compose, use o nome do serviço)
REDIS_HOST=redis
REDIS_PORT=6379
```

### Variáveis opcionais

| Variável | Padrão | Descrição |
|---|---|---|
| `NODE_ENV` | `production` | Ambiente de execução |
| `PORT` | `3001` | Porta do servidor HTTP |
| `HOST` | `0.0.0.0` | Host de escuta |
| `CORS_ORIGIN` | `http://localhost` | Origem permitida pelo CORS — altere para seu domínio |
| `API_KEY` | — | Chave de autenticação de API |
| `JWT_SECRET` | — | Secret para tokens JWT |
| `SYNC_INTERVAL_HOURS` | `1` | Frequência do sync incremental (horas) |
| `SNAPSHOT_INTERVAL_HOURS` | `4` | Frequência dos snapshots |
| `FEATURE_ANALYTICS` | `true` | Habilita analytics |
| `FEATURE_AUTO_SYNC` | `true` | Habilita sync automático |
| `FEATURE_ALERTS` | `true` | Habilita alertas automáticos |
| `LOG_LEVEL` | `info` | Nível de log: `debug`, `info`, `warn`, `error` |
| `LOG_PRETTY` | `false` | Logs legíveis (use `true` em dev) |
| `RATE_LIMIT_MAX` | `100` | Requisições por janela |
| `RATE_LIMIT_TIME_WINDOW` | `15m` | Janela do rate limit |

---

## 🐳 Passo 4 — Subindo o ambiente

### Desenvolvimento

```bash
make install    # instala dependências no Backend e Frontend
make dev        # build + sobe com docker-compose.dev.yml
```

Acessos em desenvolvimento:

| Serviço | URL |
|---|---|
| 🌐 Frontend (Vite) | http://localhost:5173 |
| 🔌 API | http://localhost:3001 |
| ❤️ Health check | http://localhost:3001/health |

### Produção

```bash
make build      # constrói as imagens Docker
make up         # sobe em produção (background)
make logs       # acompanha os logs em tempo real
make ps         # status dos containers
```

Acessos em produção:

| Serviço | URL |
|---|---|
| 🌐 Frontend (Nginx) | http://localhost |
| 🔌 API | http://localhost:3001 |

---

## 🗃️ Passo 5 — Migrations

Antes de iniciar pela primeira vez (ou após atualizar o código):

```bash
make db-migrate
# ou diretamente:
docker exec -it azurebridge-api npm run db:migrate:prod
```

---

## 🏁 Passo 6 — Bootstrap inicial

Após subir o ambiente pela primeira vez, execute o bootstrap para carregar todos os dados históricos:

```bash
docker exec -it azurebridge-auto-sync sh -c "AUTO_SYNC_MODE=bootstrap npx tsx scripts/auto-sync.ts"
```

O bootstrap executa na sequência:

| Etapa | O que faz |
|---|---|
| 1️⃣ | Sincroniza projetos e sprints |
| 2️⃣ | Sincroniza membros dos times |
| 3️⃣ | Sincroniza capacidade por sprint/membro |
| 4️⃣ | Carrega todos os work items |
| 5️⃣ | Gera snapshots históricos de burndown |

Para acompanhar o progresso:
```bash
docker logs -f azurebridge-auto-sync
```

---

## 🔄 Sync automático

O container `auto-sync` executa sincronizações automáticas baseadas na variável `AUTO_SYNC_MODE`:

| Modo | Frequência | O que faz |
|---|---|---|
| `hourly` _(padrão)_ | A cada hora | Smart-sync incremental de work items alterados + snapshot |
| `daily` | Uma vez por dia | Pipeline completo (projetos, membros, sync, backfill, capacidade, snapshot, validação) |
| `bootstrap` | Manual (setup inicial) | Carga completa de todos os dados históricos |

Para forçar um sync manual:
```bash
# Sync incremental manual
docker exec -it azurebridge-api curl -X POST http://localhost:3001/sync/incremental

# Sync completo manual
docker exec -it azurebridge-api curl -X POST http://localhost:3001/sync/full
```

---

## 📦 Serviços Docker Compose

| Serviço | Função | Porta | Dependências |
|---|---|---|---|
| `api` | Backend Fastify | 3001 | redis |
| `web` | Frontend React via Nginx | 80 | api |
| `auto-sync` | Scheduler de sync cron | — | api (health check) |
| `redis` | Cache + filas BullMQ | 6379 | — |

```bash
docker compose ps                 # status dos containers
docker compose logs api           # logs da API
docker compose logs auto-sync     # logs do scheduler
```

---

## 🛠️ Comandos de manutenção

```bash
make down          # para todos os containers
make clean         # para e remove containers, volumes e imagens
make logs          # logs em tempo real de todos os serviços
make ps            # status dos containers
make api-shell     # abre shell no container da API
make db-studio     # abre o Prisma Studio (UI do banco)
make test          # roda os testes do backend
make lint          # roda ESLint e Prettier
```

### Scripts disponíveis

```bash
# Pipeline por modo
docker exec -it azurebridge-api npx tsx scripts/hourly-sync.ts
docker exec -it azurebridge-api npx tsx scripts/daily-sync.ts
docker exec -it azurebridge-api npx tsx scripts/full-sync.ts

# Sync manual de projetos
docker exec -it azurebridge-api npx tsx scripts/sync/sync-all-projects.js

# Recuperar closedDate para items Done (via revisões Azure)
docker exec -it azurebridge-api npx tsx scripts/backfill/backfill-closed-dates.ts

# Reconstruir contadores de estado nos snapshots
docker exec -it azurebridge-api npx tsx scripts/backfill/rebuild-snapshot-counts.ts

# Reconstruir burndown via modelo de eventos (sprints ativas)
docker exec -it azurebridge-api npx tsx scripts/backfill/rebuild-active-burndown-event-model.ts

# Validar contadores dos snapshots
docker exec -it azurebridge-api npx tsx scripts/maintenance/validate-snapshot-counts.ts

# Executar snapshot manualmente
docker exec -it azurebridge-api npx tsx scripts/maintenance/run-snapshot.ts

# Reset do banco (apenas desenvolvimento)
docker exec -it azurebridge-api npm run db:reset
```

Veja mais em [Backend/scripts/README.md](../Backend/scripts/README.md).

---

## 🔍 Troubleshooting

### API retornando 503 no `/health`

O banco de dados está inacessível. Verifique:
- Se `DATABASE_URL` está correta
- Se o Supabase está online
- Se a senha está correta na connection string

```bash
docker logs azurebridge-api | grep -i error
```

---

### Frontend não carrega dados

Verifique se a API está respondendo:
```bash
curl http://localhost:3001/health
```

Se a API estiver ok, verifique `CORS_ORIGIN` em `Backend/.env` — deve corresponder à URL do frontend.

---

### Sync falhando com erro de autenticação

O PAT pode ter expirado ou não ter as permissões corretas. Gere um novo PAT (Passo 1) e atualize `AZURE_DEVOPS_PAT` no `.env`:

```bash
# Reiniciar após atualizar .env
docker compose restart api auto-sync
```

---

### Redis connection refused

Verifique se o container Redis está rodando:
```bash
docker compose ps redis
docker logs azurebridge-redis
```

> Se `REDIS_HOST` estiver como `localhost`, mude para `redis` (nome do serviço no Docker Compose).

---

### Burndown não aparece no dashboard

O burndown precisa de snapshots para ser exibido. Para gerar manualmente:

```bash
# Snapshot do dia atual
docker exec -it azurebridge-api npx tsx scripts/maintenance/run-snapshot.ts

# Ou reconstruir todo o histórico via modelo de eventos
docker exec -it azurebridge-api npx tsx scripts/backfill/rebuild-active-burndown-event-model.ts
```

---

### CFD mostrando todos os itens em "A Fazer"

Os contadores dos snapshots provavelmente estão zerados. Execute os scripts de recuperação na ordem:

```bash
# 1. Recuperar closedDate dos items Done
docker exec -it azurebridge-api npx tsx scripts/backfill/backfill-closed-dates.ts

# 2. Reconstruir contadores nos snapshots
docker exec -it azurebridge-api npx tsx scripts/backfill/rebuild-snapshot-counts.ts
```

---

### Work Item Aging sem links para Azure DevOps

Configure `VITE_AZURE_DEVOPS_ORG_URL` no `.env` do frontend:

```env
VITE_AZURE_DEVOPS_ORG_URL=https://dev.azure.com/sua-organizacao
```

Essa variável é necessária para que os links "Abrir no Azure DevOps" funcionem no modal de detalhes.
