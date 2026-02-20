# 🎨 AzureBridge — Frontend

> Interface web do AzureBridge, construída em React 18 com TypeScript e TailwindCSS.

---

## 📋 Índice

- [Stack](#️-stack)
- [Estrutura de diretórios](#-estrutura-de-diretórios)
- [Variáveis de ambiente](#️-variáveis-de-ambiente)
- [Comandos](#-comandos)
- [Data fetching](#-data-fetching)
- [Componentes do Dashboard](#-componentes-do-dashboard)
- [Estado global](#-estado-global)
- [Build e Docker](#-build-e-docker)

---

## 🛠️ Stack

| Tecnologia | Uso |
|---|---|
| **React 18** + TypeScript | UI e linguagem |
| **Vite 5** | Bundler e dev server |
| **TailwindCSS 3** + **shadcn/ui** | Estilização e componentes |
| **Recharts 2** | Gráficos e visualizações |
| **TanStack Query 5** | Data fetching e cache |
| **Zustand 4** | Estado global |
| **Axios** | Cliente HTTP |
| **Zod** | Validação |
| **date-fns** | Utilitários de data |
| **lucide-react** | Ícones |

---

## 📁 Estrutura de diretórios

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
│   └── queries/
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

---

## ⚙️ Variáveis de ambiente

Crie um arquivo `.env` na pasta `Frontend/` com base no `.env.example`:

```env
VITE_API_URL=http://localhost:3001
VITE_API_VERSION=v1
VITE_AZURE_DEVOPS_ORG_URL=https://dev.azure.com/sua-organizacao
```

| Variável | Obrigatória | Padrão | Descrição |
|---|:---:|---|---|
| `VITE_API_URL` | ✅ | — | URL base do backend |
| `VITE_API_VERSION` | — | `v1` | Versão da API |
| `VITE_AZURE_DEVOPS_ORG_URL` | — | — | URL da organização Azure DevOps (para links no Work Item Aging) |
| `VITE_ENABLE_ANALYTICS` | — | `true` | Habilita analytics |
| `VITE_ENABLE_REPORTS` | — | `true` | Habilita relatórios |
| `VITE_ENABLE_WIKI` | — | `true` | Habilita wiki |
| `VITE_ENABLE_DEVTOOLS` | — | `true` (dev) | Habilita devtools |
| `VITE_LOG_LEVEL` | — | `debug` (dev) | Nível de log |

> Em produção, o Nginx do container faz proxy das chamadas à API. Ver [nginx.conf](nginx.conf).

---

## 🚀 Comandos

```bash
npm install         # instala dependências

npm run dev         # dev server em http://localhost:5173
npm run build       # build de produção para dist/
npm run preview     # preview do build de produção

npm run type-check  # checagem de tipos sem compilar
npm run lint        # ESLint
npm run format      # Prettier
```

---

## 📡 Data fetching

Todos os dados do dashboard são carregados via React Query. O cache é gerenciado automaticamente:

| Hook | Endpoint | Atualização | Descrição |
|---|---|---|---|
| `useSprints` | `GET /sprints` | 30s | Lista sprints (filtrável por estado) |
| `useSprintBurndown` | `GET /sprints/:id/burndown` | 60s | Dados de burndown e snapshots |
| `useCapacityComparison` | `GET /sprints/:id/capacity/comparison` | 60s | Capacidade vs planejado por membro |
| `useWorkItems` | `GET /work-items` | — | Lista work items com filtros |
| `useBlockedWorkItems` | `GET /work-items/blocked` | — | Work items bloqueados |

---

## 🧩 Componentes do Dashboard

| Componente | Localização | Descrição |
|---|---|---|
| `StatCard` | components/ | Cards de métricas no topo (capacidade, planejamento, restante, concluído, impedimentos) |
| `SprintHealthCard` | components/ | Score de saúde da sprint (0-100) com lista de penalidades |
| `BlockersAlert` | components/ | Painel de work items bloqueados com tempo de bloqueio |
| `CapacityTable` | components/ | Tabela de capacidade vs planejado por membro |
| `MemberCapacityProgress` | components/ | Barras horizontais empilhadas por pessoa |
| `WorkItemAgingCard` | components/ | Aging de Tasks em progresso com modal de detalhes |
| `BurndownChart` | charts/ | Burndown interativo: ideal piecewise, remaining, projeção, scope bars, concluído por dia |
| `CumulativeFlowChart` | charts/ | CFD com 4 camadas empilhadas (Done, Blocked, In Progress, To Do) |
| `WorkItemsByStateChart` | charts/ | Donut de work items por estado |
| `WorkItemsByTypeChart` | charts/ | Donut de work items por tipo |
| `WorkItemsByMemberChart` | charts/ | Donut de work items por responsável |
| `ServerCheck` | common/ | Health check de conexão com o backend na inicialização |

---

## 🗂️ Estado global

O `appStore` (Zustand) mantém apenas:

| Estado | Tipo | Descrição |
|---|---|---|
| `selectedProjectId` | string | Projeto atualmente selecionado no seletor do dashboard |

---

## 🐳 Build e Docker

```bash
# Build de produção
npm run build

# Build da imagem Docker
docker build -t azurebridge-web .
```

O container serve o frontend via Nginx na porta 80. O `nginx.conf` inclui proxy reverso para a API e configuração de SPA (fallback para `index.html`).

Para mais informações sobre a interface do usuário, consulte o [Manual do Usuário](../docs/USER-MANUAL.md).
