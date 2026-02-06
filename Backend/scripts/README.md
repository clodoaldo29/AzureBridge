# Scripts de Teste e Sincronização

Este diretório contém scripts utilitários para teste e sincronização do AzureBridge.

## 📁 Estrutura

```
scripts/
├── sync/              # Scripts de sincronização
│   └── complete-massive-sync.js
└── discovery/         # Scripts de descoberta/teste
    ├── discover-all-projects-sprints.js
    └── test-classification-nodes.js
```

## 🔄 Scripts de Sincronização

### Estratégia de Sincronização

#### 1️⃣ Full Sync (Sync Completo) - **Uma vez**
- **Quando**: Primeira vez ou reset completo do banco
- **O que faz**: Sincroniza TUDO (projetos, sprints, work items)
- **Duração**: 1-2 horas
- **Frequência**: Apenas quando necessário

#### 2️⃣ Incremental Sync - **Rotina diária**
- **Quando**: Diariamente ou a cada X horas
- **O que faz**: Sincroniza apenas mudanças desde último sync
- **Duração**: Segundos a poucos minutos
- **Frequência**: Automático (cron job, scheduled task)

---

### `sync/complete-massive-sync.js`
**Script principal de sincronização completa** ⭐

Sincroniza TODOS os dados do Azure DevOps:
- Todos os projetos (7)
- Todas as sprints (58)
- Todos os work items (milhares)

**Como usar:**
```bash
node scripts/sync/complete-massive-sync.js
```

**Características:**
- ✅ Processamento em lotes (100 items/batch)
- ✅ Delay de 500ms entre batches
- ✅ Sincronização automática de projetos, sprints e work items
- ✅ Estatísticas detalhadas por projeto
- ⏱️ Duração estimada: 1-2 horas
- 🔄 **Use apenas na primeira vez ou reset completo**

**Saída esperada:**
```
🚀 COMPLETE MASSIVE SYNC - All Projects, All Sprints, All Work Items
═══════════════════════════════════════════════════════════

✅ Found 7 projects in Azure DevOps

🏢 PROJECT: GIGA - Tempos e Movimentos
  ✅ Found 28 sprints
  ✅ Synced 28 sprints to database
  📋 Sprint: Sprint 1 (past)
     Found 82 work items
     ✅ Saved 82 items
  ...
✅ PROJECT COMPLETED: 2374 work items

🎉 COMPLETE MASSIVE SYNC FINISHED!
📊 Overall Results:
   Projects: 7
   Sprints: 58
   Work Items: 3000+
   Duration: 60m 30s
```

---

### `sync/incremental-sync.js`
**Sincronização incremental (rotina)** 🚀

Sincroniza apenas work items alterados desde o último sync:
- ✅ Busca apenas mudanças recentes
- ✅ Atualiza work items existentes
- ✅ Adiciona novos work items
- ✅ Muito mais rápido que full sync

**Como usar:**
```bash
node scripts/sync/incremental-sync.js
```

**Características:**
- ✅ Consulta apenas work items com `ChangedDate >= lastSync`
- ✅ Processamento em lotes (100 items/batch)
- ✅ Registra histórico no `SyncLog`
- ✅ Identifica novos vs atualizados
- ⏱️ Duração: Segundos a poucos minutos

**Saída esperada:**
```
🔄 Starting Incremental Sync...

📅 Syncing changes since: 2026-02-06T10:00:00.000Z

✅ Found 7 projects in database

🏢 PROJECT: GIGA - Tempos e Movimentos
Found 15 changed work items
Batch 1/1: Fetching 15 items...
✅ Processed 15/15 items
✅ Project completed: 12 updated, 3 new

═══════════════════════════════════════════════════════════
✅ INCREMENTAL SYNC COMPLETED!
═══════════════════════════════════════════════════════════

📊 Results:
   Updated: 45 work items
   New: 8 work items
   Total: 53 work items
   Duration: 12s
```

**Agendamento Recomendado:**
```bash
# Linux/Mac (crontab)
# Executar a cada 4 horas
0 */4 * * * cd /path/to/Backend && node scripts/sync/incremental-sync.js

# Windows (Task Scheduler)
# Criar tarefa agendada para executar a cada 4 horas
```

