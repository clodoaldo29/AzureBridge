# AzureBridge

Plataforma completa de monitoramento, análise e visualização de projetos Azure DevOps. Consolida dados de sprints, work items, capacidade de time e métricas de entrega em um dashboard em tempo real.

## Funcionalidades

- **Dashboard em tempo real** — visão consolidada de sprints ativas com métricas de capacidade, progresso e saúde
- **Burndown Chart interativo** — gráfico de burn com linha ideal adaptativa (recalculada a cada mudança de escopo), linha real, projeção de velocidade e barras de scope creep
- **Cumulative Flow Diagram** — gráfico de fluxo acumulado com 4 camadas empilhadas (Done, Blocked, In Progress, To Do), mostrando a evolução diária dos estados dos work items
- **Sprint Health Score** — score 0–100 calculado automaticamente com base em utilização de capacidade, desvio de progresso, blockers e tracking
- **Distribuição de Work Items** — gráficos donut interativos mostrando work items por estado, por tipo e por membro, com contagem total no centro
- **Work Item Aging** — análise de envelhecimento de Tasks "In Progress", comparando tempo real vs tempo esperado com base no esforço e capacidade diária
- **Capacidade por membro** — gráfico de barras horizontais empilhadas mostrando horas concluídas, restantes e excedentes por pessoa na sprint
- **Blockers em destaque** — painel de work items bloqueados com tempo de bloqueio
- **Verificação de conexão** — health check automático na inicialização com polling do backend e feedback visual
- **Sincronização automática** — sync incremental a cada hora e sync completo diário via container scheduler
- **Snapshots históricos** — estado diário da sprint salvo para reconstrução do burndown a qualquer momento
- **Suporte a múltiplos projetos** — troca de projeto via seletor no dashboard

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                        Azure DevOps                         │
│            (Projects, Sprints, Work Items, Teams)           │
└──────────────────────────┬──────────────────────────────────┘
                           │  azure-devops-node-api
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      AzureBridge API                        │
│                   (Fastify + TypeScript)                    │
│                                                             │
│  Controllers → Services → Repositories → Prisma ORM        │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │  Job Queue  │  │ Cache Layer  │  │  Snapshot Engine  │  │
│  │  (BullMQ)   │  │   (Redis)    │  │   (Daily Cron)    │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
└──────────┬───────────────────────────────────┬──────────────┘
           │  PostgreSQL (Supabase)             │  REST API
           ▼                                   ▼
┌────────────────────┐             ┌───────────────────────┐
│     Database       │             │   AzureBridge Web     │
│  (15+ tabelas)     │             │  (React + TailwindCSS)│
└────────────────────┘             └───────────────────────┘
```

## Stack

| Camada | Tecnologia |
|---|---|
| Backend | Node.js 20, TypeScript, Fastify |
| ORM | Prisma 5 |
| Banco de dados | PostgreSQL 16 (Supabase) |
| Cache / Filas | Redis 7, BullMQ |
| Frontend | React 18, TypeScript, Vite |
| UI | TailwindCSS, shadcn/ui, Recharts |
| Infraestrutura | Docker, Docker Compose |
| Integração | azure-devops-node-api |

## Pré-requisitos

- Docker e Docker Compose
- Conta no [Supabase](https://supabase.com) (ou PostgreSQL próprio)
- Personal Access Token do Azure DevOps com permissões: `Work Items (Read)`, `Project and Team (Read)`, `Identity (Read)`

## Quick Start

### 1. Configuração do ambiente

```bash
git clone <repo-url>
cd AzureBridge

cp Backend/.env.example Backend/.env
# Edite Backend/.env com suas credenciais (ver docs/DEPLOYMENT.md)
```

Variáveis obrigatórias no `Backend/.env`:

```env
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/sua-organizacao
AZURE_DEVOPS_PAT=seu-pat-aqui
DATABASE_URL=postgresql://...
DIRECT_DATABASE_URL=postgresql://...
REDIS_HOST=redis
```

### 2. Desenvolvimento local

```bash
make install    # instala dependências (Backend e Frontend)
make dev        # sobe todos os containers em modo dev
```

Acesse:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3001
- Health check: http://localhost:3001/health

### 3. Primeiro sync

Após subir o ambiente, execute o sync inicial para carregar os projetos:

```bash
docker exec -it azurebridge-api npx tsx scripts/auto-sync.ts
```

Para carga completa (bootstrap inicial):

```bash
docker exec -it azurebridge-auto-sync sh -c "AUTO_SYNC_MODE=bootstrap npx tsx scripts/auto-sync.ts"
```

### 4. Produção

```bash
make build   # build das imagens
make up      # sobe em produção
```

Acesse: http://localhost

## Comandos úteis

```bash
make help          # lista todos os comandos disponíveis
make logs          # acompanha logs de todos os containers
make down          # para todos os containers
make clean         # para e remove containers, volumes e imagens
make db-migrate    # executa migrations do banco
make db-studio     # abre o Prisma Studio (UI do banco)
make test          # roda os testes do backend
make lint          # roda os linters
```

## Estrutura do projeto

```
AzureBridge/
├── Backend/                  # API Node.js + TypeScript
│   ├── src/
│   │   ├── controllers/      # Handlers HTTP
│   │   ├── services/         # Lógica de negócio
│   │   ├── repositories/     # Acesso ao banco
│   │   ├── integrations/     # Clientes Azure DevOps
│   │   ├── jobs/             # Workers BullMQ
│   │   ├── cache/            # Redis
│   │   └── routes/           # Definição das rotas
│   ├── prisma/               # Schema e migrations
│   └── scripts/              # Sync, backfill, manutenção
├── Frontend/                 # React + Vite
│   └── src/
│       ├── features/         # Módulos por feature
│       ├── components/       # Componentes compartilhados
│       ├── services/         # API client e queries
│       └── stores/           # Estado global (Zustand)
├── docs/                     # Documentação técnica
├── docker-compose.yml        # Produção
├── docker-compose.dev.yml    # Desenvolvimento
└── Makefile                  # Comandos de build e dev
```

## Documentação

| Documento | Descrição |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitetura detalhada do sistema |
| [docs/API.md](docs/API.md) | Referência completa da API REST |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema do banco de dados |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Guia de deployment e variáveis de ambiente |
| [docs/USER-MANUAL.md](docs/USER-MANUAL.md) | Manual do usuário e guia do dashboard |
| [Backend/README.md](Backend/README.md) | Documentação do backend |
| [Frontend/README.md](Frontend/README.md) | Documentação do frontend |
| [Backend/scripts/README.md](Backend/scripts/README.md) | Scripts de sync e manutenção |

## Licença

MIT
