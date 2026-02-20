# 🗄️ AzureBridge — Schema do Banco de Dados

> PostgreSQL 16 gerenciado via Prisma ORM. Schema completo em [`Backend/prisma/schema.prisma`](../Backend/prisma/schema.prisma).

---

## 📋 Índice

- [Visão geral dos relacionamentos](#-visão-geral-dos-relacionamentos)
- [Modelos](#-modelos)
  - [projects](#-projects)
  - [team_members](#-team_members)
  - [team_capacities](#-team_capacities)
  - [sprints](#-sprints)
  - [sprint_snapshots](#-sprint_snapshots)
  - [work_items](#-work_items)
  - [work_item_revisions](#-work_item_revisions)
  - [work_item_comments](#-work_item_comments)
  - [metric_snapshots](#-metric_snapshots)
  - [alerts](#-alerts)
  - [user_preferences](#-user_preferences)
  - [sync_logs](#-sync_logs)
- [Migrations](#-migrations)

---

## 🔗 Visão geral dos relacionamentos

```
Project
  ├── Sprint[]
  │     ├── WorkItem[]
  │     ├── TeamCapacity[]
  │     ├── SprintSnapshot[]    ← burndown + CFD histórico
  │     └── Alert[]
  ├── WorkItem[]
  ├── TeamMember[]
  │     ├── TeamCapacity[]
  │     └── WorkItem[] (assigned)
  ├── MetricSnapshot[]
  └── Alert[]

WorkItem
  ├── WorkItemRevision[]        ← histórico de mudanças
  └── WorkItemComment[]
```

---

## 📊 Modelos

### 🏢 `projects`

Representa um projeto do Azure DevOps.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | String (cuid) | ✅ | ID interno gerado automaticamente |
| `azureId` | String (unique) | ✅ | ID do projeto no Azure DevOps |
| `name` | String | ✅ | Nome do projeto |
| `description` | String | — | Descrição do projeto |
| `state` | String | ✅ | `wellFormed`, `deleting`, etc. |
| `visibility` | Int | ✅ | `0` = privado, `1` = público |
| `lastSyncAt` | DateTime | — | Data/hora da última sincronização |

---

### 👥 `team_members`

Membros do time, agrupados por projeto.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | String (cuid) | ✅ | ID interno |
| `azureId` | String | ✅ | ID do membro no Azure |
| `displayName` | String | ✅ | Nome de exibição |
| `uniqueName` | String | ✅ | Email (identificador único no Azure) |
| `imageUrl` | String | — | URL do avatar |
| `role` | String | — | Ex: `Developer`, `Tester`, `PO`, `SM` |
| `isActive` | Boolean | ✅ | Se o membro está ativo |
| `projectId` | String | ✅ | Projeto ao qual pertence |

> Constraint: `(azureId, projectId)` é único — o mesmo membro pode estar em múltiplos projetos.

---

### 📅 `team_capacities`

Capacidade planejada de cada membro em cada sprint.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | String (cuid) | ✅ | ID interno |
| `memberId` | String | ✅ | Referência ao `TeamMember` |
| `sprintId` | String | ✅ | Referência à `Sprint` |
| `totalHours` | Float | ✅ | Horas teóricas (8h × dias úteis) |
| `availableHours` | Float | ✅ | Horas disponíveis (descontando dias off) |
| `allocatedHours` | Float | ✅ | Horas alocadas em work items |
| `daysOff` | Json | — | Lista de dias off com motivo |
| `activitiesPerDay` | Json | — | Horas por atividade por dia |

**Formato `daysOff`:**
```json
[
  { "date": "2026-02-03", "reason": "Feriado" },
  { "date": "2026-02-10", "reason": "Férias" }
]
```

**Formato `activitiesPerDay`:**
```json
{ "Development": 6, "Testing": 2 }
```

> Constraint: `(memberId, sprintId)` é único.

---

### 🏃 `sprints`

Sprint de um projeto Azure DevOps.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | String (cuid) | ✅ | ID interno |
| `azureId` | String (unique) | ✅ | ID da sprint no Azure |
| `name` | String | ✅ | Nome da sprint (ex: `Sprint 45`) |
| `path` | String | ✅ | Caminho completo (ex: `Projeto\Sprint 45`) |
| `projectId` | String | ✅ | Projeto ao qual pertence |
| `startDate` | DateTime | ✅ | Data de início |
| `endDate` | DateTime | ✅ | Data de fim |
| `state` | String | ✅ | `Active`, `Past`, `Future` |
| `timeFrame` | String | ✅ | `current`, `past`, `future` |
| `totalPlannedHours` | Float | — | Total de horas planejadas (cache) |
| `totalCompletedHours` | Float | — | Total concluído (cache) |
| `totalRemainingHours` | Float | — | Total restante (cache) |
| `totalStoryPoints` | Int | — | Story points totais |
| `completedStoryPoints` | Int | — | Story points concluídos |
| `teamCapacityHours` | Float | — | Capacidade total do time |
| `commitmentHours` | Float | — | Horas comprometidas |
| `isOnTrack` | Boolean | ✅ | Se a sprint está no prazo |
| `riskLevel` | String | — | `low`, `medium`, `high`, `critical` |

---

### 📸 `sprint_snapshots`

Snapshot diário do estado de uma sprint. Usado para construir o **burndown histórico** e o **CFD**.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | String (cuid) | ✅ | ID interno |
| `sprintId` | String | ✅ | Sprint relacionada |
| `snapshotDate` | DateTime | ✅ | Data do snapshot (1 por dia útil) |
| `remainingWork` | Float | ✅ | Horas restantes no dia |
| `completedWork` | Float | ✅ | Horas concluídas no dia |
| `totalWork` | Float | ✅ | Total de horas (restante + concluído) |
| `remainingPoints` | Int | ✅ | Story points restantes |
| `completedPoints` | Int | ✅ | Story points concluídos |
| `totalPoints` | Int | ✅ | Total de story points |
| `todoCount` | Int | ✅ | Qtd de itens em "To Do" |
| `inProgressCount` | Int | ✅ | Qtd de itens em "In Progress" |
| `doneCount` | Int | ✅ | Qtd de itens em "Done" |
| `blockedCount` | Int | ✅ | Qtd de itens bloqueados |
| `addedCount` | Int | ✅ | Itens adicionados nesse dia (scope creep) |
| `removedCount` | Int | ✅ | Itens removidos nesse dia |
| `idealRemaining` | Float | — | Valor ideal do burndown nesse dia |

> Constraint: `(sprintId, snapshotDate)` é único. Tipos contáveis (Task, Bug, Test Case) são os únicos considerados nos counters CFD.

---

### 📋 `work_items`

Work item do Azure DevOps (Task, Bug, PBI, Feature, Epic).

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | Int | ✅ | ID interno (igual ao `azureId`) |
| `azureId` | Int (unique) | ✅ | ID no Azure DevOps |
| `projectId` | String | ✅ | Projeto |
| `sprintId` | String | — | Sprint atual (`null` = backlog) |
| `parentId` | Int | — | ID do work item pai (hierarquia) |
| `type` | String | ✅ | `Product Backlog Item`, `Task`, `Bug`, `Feature`, `Epic` |
| `state` | String | ✅ | `New`, `Approved`, `Committed`, `To Do`, `In Progress`, `Done`, `Removed` |
| `title` | String | ✅ | Título |
| `description` | String | — | Descrição completa |
| `acceptanceCriteria` | String | — | Critérios de aceite (PBIs) |
| `reproSteps` | String | — | Passos para reproduzir (Bugs) |
| `assignedToId` | String | — | Membro responsável |
| `originalEstimate` | Float | — | Estimativa original em horas |
| `completedWork` | Float | — | Horas concluídas |
| `remainingWork` | Float | — | Horas restantes |
| `initialRemainingWork` | Float | — | Primeira estimativa registrada no histórico |
| `lastRemainingWork` | Float | — | Último `remainingWork` registrado |
| `doneRemainingWork` | Float | — | `remainingWork` quando ficou "Done" |
| `storyPoints` | Int | — | Story points (PBIs) |
| `effort` | Int | — | Esforço (Features/Epics) |
| `priority` | Int | — | `1` = maior prioridade, `4` = menor |
| `severity` | String | — | `1 - Critical` até `4 - Low` (Bugs) |
| `isBlocked` | Boolean | ✅ | Se está impedido |
| `isDelayed` | Boolean | ✅ | Se está atrasado |
| `isRemoved` | Boolean | ✅ | Se foi removido da sprint |
| `createdDate` | DateTime | ✅ | Data de criação |
| `changedDate` | DateTime | ✅ | Data da última alteração |
| `activatedDate` | DateTime | — | Data em que foi movido para "In Progress" (usado pelo CFD e Aging) |
| `closedDate` | DateTime | — | Data em que foi concluído (recuperado via revisões Azure DevOps) |
| `resolvedDate` | DateTime | — | Data de resolução |
| `stateChangeDate` | DateTime | — | Data da última mudança de estado |
| `tags` | String[] | ✅ | Tags do Azure |
| `areaPath` | String | ✅ | Área do projeto |
| `iterationPath` | String | ✅ | Iteração (sprint) no Azure |
| `commentCount` | Int | ✅ | Quantidade de comentários |
| `attachmentCount` | Int | ✅ | Quantidade de anexos |

---

### 📜 `work_item_revisions`

Histórico de mudanças de um work item.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | String (cuid) | ✅ | ID interno |
| `workItemId` | Int | ✅ | Work item relacionado |
| `rev` | Int | ✅ | Número da revisão |
| `revisedDate` | DateTime | ✅ | Data da mudança |
| `revisedBy` | String | ✅ | Quem realizou a mudança |
| `changes` | Json | ✅ | Campos alterados com valores antigo/novo |
| `changedFields` | String[] | ✅ | Lista dos campos alterados |

**Formato `changes`:**
```json
{
  "System.State": {
    "oldValue": "To Do",
    "newValue": "In Progress"
  },
  "Microsoft.VSTS.Scheduling.RemainingWork": {
    "oldValue": 8,
    "newValue": 5
  }
}
```

---

### 💬 `work_item_comments`

Comentários e discussões em work items.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | String (cuid) | ✅ | ID interno |
| `azureId` | Int | ✅ | ID do comentário no Azure |
| `workItemId` | Int | ✅ | Work item relacionado |
| `text` | String | ✅ | Conteúdo do comentário |
| `createdBy` | String | ✅ | Autor |
| `createdDate` | DateTime | ✅ | Data de criação |

---

### 📈 `metric_snapshots`

Snapshots de métricas calculadas (velocity, cycle time, lead time, throughput).

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | String (cuid) | ✅ | ID interno |
| `projectId` | String | ✅ | Projeto |
| `sprintId` | String | — | Sprint relacionada |
| `metricType` | String | ✅ | `velocity`, `cycle_time`, `lead_time`, `throughput`, `burndown`, `cfd` |
| `period` | String | ✅ | Ex: `sprint_45`, `2026-01`, `2026-Q1` |
| `periodStart` | DateTime | ✅ | Início do período |
| `periodEnd` | DateTime | ✅ | Fim do período |
| `value` | Float | ✅ | Valor principal da métrica |
| `metadata` | Json | ✅ | Dados detalhados (varia por tipo) |

**Exemplo `metadata` para `velocity`:**
```json
{ "completedPoints": 42, "completedItems": 18, "velocity": 42 }
```

**Exemplo `metadata` para `cycle_time`:**
```json
{ "avg": 5.2, "median": 4.5, "p90": 8.3, "data": [3, 5, 4, 8, 6] }
```

---

### 🚨 `alerts`

Alertas gerados automaticamente pelo sistema.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | String (cuid) | ✅ | ID interno |
| `projectId` | String | ✅ | Projeto |
| `sprintId` | String | — | Sprint relacionada |
| `workItemId` | Int | — | Work item relacionado |
| `type` | String | ✅ | `sprint_risk`, `blocked_item`, `capacity_overload`, `delayed_item`, `scope_creep` |
| `severity` | String | ✅ | `low`, `medium`, `high`, `critical` |
| `title` | String | ✅ | Título do alerta |
| `message` | String | ✅ | Mensagem detalhada |
| `status` | String | ✅ | `active`, `acknowledged`, `resolved`, `dismissed` |
| `detectedAt` | DateTime | ✅ | Quando foi detectado |

---

### ⚙️ `user_preferences`

Preferências de UI por usuário.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | String (cuid) | ✅ | ID interno |
| `userId` | String (unique) | ✅ | Email ou Azure ID |
| `theme` | String | ✅ | `light`, `dark`, `auto` |
| `dashboardLayout` | Json | — | Layout customizado |
| `favoriteProjects` | String[] | ✅ | Projetos favoritos |
| `savedFilters` | Json | — | Filtros salvos |

---

### 🔄 `sync_logs`

Registro de execuções de sincronização.

| Campo | Tipo | Obrigatório | Descrição |
|---|---|:---:|---|
| `id` | String (cuid) | ✅ | ID interno |
| `projectId` | String | — | Projeto sincronizado (`null` = todos) |
| `syncType` | String | ✅ | `full_sync`, `incremental_sync`, `work_items`, `sprints`, `team` |
| `status` | String | ✅ | `started`, `running`, `completed`, `failed` |
| `itemsProcessed` | Int | ✅ | Total de itens processados |
| `itemsCreated` | Int | ✅ | Itens criados |
| `itemsUpdated` | Int | ✅ | Itens atualizados |
| `itemsFailed` | Int | ✅ | Itens com erro |
| `startedAt` | DateTime | ✅ | Início da execução |
| `completedAt` | DateTime | — | Fim da execução |
| `duration` | Int | — | Duração em segundos |
| `error` | String | — | Mensagem de erro (se falhou) |

---

## 🔧 Migrations

As migrations ficam em `Backend/prisma/migrations/`. Para aplicar:

```bash
# Desenvolvimento
npm run db:migrate

# Produção
npm run db:migrate:prod

# Visualizar o banco via UI
npm run db:studio
```