---

### `sync/sync-hierarchy.js`
**Sincronização de hierarquia parent-child** 🔗

Sincroniza relações parent-child do Azure DevOps:
- ✅ Busca relações de todos os work items
- ✅ Atualiza `parentId` no banco
- ✅ Permite visualização hierárquica (PBI → Task/Bug)
- ✅ Necessário apenas uma vez após full sync

**Como usar:**
```bash
node scripts/sync/sync-hierarchy.js
```

**Características:**
- ✅ Processa work items em batches de 50
- ✅ Delay de 1s entre batches
- ✅ Identifica relações `System.LinkTypes.Hierarchy-Reverse`
- ✅ Atualiza apenas work items com parent
- ⏱️ Duração: 10-15 minutos (para ~4000 work items)

**Saída esperada:**
```
🔗 SYNCING WORK ITEM HIERARCHY

📊 Fetching work items from database...
✅ Found 4188 work items

🔄 Processing work items in batches...

Batch 1/84: Processing 50 items...
  ✅ Updated 10 work items so far...
  ✅ Updated 20 work items so far...

═══════════════════════════════════════════════════════════
✅ HIERARCHY SYNC COMPLETED!
═══════════════════════════════════════════════════════════

📊 Results:
   Total Work Items: 4188
   Updated with Parent: 1250
   Skipped (no parent): 2800
   Errors: 138

📊 Parent Items (no parent): 2800
📊 Child Items (with parent): 1250

📋 Sample Hierarchy:

📋 PBI #35063: Implementar dashboard de métricas
   State: Done | Children: 5
     ✓ Task #35064: Criar componente de gráfico
        State: Done
     🐛 Bug #35065: Corrigir erro de carregamento
        State: Resolved
```

**Quando executar:**
- ✅ Após o primeiro full sync
- ✅ Quando adicionar novos work items
- ✅ Se hierarquia estiver desatualizada
- ❌ Não precisa executar em rotina (apenas quando necessário)


## 🔍 Scripts de Descoberta

### `discovery/discover-all-projects-sprints.js`
**Descobre todas as sprints de todos os projetos**

Lista todas as sprints disponíveis no Azure DevOps sem sincronizar.

**Como usar:**
```bash
node scripts/discovery/discover-all-projects-sprints.js
```

**Saída esperada:**
```
🔍 Discovering Sprints for ALL Projects...

✅ Found 7 projects in Azure DevOps

🏢 Project: GIGA - Tempos e Movimentos
✅ Found 28 sprints:
   ✅ Sprint 1 (past) - 2025-01-10 → 2025-01-23
   ✅ Sprint 2 (past) - 2025-01-27 → 2025-02-07
   ▶️ AV-NAV SP11 (current) - 2026-02-06 → 2026-02-24
   ...

📊 Summary:
Projects with sprints: 5/7
Total sprints: 58
```

### `discovery/test-classification-nodes.js`
**Testa a Classification Nodes API**

Valida a descoberta de sprints usando a Classification Nodes API.

**Como usar:**
```bash
node scripts/discovery/test-classification-nodes.js
```

**Saída esperada:**
```
🧪 Testing Classification Nodes API...

✅ Found 5 sprints:
   Sprint 1 (past) - 2025-11-25 → 2025-12-09
   Sprint 5 (current) - 2026-02-05 → 2026-02-23
   ...
```

## 📝 Notas Importantes

### Batching
Todos os scripts de sincronização usam batching para evitar timeouts:
- **Tamanho do lote**: 100 work items
- **Delay entre lotes**: 500ms
- **Motivo**: API do Azure DevOps tem limites de requisições

### Variáveis de Ambiente
Certifique-se de que o arquivo `.env` está configurado:
```env
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/sua-org
AZURE_DEVOPS_PAT=seu-personal-access-token
AZURE_DEVOPS_PROJECT=seu-projeto-principal
```

### Banco de Dados
Os scripts assumem que:
- ✅ Prisma está configurado
- ✅ Migrations foram executadas
- ✅ Banco de dados está acessível

