# 🔌 AzureBridge — Referência da API REST

> Documentação completa de todos os endpoints disponíveis na API do AzureBridge.

**Base URL:** `http://localhost:3001`

Todos os endpoints retornam **JSON**. Erros seguem o formato:

```json
{
  "error": "mensagem de erro",
  "statusCode": 400
}
```

---

## 📋 Índice

- [Health Check](#-health-check)
- [Projetos](#-projetos)
- [Sprints](#-sprints)
- [Work Items](#-work-items)
- [Sync](#-sync)
- [Dashboard](#-dashboard)
- [Códigos de status](#-códigos-de-status)

---

## ❤️ Health Check

### `GET /health`

Verifica a disponibilidade da API e a conexão com o banco de dados.

**Resposta `200`:**
```json
{
  "status": "ok",
  "database": "connected",
  "timestamp": "2026-02-11T12:00:00.000Z",
  "version": "2.0.0"
}
```

**Resposta `503`** — banco indisponível:
```json
{
  "error": "Database not ready",
  "statusCode": 503
}
```

---

## 🗂️ Projetos

### `GET /projects`

Lista todos os projetos sincronizados do Azure DevOps.

**Resposta `200`:**
```json
{
  "data": [
    {
      "id": "clxyz123",
      "azureId": "abc-def-123",
      "name": "Meu Projeto",
      "description": "Descrição do projeto",
      "state": "wellFormed",
      "visibility": 0,
      "lastSyncAt": "2026-02-11T10:00:00.000Z",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-02-11T10:00:00.000Z"
    }
  ]
}
```

---

### `GET /projects/:id`

Retorna os detalhes de um projeto específico.

**Parâmetros:**

| Param | Tipo | Descrição |
|---|---|---|
| `id` | path | ID interno do projeto (cuid) |

**Resposta `200`:**
```json
{
  "data": {
    "id": "clxyz123",
    "azureId": "abc-def-123",
    "name": "Meu Projeto",
    "description": "Descrição do projeto",
    "state": "wellFormed",
    "visibility": 0,
    "lastSyncAt": "2026-02-11T10:00:00.000Z"
  }
}
```

**Resposta `404`:**
```json
{ "error": "Project not found", "statusCode": 404 }
```

---

### `GET /projects/:id/stats`

Retorna estatísticas agregadas do projeto (sprints, work items, membros).

**Parâmetros:**

| Param | Tipo | Descrição |
|---|---|---|
| `id` | path | ID interno do projeto |

**Resposta `200`:**
```json
{
  "data": {
    "projectId": "clxyz123",
    "totalSprints": 12,
    "activeSprints": 1,
    "totalWorkItems": 450,
    "totalMembers": 8
  }
}
```

---

## 🏃 Sprints

### `GET /sprints`

Lista sprints com filtros opcionais.

**Query params:**

| Param | Tipo | Padrão | Descrição |
|---|---|---|---|
| `projectId` | string | — | Filtra por projeto |
| `state` | string | — | `Active`, `Past` ou `Future` |
| `limit` | number | 50 | Máximo de resultados |
| `offset` | number | 0 | Paginação |

**Resposta `200`:**
```json
[
  {
    "id": "clsprint1",
    "azureId": "sprint-azure-id",
    "name": "Sprint 45",
    "path": "Meu Projeto\\Sprint 45",
    "projectId": "clxyz123",
    "startDate": "2026-01-27T00:00:00.000Z",
    "endDate": "2026-02-07T00:00:00.000Z",
    "state": "Active",
    "timeFrame": "current",
    "totalPlannedHours": 120,
    "totalCompletedHours": 75,
    "totalRemainingHours": 45,
    "isOnTrack": true,
    "riskLevel": "low"
  }
]
```

---

### `GET /sprints/:id`

Retorna os detalhes de uma sprint específica.

**Parâmetros:**

| Param | Tipo | Descrição |
|---|---|---|
| `id` | path | ID interno da sprint |

**Resposta `200`:** mesmo schema do item da listagem acima.

---

### `GET /sprints/:id/burndown`

Retorna os dados de burndown da sprint (snapshots diários).

**Parâmetros:**

| Param | Tipo | Descrição |
|---|---|---|
| `id` | path | ID interno da sprint |

**Resposta `200`:**
```json
{
  "sprintId": "clsprint1",
  "raw": [
    {
      "id": "clsnap1",
      "sprintId": "clsprint1",
      "snapshotDate": "2026-01-27T00:00:00.000Z",
      "remainingWork": 120.0,
      "completedWork": 0.0,
      "totalWork": 120.0,
      "remainingPoints": 42,
      "completedPoints": 0,
      "totalPoints": 42,
      "todoCount": 15,
      "inProgressCount": 0,
      "doneCount": 0,
      "blockedCount": 0,
      "addedCount": 0,
      "removedCount": 0,
      "idealRemaining": 120.0
    }
  ]
}
```

> O array `raw` alimenta tanto o **Burndown Chart** quanto o **Cumulative Flow Diagram** no frontend.

---

### `GET /sprints/:sprintId/capacity/comparison`

Retorna a comparação entre capacidade disponível e trabalho planejado/realizado para cada membro da sprint.

**Parâmetros:**

| Param | Tipo | Descrição |
|---|---|---|
| `sprintId` | path | ID interno da sprint |

**Resposta `200`:**
```json
{
  "sprint": {
    "id": "clsprint1",
    "name": "Sprint 45"
  },
  "summary": {
    "totalAvailable": 160,
    "totalPlanned": 145,
    "totalPlannedInitial": 130,
    "totalPlannedCurrent": 145,
    "totalPlannedDelta": 15,
    "totalRemaining": 70,
    "totalCompleted": 75,
    "balance": 15,
    "utilization": 90.6,
    "unassigned": {
      "items": 3,
      "totalHours": 12
    },
    "dayOffDates": ["2026-02-03"]
  },
  "byMember": [
    {
      "member": {
        "id": "clmember1",
        "displayName": "João Silva",
        "uniqueName": "joao.silva@empresa.com",
        "imageUrl": "https://..."
      },
      "capacity": {
        "available": 40,
        "total": 48,
        "daysOff": []
      },
      "planned": 38,
      "remaining": 18,
      "completed": 20,
      "completionPct": 50,
      "remainingToCapacity": 20,
      "overCapacity": 0
    }
  ]
}
```

---

## 📋 Work Items

### `GET /work-items`

Lista work items com filtros.

**Query params:**

| Param | Tipo | Descrição |
|---|---|---|
| `projectId` | string | Filtra por projeto |
| `sprintId` | string | Filtra por sprint |
| `type` | string | `Product Backlog Item`, `Task`, `Bug`, `Feature`, `Epic` |
| `state` | string | `New`, `To Do`, `In Progress`, `Done`, etc. |
| `assignedToId` | string | Filtra por membro |
| `isBlocked` | boolean | Retorna apenas bloqueados |
| `limit` | number | Máximo de resultados (padrão: `100`) |
| `offset` | number | Paginação |

**Resposta `200`:**
```json
{
  "data": [
    {
      "id": 1234,
      "azureId": 1234,
      "projectId": "clxyz123",
      "sprintId": "clsprint1",
      "type": "Task",
      "state": "In Progress",
      "title": "Implementar autenticação",
      "priority": 2,
      "originalEstimate": 8,
      "completedWork": 3,
      "remainingWork": 5,
      "isBlocked": false,
      "tags": ["backend", "auth"],
      "assignedTo": {
        "id": "clmember1",
        "displayName": "João Silva"
      },
      "changedDate": "2026-02-10T14:30:00.000Z"
    }
  ],
  "total": 145,
  "limit": 100,
  "offset": 0
}
```

---

### `GET /work-items/blocked`

Retorna todos os work items com `isBlocked = true` no momento.

**Resposta `200`:**
```json
[
  {
    "id": 5678,
    "azureId": 5678,
    "title": "Deploy bloqueado por dependência externa",
    "type": "Task",
    "state": "In Progress",
    "isBlocked": true,
    "changedDate": "2026-02-09T09:00:00.000Z",
    "assignedTo": {
      "displayName": "Maria Santos"
    }
  }
]
```

---

### `GET /work-items/:id`

Retorna os detalhes completos de um work item.

**Parâmetros:**

| Param | Tipo | Descrição |
|---|---|---|
| `id` | path | ID do work item (número Azure) |

**Resposta `200`:** objeto completo com todos os campos do modelo WorkItem (ver [DATABASE.md](DATABASE.md)).

---

### `GET /work-items/:id/hierarchy`

Retorna o work item com seus filhos (ex: PBI com Tasks e Bugs).

**Parâmetros:**

| Param | Tipo | Descrição |
|---|---|---|
| `id` | path | ID do work item pai |

**Resposta `200`:**
```json
{
  "id": 100,
  "title": "PBI: Módulo de autenticação",
  "type": "Product Backlog Item",
  "children": [
    {
      "id": 101,
      "title": "Task: Backend JWT",
      "type": "Task",
      "state": "Done",
      "remainingWork": 0
    },
    {
      "id": 102,
      "title": "Task: Frontend login page",
      "type": "Task",
      "state": "In Progress",
      "remainingWork": 4
    }
  ]
}
```

---

## 🔄 Sync

### `POST /sync/full`

Dispara uma sincronização completa de todos os projetos.

> ⚠️ Operação intensiva — evite chamar com frequência. Prefira o sync incremental.

**Body (opcional):**
```json
{
  "projectId": "clxyz123"
}
```

Se `projectId` não for informado, sincroniza todos os projetos.

**Resposta `200`:**
```json
{
  "message": "Full sync triggered",
  "jobId": "sync-job-123"
}
```

---

### `POST /sync/incremental`

Dispara um sync incremental, buscando apenas work items alterados desde o último sync.

**Body (opcional):**
```json
{
  "projectId": "clxyz123"
}
```

**Resposta `200`:**
```json
{
  "message": "Incremental sync triggered",
  "jobId": "sync-job-456"
}
```

---

## 📊 Dashboard

### `GET /dashboard/overview`

Retorna uma visão consolidada com estatísticas globais de todos os projetos.

**Resposta `200`:**
```json
{
  "totalProjects": 5,
  "activeSprints": 3,
  "totalBlockers": 7,
  "totalMembers": 24,
  "lastSyncAt": "2026-02-11T10:00:00.000Z"
}
```

---

### `GET /dashboard/current-sprints`

Retorna todas as sprints ativas com suas métricas resumidas.

**Resposta `200`:**
```json
[
  {
    "id": "clsprint1",
    "name": "Sprint 45",
    "projectName": "Meu Projeto",
    "startDate": "2026-01-27T00:00:00.000Z",
    "endDate": "2026-02-07T00:00:00.000Z",
    "totalPlannedHours": 120,
    "totalRemainingHours": 45,
    "healthScore": 82,
    "isOnTrack": true
  }
]
```

---

### `GET /dashboard/alerts`

Retorna os alertas ativos (sprint em risco, blockers, sobrecarga de capacidade, scope creep).

**Query params:**

| Param | Tipo | Descrição |
|---|---|---|
| `projectId` | string | Filtra por projeto |
| `severity` | string | `low`, `medium`, `high`, `critical` |
| `type` | string | `sprint_risk`, `blocked_item`, `capacity_overload`, `scope_creep` |

**Resposta `200`:**
```json
[
  {
    "id": "clalert1",
    "type": "sprint_risk",
    "severity": "high",
    "title": "Sprint em risco de não entrega",
    "message": "A sprint está 25% atrasada em relação ao ideal",
    "projectId": "clxyz123",
    "sprintId": "clsprint1",
    "status": "active",
    "detectedAt": "2026-02-10T08:00:00.000Z"
  }
]
```

---

## 📌 Códigos de status

| Código | Significado |
|---|---|
| `200` | ✅ Sucesso |
| `400` | ❌ Parâmetros inválidos |
| `404` | 🔍 Recurso não encontrado |
| `429` | ⏱️ Rate limit excedido |
| `500` | 💥 Erro interno do servidor |
| `503` | 🔌 Serviço indisponível (banco offline) |
