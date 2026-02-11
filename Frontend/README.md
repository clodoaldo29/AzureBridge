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
│       │   └── StatCard.tsx
│       └── charts/
│           └── BurndownChart.tsx
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
│   └── queries/                # Hooks React Query
│       ├── capacity.ts         # useCapacityComparison
│       ├── sprints.ts          # useSprints, useSprintBurndown
│       └── workItems.ts        # useBlockedWorkItems
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
```

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
| `useSprintBurndown` | `GET /sprints/:id/burndown` | Dados de burndown da sprint |
| `useCapacityComparison` | `GET /sprints/:id/capacity/comparison` | Capacidade vs planejado |
| `useBlockedWorkItems` | `GET /work-items/blocked` | Work items bloqueados |

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
