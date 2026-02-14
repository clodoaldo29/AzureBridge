# AzureBridge — Frontend

Interface web do AzureBridge, construída em React com TypeScript.

## Stack

- **React 18** + TypeScript
- **Vite** — bundler e dev server
- **TailwindCSS** + **shadcn/ui** — estilização e componentes
- **Recharts** — gráficos e visualizações
- **TanStack Query (React Query)** — data fetching e cache
- **Zustand** — estado global
- **Axios** — cliente HTTP
- **Zod** — validação
- **date-fns** — utilitários de data

## Estrutura de diretórios

```
src/
├── main.tsx                    # Entry point React
├── App.tsx                     # Roteamento principal
│
├── features/                   # Módulos por feature
│   └── dashboard/
│       ├── pages/
│       │   └── Dashboard.tsx   # Página principal do dashboard
│       ├── components/         # Componentes exclusivos do dashboard
│       │   ├── BlockersAlert.tsx
│       │   ├── CapacityTable.tsx
│       │   ├── MemberCapacityProgress.tsx
│       │   ├── SprintHealthCard.tsx
│       │   ├── StatCard.tsx
│       │   └── WorkItemAgingCard.tsx
│       ├── charts/
│       │   ├── BurndownChart.tsx
│       │   ├── CumulativeFlowChart.tsx
│       │   ├── WorkItemsByMemberChart.tsx
│       │   ├── WorkItemsByStateChart.tsx
│       │   └── WorkItemsByTypeChart.tsx
│       └── queries/
│           ├── sprints.ts          # useSprints, useSprintBurndown
│           └── workItems.ts        # useWorkItems, useBlockedWorkItems
│
├── components/                 # Componentes compartilhados
│   ├── layout/
│   │   ├── AppLayout.tsx       # Layout raiz com sidebar e header
│   │   ├── Header.tsx
│   │   └── Sidebar.tsx
│   ├── common/
│   │   └── ServerCheck.tsx     # Health check de conexão com API
│   └── ui/                     # Primitivos shadcn/ui
│       ├── avatar.tsx
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── progress.tsx
│       ├── select.tsx
│       ├── toast.tsx
│       └── toaster.tsx
│
├── services/
│   ├── api.ts                  # Instância Axios configurada
│   └── queries/                # Hooks React Query (legado, migrado para features/)
│       └── capacity.ts         # useCapacityComparison
│
├── stores/
│   └── appStore.ts             # Estado global: projeto selecionado
│
├── hooks/
│   └── use-toast.ts            # Hook de notificações toast
│
├── types/
│   └── index.ts                # Tipos TypeScript do domínio
│
└── utils/
    ├── calculations.ts         # Sprint Health Score, cálculos de capacidade
    ├── formatters.ts           # Formatação de horas, datas, percentuais
    └── cn.ts                   # Utilitário clsx + tailwind-merge
```

## Variáveis de ambiente

Crie um arquivo `.env` na pasta `Frontend/` com base no `.env.example`:

```env
VITE_API_URL=http://localhost:3001
VITE_API_VERSION=v1
VITE_AZURE_DEVOPS_ORG_URL=https://dev.azure.com/sua-organizacao
```

| Variável | Obrigatória | Descrição |
|---|---|---|
| `VITE_API_URL` | Sim | URL base do backend |
| `VITE_API_VERSION` | Não | Versão da API (default: v1) |
| `VITE_AZURE_DEVOPS_ORG_URL` | Não | URL da organização Azure DevOps (para links no Work Item Aging) |
| `VITE_ENABLE_ANALYTICS` | Não | Habilita analytics (default: true) |
| `VITE_ENABLE_REPORTS` | Não | Habilita relatórios (default: true) |
| `VITE_ENABLE_WIKI` | Não | Habilita wiki (default: true) |
| `VITE_ENABLE_DEVTOOLS` | Não | Habilita devtools (default: true em dev) |
| `VITE_LOG_LEVEL` | Não | Nível de log (default: debug em dev) |

Em produção, o Nginx do container serve o frontend e faz proxy das chamadas à API. Ver [nginx.conf](nginx.conf).

## Rodando localmente

```bash
npm install
npm run dev       # dev server em http://localhost:5173
```

Outros comandos:

```bash
npm run build      # build de produção para dist/
npm run preview    # preview do build de produção
npm run type-check # checagem de tipos sem compilar
npm run lint       # ESLint
npm run format     # Prettier
```

## Data fetching

Todos os dados do dashboard são carregados via React Query com os hooks em `src/services/queries/`. O cache é gerenciado automaticamente:

| Hook | Endpoint | Descrição |
|---|---|---|
| `useSprints` | `GET /sprints` | Lista sprints (filtrável por estado) |
| `useSprintBurndown` | `GET /sprints/:id/burndown` | Dados de burndown e snapshots da sprint |
| `useCapacityComparison` | `GET /sprints/:id/capacity/comparison` | Capacidade vs planejado por membro |
| `useWorkItems` | `GET /work-items` | Lista work items com filtros (sprintId, type, state, limit) |
| `useBlockedWorkItems` | `GET /work-items/blocked` | Work items bloqueados |

## Componentes do Dashboard

| Componente | Pasta | Descrição |
|---|---|---|
| `StatCard` | components/ | Cards de métricas no topo (capacidade, planejamento, restante, concluído, impedimentos) |
| `SprintHealthCard` | components/ | Score de saúde da sprint (0-100) com penalidades |
| `BlockersAlert` | components/ | Painel de work items bloqueados |
| `CapacityTable` | components/ | Tabela capacidade vs planejado por membro |
| `MemberCapacityProgress` | components/ | Gráfico de barras horizontais empilhadas por pessoa |
| `WorkItemAgingCard` | components/ | Aging de Tasks em progresso com modal de detalhes |
| `BurndownChart` | charts/ | Burndown interativo com ideal, remaining, projeção, scope creep/remoção e concluído por dia |
| `CumulativeFlowChart` | charts/ | CFD com 4 camadas empilhadas (Done, Blocked, InProgress, ToDo) |
| `WorkItemsByStateChart` | charts/ | Donut de work items por estado |
| `WorkItemsByTypeChart` | charts/ | Donut de work items por tipo |
| `WorkItemsByMemberChart` | charts/ | Donut de work items por responsável |
| `ServerCheck` | common/ | Health check de conexão com o backend na inicialização |

## Estado global

O `appStore` (Zustand) mantém apenas:

- `selectedProjectId` — projeto atualmente selecionado no seletor do dashboard

## Build e Docker

```bash
# Build de produção
npm run build

# Build da imagem Docker
docker build -t azurebridge-web .
```

O container serve o frontend via Nginx na porta 80. O `nginx.conf` inclui proxy reverso para a API e configuração de SPA (fallback para `index.html`).

Para mais informações sobre a interface do usuário, consulte o [Manual do Usuário](../docs/USER-MANUAL.md).
