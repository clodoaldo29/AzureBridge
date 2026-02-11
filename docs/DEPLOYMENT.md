# AzureBridge — Guia de Deployment

Este documento cobre a configuração completa para rodar o AzureBridge em produção usando Docker Compose.

---

## Pré-requisitos

- Docker Engine ≥ 24 e Docker Compose ≥ 2
- Conta no [Supabase](https://supabase.com) (PostgreSQL gerenciado) ou instância PostgreSQL 16+ própria
- Personal Access Token (PAT) do Azure DevOps
- Domínio ou IP público (para acesso externo)

---

## 1. Configuração do Azure DevOps

### Criando o Personal Access Token (PAT)

1. Acesse `https://dev.azure.com/{sua-org}` → **User Settings** → **Personal Access Tokens**
2. Clique em **New Token**
3. Configure as permissões mínimas necessárias:

| Escopo | Permissão |
|---|---|
| Work Items | Read |
| Project and Team | Read |
| Identity | Read |

4. Copie o token gerado — ele não será exibido novamente.

---

## 2. Configuração do banco de dados (Supabase)

1. Crie um projeto no [Supabase](https://supabase.com)
2. Acesse **Project Settings** → **Database**
3. Copie as duas connection strings:
   - **Connection Pooling** (porta `6543`) → use como `DATABASE_URL`
   - **Direct Connection** (porta `5432`) → use como `DIRECT_DATABASE_URL`

Formato esperado:
```
DATABASE_URL=postgresql://postgres.xxxxx:[SENHA]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_DATABASE_URL=postgresql://postgres.xxxxx:[SENHA]@aws-0-us-east-1.pooler.supabase.com:5432/postgres
```

---

## 3. Configuração das variáveis de ambiente

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

### Variáveis opcionais (com padrões)

```env
# Servidor
NODE_ENV=production
PORT=3001
HOST=0.0.0.0

# Segurança
CORS_ORIGIN=http://localhost          # Altere para seu domínio em produção
API_KEY=troque-por-chave-segura
JWT_SECRET=troque-por-secret-seguro

# Sync automático
SYNC_INTERVAL_HOURS=1                 # Sync incremental a cada 1 hora
SNAPSHOT_INTERVAL_HOURS=4            # Snapshot a cada 4 horas
REPORT_AUTO_GENERATE=true

# Feature flags
FEATURE_ANALYTICS=true
FEATURE_REPORTS=true
FEATURE_AUTO_SYNC=true
FEATURE_ALERTS=true

# Logging
LOG_LEVEL=info
LOG_PRETTY=false                      # false em produção (JSON estruturado)
LOG_FILE_ENABLED=false

# Rate limiting
RATE_LIMIT_MAX=100                    # Requisições por janela
RATE_LIMIT_TIME_WINDOW=15m
```

---

## 4. Subindo o ambiente

### Desenvolvimento

```bash
make install    # instala dependências npm
make dev        # sobe com docker-compose.dev.yml (hot-reload)
```

Acessos:
- Frontend: http://localhost:5173 (Vite dev server)
- API: http://localhost:3001
- Redis: localhost:6379

### Produção

```bash
make build      # constrói as imagens Docker
make up         # sobe com docker-compose.yml
make logs       # acompanha os logs
```

Acessos:
- Frontend: http://localhost (Nginx, porta 80)
- API: http://localhost:3001

---

## 5. Migrations do banco

Antes de iniciar pela primeira vez (ou após atualizar o código):

```bash
make db-migrate
# ou diretamente:
docker exec -it azurebridge-api npm run db:migrate:prod
```

---

## 6. Primeiro sync (bootstrap)

Após subir o ambiente pela primeira vez, execute o bootstrap para carregar todos os dados:

```bash
# Carga completa inicial (pode demorar vários minutos dependendo do volume)
docker exec -it azurebridge-auto-sync sh -c "AUTO_SYNC_MODE=bootstrap npx tsx scripts/auto-sync.ts"
```

O bootstrap executa na sequência:
1. Sincroniza projetos
2. Sincroniza membros dos times
3. Sincroniza capacidade por sprint
4. Carrega todos os work items
5. Gera snapshots históricos de burndown

Para acompanhar o progresso:
```bash
docker logs -f azurebridge-auto-sync
```

---

## 7. Modos de sync automático

O container `auto-sync` executa sincronizações automáticas baseadas na variável `AUTO_SYNC_MODE`:

| Modo | Quando usar | O que faz |
|---|---|---|
| `hourly` (padrão) | A cada hora | Smart-sync incremental: apenas work items alterados |
| `daily` | Uma vez por dia | Smart-sync + snapshot diário + métricas |
| `bootstrap` | Uma vez (setup inicial) | Carga completa de todos os dados |

Para forçar um sync manual:
```bash
# Sync incremental manual
docker exec -it azurebridge-api curl -X POST http://localhost:3001/sync/incremental

# Sync completo manual
docker exec -it azurebridge-api curl -X POST http://localhost:3001/sync/full
```

---

## 8. Serviços Docker Compose

```yaml
services:
  api:
    # Backend Fastify (porta 3001)
    # Depende de: redis

  auto-sync:
    # Scheduler de sync automático
    # Depende de: api (health check)

  web:
    # Frontend React via Nginx (porta 80)
    # Depende de: api

  redis:
    # Cache + filas BullMQ (porta 6379)
    # Volume: redis-data (persistência)
```

Para inspecionar o estado dos containers:
```bash
docker compose ps
docker compose logs api
docker compose logs auto-sync
```

---

## 9. Comandos de manutenção

```bash
# Parar tudo
make down

# Parar e remover volumes (perde cache Redis)
make clean

# Ver logs em tempo real
make logs

# Acessar shell do container da API
make api-shell

# Abrir Prisma Studio (UI do banco)
make db-studio
```

### Scripts disponíveis

```bash
# Sync manual de todos os projetos
docker exec -it azurebridge-api npx tsx scripts/sync/sync-all-projects.js

# Forçar recalculo de burndown de uma sprint
docker exec -it azurebridge-api npx tsx scripts/backfill/backfill-burndown.ts

# Reset do banco (apenas dev)
docker exec -it azurebridge-api npm run db:reset
```

Ver todos os scripts em [Backend/scripts/README.md](../Backend/scripts/README.md).

---

## 10. Troubleshooting

### API retornando 503 no `/health`

O banco de dados está inacessível. Verifique:
- Se `DATABASE_URL` está correta
- Se o Supabase está online
- Se a senha está correta na connection string

```bash
docker logs azurebridge-api | grep -i error
```

### Frontend não carrega dados

Verifique se a API está respondendo:
```bash
curl http://localhost:3001/health
```

Se a API estiver ok, verifique `CORS_ORIGIN` em `Backend/.env` — deve corresponder à URL do frontend.

### Sync falhando com erro de autenticação

O PAT pode ter expirado ou não ter as permissões corretas. Gere um novo PAT conforme o passo 1 e atualize `AZURE_DEVOPS_PAT` no `.env`.

```bash
# Reiniciar a API após atualizar .env
docker compose restart api auto-sync
```

### Redis connection refused

Verifique se o container Redis está rodando:
```bash
docker compose ps redis
docker logs azurebridge-redis
```

Se o `REDIS_HOST` estiver como `localhost`, mude para `redis` (nome do serviço no Docker Compose).

### Burndown não aparece no dashboard

O burndown precisa de snapshots para ser exibido. Se os snapshots ainda não foram gerados:
```bash
docker exec -it azurebridge-api npx tsx scripts/maintenance/run-snapshot.ts
```

Ou execute o backfill para gerar histórico:
```bash
docker exec -it azurebridge-api npx tsx scripts/backfill/backfill-burndown.ts
```
