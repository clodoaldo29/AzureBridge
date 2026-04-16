# AzureBridge

> Plataforma completa de monitoramento e análise de projetos Azure DevOps — dashboard em tempo real, burndown interativo, fluxo cumulativo e muito mais.

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Licença](https://img.shields.io/badge/Licença-MIT-green)

---

## 📋 Índice

- [Funcionalidades](#-funcionalidades)
- [Arquitetura](#️-arquitetura)
- [Stack](#️-stack)
- [Pré-requisitos](#-pré-requisitos)
- [Quick Start](#-quick-start)
- [Comandos úteis](#️-comandos-úteis)
- [Estrutura do projeto](#-estrutura-do-projeto)
- [Documentação](#-documentação)

---

## ✨ Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| 📊 **Dashboard em tempo real** | Visão consolidada da sprint ativa com métricas de capacidade, progresso e saúde |
| 📉 **Burndown Chart interativo** | Linha ideal adaptativa (piecewise), linha real, projeção de velocidade, barras de escopo e trabalho concluído por dia |
| 🌊 **Cumulative Flow Diagram** | Gráfico de fluxo acumulado com 4 camadas (Done, Blocked, In Progress, To Do) |
| 🏥 **Sprint Health Score** | Score 0–100 calculado com base em utilização, desvio de progresso, blockers e tracking |
| 🍩 **Distribuição de Work Items** | Gráficos donut por estado, por tipo e por membro com contagem total no centro |
| ⏳ **Work Item Aging** | Análise de envelhecimento de tasks "In Progress" vs tempo esperado |
| 👥 **Capacidade por membro** | Barras horizontais com horas concluídas, restantes e excedentes por pessoa |
| 🚨 **Blockers em destaque** | Painel de work items bloqueados com tempo de bloqueio |
| 🔄 **Sincronização automática** | Sync incremental a cada hora e completo diário via container scheduler |
| 📸 **Snapshots históricos** | Estado diário da sprint salvo para reconstrução precisa do burndown |
| 🗂️ **Múltiplos projetos** | Troca de projeto via seletor no dashboard |
| 🔗 **Verificação de conexão** | Health check automático na inicialização com polling e feedback visual |

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                        Azure DevOps                         │
│            (Projetos, Sprints, Work Items, Times)           │
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

> Quatro containers Docker trabalham em conjunto: `api` (Fastify), `web` (React+Nginx), `auto-sync` (scheduler cron) e `redis` (cache + filas). O banco PostgreSQL é externo via Supabase.

---

## 🛠️ Stack

| Camada | Tecnologia |
|---|---|
| **Backend** | Node.js 20, TypeScript 5.3, Fastify 4 |
| **ORM** | Prisma 5 |
| **Banco de dados** | PostgreSQL 16 (Supabase) |
| **Cache / Filas** | Redis 7, BullMQ 5 |
| **Frontend** | React 18, TypeScript, Vite 5 |
| **UI** | TailwindCSS 3, shadcn/ui, Recharts 2 |
| **Estado** | React Query 5, Zustand 4 |
| **Infraestrutura** | Docker, Docker Compose |
| **Integração** | azure-devops-node-api 12 |

---

## ✅ Pré-requisitos

- **Docker** e **Docker Compose** instalados
- Conta no [Supabase](https://supabase.com) (ou PostgreSQL próprio)
- **Personal Access Token** do Azure DevOps com as permissões:
  - `Work Items (Read)`
  - `Project and Team (Read)`
  - `Identity (Read)`

---

## 🚀 Quick Start

### 1. Clone e configure o ambiente

```bash
git clone <repo-url>
cd AzureBridge

cp .env.example .env
# Edite .env com suas credenciais
```

Variáveis **obrigatórias** no `.env` da raiz:

```env
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/sua-organizacao
AZURE_DEVOPS_PAT=seu-pat-aqui
DATABASE_URL=postgresql://...
DIRECT_DATABASE_URL=postgresql://...
JWT_SECRET=change-me
AZURE_AD_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
AZURE_AD_TENANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
CORS_ORIGIN=http://localhost:5173,http://localhost:5174
```

> Se quiser rodar o backend fora do Docker, copie também `Backend/.env.example` para `Backend/.env`.
> Veja [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) para a lista completa de variáveis e instruções detalhadas.

### 2. Desenvolvimento local

```bash
make install    # instala dependências (Backend e Frontend)
make dev        # sobe todos os containers em modo dev
```

Acesse:
- 🌐 **Frontend:** http://localhost:5173
- 🔌 **Backend API:** http://localhost:3001
- ❤️ **Health check:** http://localhost:3001/health

### 3. Primeiro sync (bootstrap)

Após subir o ambiente, execute o sync inicial para carregar os projetos:

```bash
# Sync incremental (para testes iniciais)
docker exec -it azurebridge-api npx tsx scripts/auto-sync.ts

# Bootstrap completo — carga histórica total (use na primeira instalação)
docker exec -it azurebridge-auto-sync sh -c "AUTO_SYNC_MODE=bootstrap npx tsx scripts/auto-sync.ts"
```

### 4. Produção

```bash
make build   # build das imagens Docker
make up      # sobe em modo produção
```

Acesse: http://localhost

---

## ⚙️ Comandos úteis

```bash
make help          # lista todos os comandos disponíveis
make logs          # acompanha logs de todos os containers
make down          # para todos os containers
make clean         # para e remove containers, volumes e imagens

make db-migrate    # executa migrations do banco
make db-studio     # abre o Prisma Studio (UI do banco)
make db-reset      # reseta o banco (somente desenvolvimento)

make test          # roda os testes do backend com cobertura
make lint          # roda ESLint e Prettier
```

---

## 📁 Estrutura do projeto

```
AzureBridge/
├── Backend/                  # API Node.js + TypeScript (Fastify)
│   ├── src/
│   │   ├── controllers/      # Handlers HTTP
│   │   ├── services/         # Lógica de negócio
│   │   ├── repositories/     # Acesso ao banco (Prisma)
│   │   ├── integrations/     # Clientes Azure DevOps
│   │   ├── jobs/             # Workers BullMQ
│   │   ├── cache/            # Camada Redis
│   │   └── routes/           # Definição de rotas
│   ├── prisma/               # Schema e migrations
│   └── scripts/              # Sync, backfill e manutenção
│
├── Frontend/                 # React 18 + Vite
│   └── src/
│       ├── features/         # Módulos por feature (dashboard)
│       ├── components/       # Componentes compartilhados
│       ├── services/         # API client e React Query hooks
│       └── stores/           # Estado global (Zustand)
│
├── docs/                     # Documentação técnica detalhada
├── docker-compose.yml        # Orquestração em produção
├── docker-compose.dev.yml    # Overrides para desenvolvimento
└── Makefile                  # Comandos de build e desenvolvimento
```

---

## 📚 Documentação

| Documento | Descrição |
|---|---|
| [📐 ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitetura detalhada, containers, fluxos de sync e decisões técnicas |
| [🔌 API.md](docs/API.md) | Referência completa da API REST com todos os endpoints |
| [🗄️ DATABASE.md](docs/DATABASE.md) | Schema completo do banco de dados e relacionamentos |
| [🚀 DEPLOYMENT.md](docs/DEPLOYMENT.md) | Guia de deployment, variáveis de ambiente e troubleshooting |
| [📖 USER-MANUAL.md](docs/USER-MANUAL.md) | Manual do usuário: como usar o dashboard e interpretar os indicadores |
| [⚙️ Backend/README.md](Backend/README.md) | Documentação técnica do backend |
| [🎨 Frontend/README.md](Frontend/README.md) | Documentação técnica do frontend |
| [🔄 scripts/README.md](Backend/scripts/README.md) | Scripts de sincronização e manutenção |

---

## 📄 Licença

MIT