### Performance
- **Sync completo**: 1-2 horas para ~3000+ work items
- **Descoberta**: ~10-30 segundos
- **Testes**: ~5-10 segundos

## 🚀 Workflow Recomendado

### 1. **Primeira Vez (Setup Inicial)**
```bash
# 1. Descobrir sprints disponíveis (opcional)
node scripts/discovery/discover-all-projects-sprints.js

# 2. Executar sync completo (APENAS UMA VEZ)
node scripts/sync/complete-massive-sync.js

# 3. Verificar dados no Prisma Studio
npm run db:studio
```

### 2. **Rotina Diária (Atualizações)**
```bash
# Executar sync incremental (rápido, apenas mudanças)
node scripts/sync/incremental-sync.js
```

### 3. **Agendamento Automático**

#### Linux/Mac (crontab)
```bash
# Editar crontab
crontab -e

# Adicionar linha para executar a cada 4 horas
0 */4 * * * cd /path/to/AzureBridge/Backend && node scripts/sync/incremental-sync.js >> /var/log/azurebridge-sync.log 2>&1
```

#### Windows (Task Scheduler)
```powershell
# Criar tarefa agendada
$action = New-ScheduledTaskAction -Execute "node" -Argument "scripts\sync\incremental-sync.js" -WorkingDirectory "C:\path\to\AzureBridge\Backend"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 4) -RepetitionDuration ([TimeSpan]::MaxValue)
Register-ScheduledTask -TaskName "AzureBridge Incremental Sync" -Action $action -Trigger $trigger
```

### 4. **Debug e Testes**
```bash
# Testar Classification Nodes API
node scripts/discovery/test-classification-nodes.js

# Descobrir sprints de todos os projetos
node scripts/discovery/discover-all-projects-sprints.js
```

---

## 📊 Comparação: Full Sync vs Incremental Sync

| Característica | Full Sync | Incremental Sync |
|----------------|-----------|------------------|
| **Frequência** | Uma vez (setup) | Diário/4h |
| **Duração** | 1-2 horas | Segundos a minutos |
| **Work Items** | Todos (~3000+) | Apenas alterados (~10-100) |
| **Uso de API** | Alto | Baixo |
| **Quando usar** | Primeira vez, reset | Rotina diária |
| **Automação** | Manual | Agendado (cron/task) |

---

## 💡 Estratégia Recomendada

### Dia 1 (Setup)
1. ✅ Executar **Full Sync** (1-2 horas)
2. ✅ Verificar dados no Prisma Studio
3. ✅ Configurar agendamento do Incremental Sync

### Dia 2+ (Rotina)
1. ✅ **Incremental Sync** executa automaticamente a cada 4 horas
2. ✅ Sincroniza apenas mudanças (rápido!)
3. ✅ Mantém dados sempre atualizados

### Quando fazer Full Sync novamente?
- ❌ **Nunca** em rotina normal
- ✅ Apenas se:
  - Banco de dados foi resetado
  - Dados corrompidos
  - Mudança estrutural no Azure DevOps
  - Problemas graves de sincronização

## ⚠️ Troubleshooting

### Erro: "RestClient timeout"
- **Causa**: Muitos work items sendo buscados de uma vez
- **Solução**: O batching já está implementado, aguarde o processo completar

### Erro: "No sprints found"
- **Causa**: Projeto sem iterations configuradas
- **Solução**: Configure iterations no Azure DevOps

### Erro: "Database connection failed"
- **Causa**: Banco de dados não acessível
- **Solução**: Verifique `.env` e conexão com o banco

## 📊 Estatísticas Esperadas

Com base no Azure DevOps atual:
- **Projetos**: 7
- **Sprints**: 58
- **Work Items**: ~3000-4000
- **Tempo de sync**: 1-2 horas

## 🔗 Links Úteis

- [Azure DevOps REST API](https://docs.microsoft.com/en-us/rest/api/azure/devops/)
- [Prisma Docs](https://www.prisma.io/docs/)
- [Node.js Azure DevOps API](https://github.com/microsoft/azure-devops-node-api)
