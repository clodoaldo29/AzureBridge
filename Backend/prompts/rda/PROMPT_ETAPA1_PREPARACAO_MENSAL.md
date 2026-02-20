# PROMPT DE IMPLEMENTAÇÃO — ETAPA 1: PREPARAÇÃO MENSAL

## Contexto do Projeto (cole isso no início de qualquer sessão)

```
Você é um desenvolvedor sênior TypeScript/Node.js implementando o módulo de "Preparação Mensal"
do sistema AzureBridge v2.0 — um sistema de geração automática de RDA (Relatório 
Demonstrativo Anual - Mensal) para projetos de software.

A Etapa 1 é executada TODO MÊS antes de gerar um RDA. Ela atualiza a base de conhecimento 
(criada na Etapa 0) com os dados específicos do período selecionado:
1. Busca Work Items do Azure DevOps (criados/modificados/concluídos no período)
2. Busca dados de Sprints que intersectam o período (burndown, velocity, capacity)
3. Re-sincroniza páginas modificadas da Wiki do Azure DevOps (incremental)
4. Processa documentos novos enviados pelo usuário (atas, relatórios parciais)
5. Transforma Work Items e Sprints em chunks estruturados com embeddings
6. Verifica se o ProjectContext precisa de atualização
7. Gera um MonthlySnapshot com resumo dos dados coletados

## Stack do Projeto (já existente e configurado)
- Runtime: Node.js 20 + TypeScript (ESM)
- Framework HTTP: Fastify 4.26 com @fastify/multipart para uploads
- ORM: Prisma 5.9.1 com PostgreSQL via Supabase
- Validação: Zod 3.22.4
- LLM: Anthropic SDK 0.74.0 (claude-sonnet-4-20250514)
- Embeddings: OpenAI SDK (text-embedding-3-small, 1536 dimensões)
- Frontend: React 18 + React Query 5 + Zustand + shadcn/ui + Tailwind CSS
- Busca vetorial: PostgreSQL com extensão pgvector (Supabase)
- Azure DevOps: azure-devops-node-api ^12.5.0

## Dependências novas necessárias para esta etapa
- Nenhuma dependência nova — tudo já foi instalado na Etapa 0.
  (openai, azure-devops-node-api, pdf-parse, mammoth, pizzip, docxtemplater, zod)

## O que já existe da Etapa -1 (Template Fixo)
A Etapa -1 foi simplificada: em vez de uma Template Factory automática, o template 
RDA é fixo e já está pronto com placeholders do docxtemplater.

Artefatos da Etapa -1 (já disponíveis, não precisam ser implementados):
- Template_RDA_Com_Loops.docx: template DOCX com loops docxtemplater 
  - Loop externo: {#ATIVIDADES}...{/ATIVIDADES} (N atividades por RDA)
  - Loop interno: {#RESPONSAVEIS}...{/RESPONSAVEIS} (N responsáveis por atividade)
  - Placeholders simples: {PROJETO_NOME}, {ANO_BASE}, {COMPETENCIA}, {COORDENADOR_TECNICO}, {RESULTADOS_ALCANCADOS}
  - Placeholders de atividade: {NUMERO_ATIVIDADE}, {NOME_ATIVIDADE}, {PERIODO_ATIVIDADE}, 
    {DESCRICAO_ATIVIDADE}, {JUSTIFICATIVA_ATIVIDADE}, {RESULTADO_OBTIDO_ATIVIDADE}, {DISPENDIOS_ATIVIDADE}
  - Placeholders de responsável: {NOME_RESPONSAVEL}, {CPF_RESPONSAVEL}, {JUSTIFICATIVA_RESPONSAVEL}
- Guia_Preenchimento_Placeholders_RDA.md: documento detalhado com regras de preenchimento 
  incluindo links de evidência

## O que já existe da Etapa 0 (Setup/RAG)
A Etapa 0 já foi implementada. Todos estes serviços e schemas estão disponíveis:

Schemas (src/modules/rda/schemas/rag.schema.ts):
  - ChunkingOptions, ChunkMetadata, DocumentChunkData, EmbeddingResult
  - SearchResult, SearchOptions, HybridSearchWeights
  - ExtractionResult, IngestionResult, IngestionProgress
  - ProjectContextData, DocumentTypeMapping
  - WikiSyncResult
  - Todos os Zod schemas correspondentes

Serviços da Etapa 0 (já implementados e funcionais):
  - chunking.service.ts → ChunkingService
    • chunkText(text, metadata) → DocumentChunkData[]
    • chunkTable(table, metadata) → DocumentChunkData
    • estimateTokens(text) → number
    • preserveUrls(text, splitPoint) → number (ajusta split para não quebrar URLs)
    • extractUrls(text) → string[]
    • classifyUrl(url) → UrlType
  - embedding.service.ts → EmbeddingService
    • generateEmbedding(text) → number[]
    • generateBatchEmbeddings(texts[]) → number[][]
    • storeChunks(chunks[], projectId) → void
    • hybridSearch(options: SearchOptions) → SearchResult[]
    • vectorSearch(query, projectId, topK) → SearchResult[]
    • fullTextSearch(query, projectId, topK) → SearchResult[]
    • deleteChunksBySource(projectId, sourceType, sourceId?) → number
  - document-ingestion.service.ts → DocumentIngestionService
    • ingestDocument(file, projectId, documentType?) → IngestionResult
    • extractFromPDF(buffer) → ExtractionResult
    • extractFromDOCX(buffer) → ExtractionResult
  - wiki-ingestion.service.ts → WikiIngestionService
    • syncWiki(projectId, organization, project) → WikiSyncResult
    • syncIncrementalWiki(projectId, organization, project) → WikiSyncResult
  - project-context.service.ts → ProjectContextService
    • buildContext(projectId) → ProjectContextData
    • getContext(projectId) → ProjectContextData | null
    • updateContext(projectId, partial) → ProjectContextData
  - project-setup.service.ts → ProjectSetupService (orquestrador)

Utils (src/modules/rda/utils/):
  - url-builder.ts → AzureDevOpsUrlBuilder, classifyUrl(), extractUrls()
  - storage-paths.ts → RDA_UPLOADS_DIR, RDA_TEMPLATES_DIR, RDA_GENERATED_DIR, ensureDirectory()

Modelos Prisma existentes:
```prisma
model Document {
  id                String   @id @default(uuid())
  projectId         String
  filename          String
  fileType          String
  filePath          String
  fileSize          Int
  extractedText     String?
  extractionMethod  String?
  extractionQuality Float?
  chunked           Boolean  @default(false)
  chunkCount        Int?
  chunks            DocumentChunk[]
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}

model WikiPage {
  id        String   @id @default(uuid())
  projectId String
  wikiId    String
  path      String
  title     String
  content   String
  version   Int
  chunked   Boolean  @default(false)
  chunkCount Int?
  chunks    DocumentChunk[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([projectId, wikiId, path])
}

model DocumentChunk {
  id         String   @id @default(uuid())
  documentId String?
  wikiPageId String?
  projectId  String
  content    String
  metadata   Json
  embedding  Unsupported("vector(1536)")
  chunkIndex Int
  tokenCount Int
  sourceType String   // 'document' | 'wiki' | 'workitem' | 'sprint'
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  document   Document? @relation(fields: [documentId], references: [id], onDelete: Cascade)
  wikiPage   WikiPage? @relation(fields: [wikiPageId], references: [id], onDelete: Cascade)
  @@index([projectId])
  @@index([documentId])
  @@index([wikiPageId])
  @@index([sourceType])
  @@index([projectId, sourceType])
}

model ProjectContext {
  id             String   @id @default(uuid())
  projectId      String   @unique
  projectName    String
  projectScope   String
  objectives     Json     @default("[]")
  teamMembers    Json     @default("[]")
  technologies   Json     @default("[]")
  keyMilestones  Json     @default("[]")
  businessRules  Json     @default("[]")
  deliveryPlan   Json     @default("[]")
  stakeholders   Json     @default("[]")
  summary        String?
  lastUpdated    DateTime @updatedAt
  createdAt      DateTime @default(now())
}

model RDATemplate {
  id           String   @id @default(uuid())
  projectId    String?
  name         String
  filePath     String
  placeholders Json
  status       String   @default("active")
  schemaId     String?
  sourceModels Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model RDAGeneration {
  id               String   @id @default(uuid())
  projectId        String
  templateId       String
  status           String   @default("queued")
  progress         Int      @default(0)
  currentStep      String?
  tokensUsed       Int      @default(0)
  partialResults   Json?
  filePath         String?
  metadata         Json?
  overrides        Json?
  validationReport Json?
  period           Json?
  schemaVersion    String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

Serviços existentes (pré-Etapa 0):
```
claude.service.ts
  - complete(system, messages, options) → texto livre
  - completeJSON<T>(system, messages, options) → resposta JSON parseada e tipada
  - Retry automático (3 tentativas, backoff com jitter) para erro 429

wiki.service.ts
  - syncWiki(projectId, organization, project) → sincroniza todas as páginas
  - getPages(projectId) → lista páginas sincronizadas
  - searchPages(projectId, query) → busca full-text nas páginas

document.service.ts
  - uploadDocument(file, projectId) → salva arquivo + extrai texto básico
  - getDocuments(projectId) → lista documentos do projeto
  - deleteDocument(id) → remove documento
```

## Estrutura de Diretórios Existente
```
src/modules/rda/
├── agents/
│   ├── base.agent.ts
│   └── orchestrator.ts
├── services/
│   ├── claude.service.ts
│   ├── wiki.service.ts
│   ├── document.service.ts
│   ├── rda-template.service.ts
│   ├── embedding.service.ts          # Etapa 0
│   ├── chunking.service.ts           # Etapa 0
│   ├── document-ingestion.service.ts # Etapa 0
│   ├── wiki-ingestion.service.ts     # Etapa 0
│   ├── project-context.service.ts    # Etapa 0
│   └── project-setup.service.ts      # Etapa 0
├── schemas/
│   └── rag.schema.ts                 # Etapa 0
├── routes/
│   └── rda.routes.ts
├── templates/
│   ├── Template_RDA_Com_Loops.docx
│   └── Guia_Preenchimento_Placeholders.md
└── utils/
    ├── storage-paths.ts
    └── url-builder.ts                # Etapa 0
```
```

---

## FASE 1: MODELOS PRISMA E SCHEMAS

### Arquivo 1: Novos modelos Prisma para a Etapa 1

```
Adicione os seguintes modelos ao schema.prisma existente. Estes modelos armazenam 
os dados do Azure DevOps coletados mensalmente e o snapshot mensal.

### Novo modelo: WorkItemSnapshot

Armazena um snapshot dos work items relevantes de cada período.
Cada work item é salvo uma vez por período — se o mesmo WI aparece em 2 meses, 
terá 2 registros (com estados possivelmente diferentes).

```prisma
model WorkItemSnapshot {
  id              String   @id @default(uuid())
  projectId       String
  workItemId      Int                           // ID no Azure DevOps
  type            String                        // 'Task' | 'Bug' | 'User Story' | 'Epic' | 'Feature'
  title           String
  state           String                        // 'New' | 'Active' | 'Resolved' | 'Closed' | 'Removed'
  assignedTo      String?                       // Nome do responsável
  areaPath        String?
  iterationPath   String?                       // Sprint path (ex: "PAIR\Sprint 5")
  tags            String?                       // Tags separadas por ";"
  priority        Int?                          // 1-4
  storyPoints     Float?                        // Para User Stories
  description     String?                       // HTML do Azure DevOps (sanitizado)
  acceptanceCriteria String?                    // Para User Stories
  createdDate     DateTime
  changedDate     DateTime                      // Última modificação
  closedDate      DateTime?                     // Se foi fechado
  parentId        Int?                          // ID do work item pai
  url             String?                       // URL completa no Azure DevOps
  
  // Campos de controle
  period          Json                          // {month: number, year: number}
  collectedAt     DateTime @default(now())      // Quando foi coletado
  
  @@unique([projectId, workItemId, period(path: ["month"]), period(path: ["year"])])
  @@index([projectId])
  @@index([projectId, iterationPath])
  @@index([projectId, state])
  @@index([workItemId])
}
```

NOTA: O índice unique composto com JSON path pode não ser suportado pelo Prisma diretamente.
Alternativa pragmática — usar um campo computed:

```prisma
model WorkItemSnapshot {
  // ... todos os campos acima ...
  periodKey       String                        // "2026-01" — gerado no código como `${year}-${month.toString().padStart(2,'0')}`
  
  @@unique([projectId, workItemId, periodKey])
  @@index([projectId, periodKey])
  @@index([projectId, iterationPath])
  @@index([projectId, state])
  @@index([workItemId])
}
```

### Novo modelo: SprintSnapshot

Armazena dados agregados de cada Sprint que intersecta o período.

```prisma
model SprintSnapshot {
  id              String   @id @default(uuid())
  projectId       String
  sprintName      String                        // Ex: "Sprint 5"
  iterationPath   String                        // Ex: "PAIR\Sprint 5"
  startDate       DateTime?
  endDate         DateTime?
  
  // Métricas agregadas
  totalWorkItems  Int      @default(0)
  completedItems  Int      @default(0)
  activeItems     Int      @default(0)
  newItems        Int      @default(0)
  removedItems    Int      @default(0)
  totalStoryPoints Float?
  completedStoryPoints Float?
  
  // Breakdown por tipo
  tasksByState    Json     @default("{}")       // {"New": 3, "Active": 5, "Closed": 12}
  bugsByState     Json     @default("{}")       // {"Active": 2, "Closed": 4}
  storiesByState  Json     @default("{}")       // {"Active": 1, "Closed": 3}
  
  // Capacidade e velocity
  teamCapacity    Float?                        // Horas de capacidade configurada
  velocity        Float?                        // Story Points concluídos / planejados
  
  // URLs de evidência
  taskboardUrl    String?                       // URL do taskboard da Sprint
  
  // Controle
  period          String                        // "2026-01"
  collectedAt     DateTime @default(now())
  
  @@unique([projectId, iterationPath, period])
  @@index([projectId, period])
}
```

### Novo modelo: MonthlySnapshot

Consolida todos os dados coletados em um snapshot mensal. 
É o ponto de entrada que a Etapa 2 (Preflight) e Etapa 3 (Geração) consultam.

```prisma
model MonthlySnapshot {
  id              String   @id @default(uuid())
  projectId       String
  period          String                        // "2026-01"
  status          String   @default("collecting") // 'collecting' | 'ready' | 'failed'
  
  // Resumo dos dados coletados
  workItemsTotal  Int      @default(0)
  workItemsNew    Int      @default(0)          // Criados no período
  workItemsClosed Int      @default(0)          // Fechados no período
  workItemsActive Int      @default(0)          // Ativos no final do período
  sprintsCount    Int      @default(0)          // Sprints que intersectam o período
  wikiPagesUpdated Int     @default(0)          // Páginas Wiki atualizadas
  documentsUploaded Int    @default(0)          // Documentos novos enviados
  chunksCreated   Int      @default(0)          // Total de chunks gerados nesta preparação
  
  // Status por fonte de dados
  workItemsStatus  String  @default("pending")  // 'pending' | 'collecting' | 'done' | 'error'
  sprintsStatus    String  @default("pending")
  wikiStatus       String  @default("pending")
  documentsStatus  String  @default("pending")
  contextStatus    String  @default("pending")  // Verificação do ProjectContext
  
  // Erros (se houver)
  errors          Json     @default("[]")       // [{source: 'workitems', message: '...', timestamp: '...'}]
  
  // Timestamps
  startedAt       DateTime?
  completedAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  @@unique([projectId, period])
  @@index([projectId])
  @@index([status])
}
```

### Migration SQL complementar (rodar no Supabase)

```sql
-- Nenhuma migration de pgvector adicional necessária (já feita na Etapa 0)
-- Apenas rodar: npx prisma migrate dev --name add_monthly_preparation_models
-- O Prisma gerará automaticamente as tabelas e índices definidos nos modelos acima
```
```

---

### Arquivo 2: src/modules/rda/schemas/monthly.schema.ts

```
Crie todas as interfaces TypeScript e schemas Zod específicos da Etapa 1.
Importe e reutilize tipos do rag.schema.ts onde aplicável.

```typescript
// ============================================================
// INTERFACES PARA WORK ITEMS
// ============================================================

/**
 * Parâmetros para busca de Work Items no Azure DevOps.
 * Usado pelo WorkItemService para montar a WIQL query.
 */
interface WorkItemQueryParams {
  projectId: string;               // ID do projeto no AzureBridge
  organization: string;            // Organização Azure DevOps
  project: string;                 // Nome do projeto no Azure DevOps
  period: MonthPeriod;
  types?: string[];                // Filtro por tipo (padrão: todos)
  states?: string[];               // Filtro por estado
  areaPath?: string;               // Filtro por área
  includeRemoved?: boolean;        // Incluir removed (padrão: false)
}

interface MonthPeriod {
  month: number;                   // 1-12
  year: number;                    // Ex: 2026
}

/**
 * Work Item normalizado (saída do Azure DevOps API → formato interno).
 * Campos mapeados do objeto WorkItem da API para campos legíveis.
 */
interface NormalizedWorkItem {
  id: number;
  type: string;
  title: string;
  state: string;
  assignedTo: string | null;
  areaPath: string | null;
  iterationPath: string | null;
  tags: string | null;
  priority: number | null;
  storyPoints: number | null;
  description: string | null;      // HTML sanitizado → texto
  acceptanceCriteria: string | null;
  createdDate: Date;
  changedDate: Date;
  closedDate: Date | null;
  parentId: number | null;
  url: string;
}

/**
 * Resultado da coleta de Work Items para um período.
 */
interface WorkItemCollectionResult {
  total: number;
  byType: Record<string, number>;       // {"Task": 45, "Bug": 12, "User Story": 8}
  byState: Record<string, number>;      // {"New": 5, "Active": 20, "Closed": 30}
  createdInPeriod: number;              // Criados dentro do mês
  closedInPeriod: number;               // Fechados dentro do mês
  modifiedInPeriod: number;             // Modificados no mês (inclui criados e fechados)
  chunksCreated: number;                // Chunks gerados dos WIs
  duration: number;                      // ms
  errors: string[];
}

// ============================================================
// INTERFACES PARA SPRINTS
// ============================================================

/**
 * Sprint normalizada (saída da API → formato interno).
 */
interface NormalizedSprint {
  name: string;                         // "Sprint 5"
  iterationPath: string;                // "PAIR\Sprint 5"
  startDate: Date | null;
  endDate: Date | null;
  timeFrame: 'past' | 'current' | 'future';
}

/**
 * Dados agregados de uma Sprint.
 */
interface SprintAggregation {
  sprint: NormalizedSprint;
  totalWorkItems: number;
  completedItems: number;
  activeItems: number;
  newItems: number;
  removedItems: number;
  totalStoryPoints: number | null;
  completedStoryPoints: number | null;
  tasksByState: Record<string, number>;
  bugsByState: Record<string, number>;
  storiesByState: Record<string, number>;
  teamCapacity: number | null;
  velocity: number | null;
  taskboardUrl: string;
}

/**
 * Resultado da coleta de Sprints para um período.
 */
interface SprintCollectionResult {
  sprints: SprintAggregation[];
  total: number;
  chunksCreated: number;
  duration: number;
  errors: string[];
}

// ============================================================
// INTERFACES PARA PREPARAÇÃO MENSAL
// ============================================================

/**
 * Configuração de uma preparação mensal.
 * Recebida pela rota de início da preparação.
 */
interface MonthlyPreparationConfig {
  projectId: string;
  period: MonthPeriod;
  options?: {
    syncWiki?: boolean;              // Padrão: true
    collectWorkItems?: boolean;      // Padrão: true
    collectSprints?: boolean;        // Padrão: true
    refreshProjectContext?: boolean;  // Padrão: false (só se necessário)
    forceReprocess?: boolean;        // Padrão: false (re-coleta mesmo se já existe)
  };
  azureDevOps: {
    organization: string;
    project: string;
    teamName: string;
  };
}

/**
 * Status em tempo real da preparação mensal.
 * O frontend faz polling neste objeto para mostrar progresso.
 */
interface MonthlyPreparationStatus {
  snapshotId: string;
  projectId: string;
  period: string;                    // "2026-01"
  status: 'collecting' | 'ready' | 'failed';
  progress: number;                  // 0-100
  currentStep: string;               // Descrição do passo atual

  steps: {
    workItems: StepStatus;
    sprints: StepStatus;
    wiki: StepStatus;
    documents: StepStatus;
    context: StepStatus;
    chunking: StepStatus;
  };

  summary?: {
    workItemsTotal: number;
    sprintsCount: number;
    wikiPagesUpdated: number;
    documentsUploaded: number;
    chunksCreated: number;
  };

  errors: Array<{
    source: string;
    message: string;
    timestamp: string;
  }>;

  startedAt: string | null;
  completedAt: string | null;
}

interface StepStatus {
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  progress: number;                  // 0-100
  message?: string;
  duration?: number;                 // ms
}

/**
 * Resultado final completo da preparação mensal.
 */
interface MonthlyPreparationResult {
  snapshotId: string;
  period: string;
  status: 'ready' | 'failed';
  
  workItems: WorkItemCollectionResult;
  sprints: SprintCollectionResult;
  wiki: {
    pagesUpdated: number;
    chunksCreated: number;
    duration: number;
  };
  documents: {
    count: number;
    chunksCreated: number;
    duration: number;
  };
  contextUpdated: boolean;
  
  totals: {
    chunksCreated: number;
    totalDuration: number;
    errors: number;
  };
}

// ============================================================
// INTERFACES PARA CHUNKS DE WORK ITEMS E SPRINTS
// ============================================================

/**
 * Define como um Work Item é transformado em chunk para o RAG.
 * O texto do chunk é uma representação textual estruturada do WI.
 */
interface WorkItemChunkTemplate {
  // O conteúdo do chunk segue este formato:
  // ---
  // [WORK ITEM #{id}] {type} — {title}
  // Estado: {state} | Prioridade: {priority} | Sprint: {iterationPath}
  // Responsável: {assignedTo}
  // Tags: {tags}
  // Story Points: {storyPoints}
  // Criado: {createdDate} | Modificado: {changedDate} | Fechado: {closedDate}
  //
  // Descrição:
  // {description (texto, sem HTML)}
  //
  // Critérios de Aceite:
  // {acceptanceCriteria (texto, sem HTML)}
  // ---
  //
  // Metadados do chunk:
  //   sourceType: 'workitem'
  //   metadata.workItemId: number
  //   metadata.workItemType: string
  //   metadata.workItemState: string
  //   metadata.iterationPath: string
  //   metadata.assignedTo: string
  //   metadata.tags: string[]
  //   metadata.period: string ("2026-01")
  //   metadata.urls: [url do work item]
  //   metadata.urlTypes: [{url, type: 'azure_devops_workitem'}]
}

/**
 * Define como uma Sprint agregada é transformada em chunk para o RAG.
 */
interface SprintChunkTemplate {
  // O conteúdo do chunk segue este formato:
  // ---
  // [SPRINT] {name} ({startDate} — {endDate})
  // Status: {timeFrame}
  //
  // Resumo:
  // - Total de Work Items: {totalWorkItems}
  // - Concluídos: {completedItems} | Ativos: {activeItems} | Novos: {newItems}
  // - Story Points: {completedStoryPoints}/{totalStoryPoints}
  // - Velocity: {velocity}%
  //
  // Tasks por estado: New: {n}, Active: {n}, Closed: {n}
  // Bugs por estado: Active: {n}, Closed: {n}
  // User Stories por estado: Active: {n}, Closed: {n}
  //
  // Capacidade da equipe: {teamCapacity}h
  // URL do Taskboard: {taskboardUrl}
  // ---
  //
  // Metadados do chunk:
  //   sourceType: 'sprint'
  //   metadata.sprintName: string
  //   metadata.iterationPath: string
  //   metadata.startDate: string
  //   metadata.endDate: string
  //   metadata.timeFrame: string
  //   metadata.period: string ("2026-01")
  //   metadata.urls: [taskboardUrl]
  //   metadata.urlTypes: [{url, type: 'azure_devops_sprint'}]
}
```

Crie também os schemas Zod correspondentes para:
- MonthPeriodSchema (validar month 1-12, year >= 2020)
- MonthlyPreparationConfigSchema (validar config completa com defaults)
- WorkItemQueryParamsSchema
- NormalizedWorkItemSchema
- SprintAggregationSchema

IMPORTANTE: Exporte tudo com `export` para uso nos outros arquivos.
```

---

## FASE 2: SERVIÇOS DE COLETA DE DADOS

### Arquivo 3: src/modules/rda/services/workitem.service.ts

```
Crie o serviço de coleta de Work Items do Azure DevOps via API REST.
Este serviço busca WIs do período, normaliza os dados e armazena como snapshots + chunks.

Dependência: azure-devops-node-api (já instalado)

Conexão com Azure DevOps:
```typescript
import * as azdev from 'azure-devops-node-api';

// Variáveis de ambiente:
// AZURE_DEVOPS_ORG_URL=https://dev.azure.com/{organization}
// AZURE_DEVOPS_PAT={personal_access_token}
```

Métodos obrigatórios:

```typescript
class WorkItemService {
  private connection: azdev.WebApi;
  private witApi: IWorkItemTrackingApi;
  
  constructor(
    private prisma: PrismaClient,
    private embeddingService: EmbeddingService,
    private chunkingService: ChunkingService,
    private urlBuilder: AzureDevOpsUrlBuilder,
  ) {
    // Inicializar conexão Azure DevOps via variáveis de ambiente
  }

  /**
   * Busca e armazena Work Items do período.
   * Fluxo:
   * 1. Monta WIQL query para buscar WIs criados OU modificados OU fechados no período
   * 2. Executa query via API
   * 3. Busca detalhes completos de cada WI (em batches de 200)
   * 4. Normaliza os campos
   * 5. Salva WorkItemSnapshot no banco (upsert para não duplicar)
   * 6. Transforma cada WI em chunk estruturado
   * 7. Gera embeddings e armazena chunks no pgvector
   */
  async collectWorkItems(params: WorkItemQueryParams): Promise<WorkItemCollectionResult>

  /**
   * Monta a WIQL (Work Item Query Language) para buscar WIs do período.
   * 
   * A query deve buscar Work Items que:
   * - Foram CRIADOS no período (CreatedDate >= startOfMonth AND CreatedDate < startOfNextMonth)
   * - OU foram MODIFICADOS no período (ChangedDate >= startOfMonth AND ChangedDate < startOfNextMonth)
   * - OU foram FECHADOS no período (ClosedDate >= startOfMonth AND ClosedDate < startOfNextMonth)
   * - E pertencem ao projeto especificado
   * - E NÃO são do tipo 'Removed' (a menos que includeRemoved=true)
   * 
   * Retorna: WIQL string
   * 
   * ATENÇÃO com WIQL:
   * - Datas no formato: 'YYYY-MM-DD'
   * - Operador OR precisa de parênteses
   * - Campos: [System.CreatedDate], [System.ChangedDate], [Microsoft.VSTS.Common.ClosedDate]
   * - Projeto: [System.TeamProject] = '{project}'
   */
  private buildWIQL(params: WorkItemQueryParams): string

  /**
   * Busca detalhes completos dos Work Items por ID (em batches).
   * A WIQL retorna apenas IDs. Precisamos buscar os campos detalhados.
   * 
   * Campos a buscar:
   * - System.Id, System.WorkItemType, System.Title, System.State
   * - System.AssignedTo, System.AreaPath, System.IterationPath
   * - System.Tags, Microsoft.VSTS.Common.Priority
   * - Microsoft.VSTS.Scheduling.StoryPoints
   * - System.Description, Microsoft.VSTS.Common.AcceptanceCriteria
   * - System.CreatedDate, System.ChangedDate, Microsoft.VSTS.Common.ClosedDate
   * - System.Parent
   * 
   * Processar em batches de 200 IDs (limite da API).
   */
  private async fetchWorkItemDetails(ids: number[]): Promise<NormalizedWorkItem[]>

  /**
   * Normaliza um WorkItem da API para o formato interno.
   * - Extrai campos do objeto `fields`
   * - Sanitiza HTML do description e acceptanceCriteria (remove tags, mantém texto)
   * - Constrói URL via urlBuilder.workItem(id)
   * - Trata campos nulos
   */
  private normalizeWorkItem(apiWorkItem: any): NormalizedWorkItem

  /**
   * Transforma um Work Item normalizado em texto para chunk.
   * Segue o formato definido em WorkItemChunkTemplate.
   * 
   * O texto deve ser legível e conter TODAS as informações relevantes
   * para que a busca semântica encontre o WI por qualquer aspecto.
   * 
   * HTML do description: usar regex para remover tags HTML:
   *   text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
   */
  private workItemToChunkText(wi: NormalizedWorkItem): string

  /**
   * Transforma Work Items em chunks e armazena com embeddings.
   * 
   * IMPORTANTE: Antes de criar novos chunks, deletar chunks anteriores
   * do mesmo período para evitar duplicação:
   *   embeddingService.deleteChunksBySource(projectId, 'workitem')
   *   → Na verdade, filtrar por período nos metadados
   * 
   * Abordagem: 
   * - Deletar chunks onde metadata->>'period' = periodKey AND sourceType = 'workitem'
   * - Criar novos chunks para todos os WIs coletados
   * - Usar embeddingService.storeChunks() para gerar embeddings e salvar
   */
  private async createWorkItemChunks(
    workItems: NormalizedWorkItem[],
    projectId: string,
    periodKey: string,
  ): Promise<number>

  /**
   * Retorna Work Items já coletados para um período (do banco, não da API).
   * Útil para consulta rápida sem refazer a coleta.
   */
  async getWorkItemSnapshots(projectId: string, periodKey: string): Promise<WorkItemSnapshot[]>

  /**
   * Retorna estatísticas dos Work Items de um período.
   */
  async getWorkItemStats(projectId: string, periodKey: string): Promise<{
    total: number;
    byType: Record<string, number>;
    byState: Record<string, number>;
    createdInPeriod: number;
    closedInPeriod: number;
  }>
}
```

SANITIZAÇÃO DE HTML:
- Description e AcceptanceCriteria do Azure DevOps vêm como HTML
- Sanitizar com: `text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()`
- Preservar quebras de linha: substituir `<br>`, `<br/>`, `</p>`, `</li>` por `\n` ANTES de remover tags
- Se description for null ou vazio, usar string vazia (não afeta o chunk)

TRATAMENTO DE ERROS:
- Se a API do Azure DevOps retornar 401/403, lançar erro claro: "Token PAT do Azure DevOps inválido ou sem permissão"
- Se retornar 0 work items, NÃO é erro — registrar como warning e continuar
- Timeout de 30 segundos por batch de WIs
- Retry 2x em caso de erro 429 (rate limit) ou 5xx
```

---

### Arquivo 4: src/modules/rda/services/sprint.service.ts

```
Crie o serviço de coleta de dados de Sprint do Azure DevOps.
Busca Sprints (iterations) que intersectam o período e agrega métricas.

```typescript
class SprintService {
  constructor(
    private prisma: PrismaClient,
    private embeddingService: EmbeddingService,
    private urlBuilder: AzureDevOpsUrlBuilder,
    private workItemService: WorkItemService,
  ) {}

  /**
   * Coleta Sprints que intersectam o período e agrega métricas.
   * Fluxo:
   * 1. Busca todas as iterations do time via API
   * 2. Filtra as que intersectam o período (startDate <= endOfMonth AND endDate >= startOfMonth)
   * 3. Para cada Sprint filtrada, agrega dados dos WorkItemSnapshots já coletados
   * 4. Calcula velocity e outras métricas
   * 5. Salva SprintSnapshot no banco
   * 6. Transforma cada Sprint em chunk e armazena com embedding
   */
  async collectSprints(
    projectId: string,
    organization: string,
    project: string,
    teamName: string,
    period: MonthPeriod,
  ): Promise<SprintCollectionResult>

  /**
   * Busca iterations do time no Azure DevOps.
   * API: GET {org}/{project}/{team}/_apis/work/teamsettings/iterations
   * 
   * Retorna sprints com: name, path, attributes (startDate, endDate, timeFrame)
   */
  private async fetchTeamIterations(
    organization: string,
    project: string,
    teamName: string,
  ): Promise<NormalizedSprint[]>

  /**
   * Filtra sprints que intersectam o mês.
   * Uma sprint intersecta se: sprint.startDate <= lastDayOfMonth AND sprint.endDate >= firstDayOfMonth
   * 
   * Sprints sem data definida (futuras sem planejamento) são ignoradas.
   */
  private filterSprintsForPeriod(sprints: NormalizedSprint[], period: MonthPeriod): NormalizedSprint[]

  /**
   * Agrega métricas de Work Items para uma Sprint específica.
   * 
   * Busca WorkItemSnapshots onde iterationPath = sprint.iterationPath
   * Agrupa por type e state, calcula totais.
   * 
   * Se os WorkItemSnapshots ainda não existirem (coleta de WIs não rodou),
   * retorna agregação zerada com warning.
   */
  private async aggregateSprintMetrics(
    projectId: string,
    sprint: NormalizedSprint,
    periodKey: string,
  ): Promise<SprintAggregation>

  /**
   * Transforma SprintAggregation em texto para chunk.
   * Segue formato definido em SprintChunkTemplate.
   */
  private sprintToChunkText(agg: SprintAggregation): string

  /**
   * Cria chunks e embeddings das Sprints.
   * Mesma lógica do workitem: deletar chunks anteriores do período + sourceType='sprint',
   * criar novos, gerar embeddings.
   */
  private async createSprintChunks(
    sprints: SprintAggregation[],
    projectId: string,
    periodKey: string,
  ): Promise<number>

  /**
   * Retorna Sprints já coletadas para um período.
   */
  async getSprintSnapshots(projectId: string, periodKey: string): Promise<SprintSnapshot[]>
}
```

DETERMINAÇÃO DE VELOCITY:
- velocity = (completedStoryPoints / totalStoryPoints) * 100
- Se totalStoryPoints = 0 ou null, velocity = null
- Se a Sprint está no futuro (timeFrame = 'future'), velocity = null

TEAM CAPACITY:
- Se disponível via API: GET {org}/{project}/{team}/_apis/work/teamsettings/iterations/{iterationId}/capacities
- Se a API retornar 404 ou dados vazios, capacity = null
- Não bloquear a coleta se capacity não estiver disponível

INTERSECÇÃO DE PERÍODO:
```
período: 2026-01-01 a 2026-01-31
Sprint 4: 2025-12-15 a 2026-01-10 → intersecta ✓
Sprint 5: 2026-01-13 a 2026-02-07 → intersecta ✓
Sprint 6: 2026-02-10 a 2026-02-28 → NÃO intersecta ✗
```
```

---

## FASE 3: SERVIÇO ORQUESTRADOR

### Arquivo 5: src/modules/rda/services/monthly-preparation.service.ts

```
Crie o serviço orquestrador que coordena toda a preparação mensal.
Executa os passos em sequência, atualiza status e gera o MonthlySnapshot final.

```typescript
class MonthlyPreparationService {
  constructor(
    private prisma: PrismaClient,
    private workItemService: WorkItemService,
    private sprintService: SprintService,
    private wikiIngestionService: WikiIngestionService,       // Da Etapa 0
    private documentIngestionService: DocumentIngestionService, // Da Etapa 0
    private projectContextService: ProjectContextService,     // Da Etapa 0
    private embeddingService: EmbeddingService,               // Da Etapa 0
  ) {}

  /**
   * Executa a preparação mensal completa.
   * 
   * Fluxo sequencial com atualização de status:
   * 
   * 1. VALIDAÇÃO INICIAL (0%)
   *    - Verificar se já existe MonthlySnapshot para este período
   *    - Se existe e forceReprocess=false, retornar snapshot existente
   *    - Se existe e forceReprocess=true, resetar snapshot
   *    - Criar MonthlySnapshot com status='collecting'
   * 
   * 2. COLETA DE WORK ITEMS (0% → 35%)
   *    - Chamar workItemService.collectWorkItems()
   *    - Atualizar MonthlySnapshot com contadores
   *    - Se erro, marcar workItemsStatus='error' mas CONTINUAR (não bloquear)
   * 
   * 3. COLETA DE SPRINTS (35% → 55%)
   *    - Chamar sprintService.collectSprints()
   *    - Sprints dependem dos WorkItemSnapshots, então vem DEPOIS
   *    - Atualizar MonthlySnapshot
   * 
   * 4. SYNC DA WIKI (55% → 75%)
   *    - Se options.syncWiki=true, chamar wikiIngestionService.syncIncrementalWiki()
   *    - Apenas páginas modificadas desde última sync
   *    - Se Wiki não estiver configurada, status='skipped'
   * 
   * 5. DOCUMENTOS NOVOS (75% → 85%)
   *    - Verificar se há documentos não processados (chunked=false)
   *    - Se houver, processar via documentIngestionService
   *    - Na prática, o upload é feito pela UI antes de iniciar a preparação
   * 
   * 6. VERIFICAÇÃO DO PROJECT CONTEXT (85% → 95%)
   *    - Se options.refreshProjectContext=true, chamar projectContextService.buildContext()
   *    - Se false, verificar se ProjectContext existe — se não, criar
   *    - Se sim, verificar lastUpdated — se > 30 dias, sugerir refresh (warning)
   * 
   * 7. FINALIZAÇÃO (95% → 100%)
   *    - Atualizar MonthlySnapshot: status='ready', completedAt=now()
   *    - Retornar MonthlyPreparationResult completo
   *    - Se QUALQUER passo teve erro fatal, status='failed'
   *    - Se houve erros parciais mas dados foram coletados, status='ready' com warnings
   */
  async prepare(config: MonthlyPreparationConfig): Promise<MonthlyPreparationResult>

  /**
   * Retorna o status atual da preparação (para polling do frontend).
   */
  async getStatus(projectId: string, period: string): Promise<MonthlyPreparationStatus | null>

  /**
   * Retorna snapshots existentes para um projeto.
   * Útil para listar meses já preparados.
   */
  async listSnapshots(projectId: string): Promise<MonthlySnapshot[]>

  /**
   * Deleta dados de uma preparação (WorkItemSnapshots, SprintSnapshots, 
   * chunks do período, MonthlySnapshot).
   * Útil para reprocessar um mês.
   */
  async deletePreparation(projectId: string, period: string): Promise<void>

  /**
   * Helper: gera periodKey no formato "YYYY-MM"
   */
  private periodToKey(period: MonthPeriod): string

  /**
   * Helper: calcula primeiro e último dia do mês
   */
  private getPeriodBounds(period: MonthPeriod): { start: Date; end: Date }

  /**
   * Helper: atualiza status do MonthlySnapshot no banco
   */
  private async updateSnapshotStatus(
    snapshotId: string,
    updates: Partial<MonthlySnapshot>,
  ): Promise<void>

  /**
   * Helper: adiciona erro ao array de erros do snapshot
   */
  private async addError(
    snapshotId: string,
    source: string,
    message: string,
  ): Promise<void>
}
```

RESILIÊNCIA:
- Cada passo é executado em try/catch individual
- Se Work Items falha, Sprint ainda tenta rodar (usa dados anteriores se disponíveis)
- Se Wiki falha, não bloqueia — marcado como 'error' no snapshot
- Se TUDO falha, status='failed' e mensagem clara ao usuário
- Logging detalhado: [MonthlyPrep] prefixo em todas as mensagens

IDEMPOTÊNCIA:
- Se o usuário rodar a preparação 2x para o mesmo mês sem forceReprocess:
  → Retorna o snapshot existente se status='ready'
  → Retoma se status='collecting' (re-executa passos pendentes)
  → Reprocessa se status='failed'
- Com forceReprocess=true: deleta tudo e recomeça
- Chunks do período são sempre deletados antes de recriar (evita duplicação)
```

---

## FASE 4: ROTAS FASTIFY E API

### Arquivo 6: src/modules/rda/routes/monthly.routes.ts

```
Crie as rotas Fastify para a Etapa 1. Estas rotas podem ser registradas 
no rda.routes.ts existente ou em um arquivo separado.

```typescript
// Registrar com prefixo: /api/rda/monthly

/**
 * POST /api/rda/monthly/prepare
 * 
 * Inicia a preparação mensal. Pode ser síncrona (aguarda conclusão)
 * ou assíncrona (retorna imediatamente com snapshotId para polling).
 * 
 * Body: MonthlyPreparationConfig
 * 
 * Para a v1, fazer SÍNCRONA (aguardar conclusão).
 * Quando evoluir para BullMQ na Etapa 2, converter para assíncrona.
 * 
 * Resposta 200: MonthlyPreparationResult
 * Resposta 409: Preparação já em andamento para este período
 * Resposta 400: Validação falhou (período inválido, projeto não encontrado)
 */

/**
 * GET /api/rda/monthly/status/:projectId/:period
 * 
 * Retorna status da preparação mensal.
 * Usado pelo frontend para polling durante a preparação.
 * 
 * Params: projectId (uuid), period ("2026-01")
 * Resposta 200: MonthlyPreparationStatus
 * Resposta 404: Nenhuma preparação encontrada
 */

/**
 * GET /api/rda/monthly/snapshots/:projectId
 * 
 * Lista todos os MonthlySnapshots de um projeto.
 * Mostra quais meses já foram preparados e seu status.
 * 
 * Resposta 200: MonthlySnapshot[]
 */

/**
 * GET /api/rda/monthly/snapshot/:projectId/:period
 * 
 * Retorna detalhes de um snapshot específico, incluindo:
 * - MonthlySnapshot base
 * - Contagem de WorkItemSnapshots
 * - Contagem de SprintSnapshots
 * - Estatísticas de chunks por sourceType
 * 
 * Resposta 200: MonthlySnapshot com estatísticas expandidas
 * Resposta 404: Snapshot não encontrado
 */

/**
 * GET /api/rda/monthly/workitems/:projectId/:period
 * 
 * Lista Work Items coletados para um período.
 * Suporta filtros opcionais: type, state, assignedTo
 * 
 * Query: ?type=Task&state=Closed&page=1&pageSize=50
 * Resposta 200: { items: WorkItemSnapshot[], total: number, stats: {...} }
 */

/**
 * GET /api/rda/monthly/sprints/:projectId/:period
 * 
 * Lista Sprints coletadas para um período.
 * 
 * Resposta 200: SprintSnapshot[]
 */

/**
 * DELETE /api/rda/monthly/:projectId/:period
 * 
 * Deleta preparação de um período (snapshots, chunks, embeddings).
 * Útil para reprocessar um mês limpo.
 * 
 * Resposta 200: { deleted: true, chunksRemoved: number }
 * Resposta 404: Período não encontrado
 */

/**
 * POST /api/rda/monthly/upload-documents/:projectId/:period
 * 
 * Upload de documentos adicionais do período (atas de reunião, relatórios parciais).
 * Usa @fastify/multipart para receber arquivos.
 * 
 * Multipart: file (PDF ou DOCX)
 * 
 * Fluxo: salva documento → processa via DocumentIngestionService → 
 *        marca nos metadados do chunk que pertence ao período
 * 
 * Resposta 200: IngestionResult
 */
```

VALIDAÇÕES NAS ROTAS:
- projectId: uuid válido
- period: formato "YYYY-MM" com regex /^\d{4}-(0[1-9]|1[0-2])$/
- Verificar se projeto existe no banco antes de qualquer operação
- Verificar se variáveis AZURE_DEVOPS_ORG_URL e AZURE_DEVOPS_PAT estão configuradas
```

---

## FASE 5: FRONTEND

### Arquivo 7: src/hooks/useMonthlyPreparation.ts

```
Crie os hooks React Query para a Etapa 1.

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

const API_BASE = '/api/rda/monthly';

/**
 * Hook para iniciar a preparação mensal.
 * Retorna mutation com loading state, progress tracking.
 */
export function useStartPreparation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: MonthlyPreparationConfig) => 
      axios.post(`${API_BASE}/prepare`, config),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['monthly-snapshots', variables.projectId] });
    },
  });
}

/**
 * Hook para polling do status da preparação.
 * Faz polling a cada 2 segundos enquanto status != 'ready' e != 'failed'.
 */
export function usePreparationStatus(projectId: string, period: string, enabled = false) {
  return useQuery({
    queryKey: ['monthly-status', projectId, period],
    queryFn: () => axios.get(`${API_BASE}/status/${projectId}/${period}`).then(r => r.data),
    enabled,
    refetchInterval: (data) => {
      if (!data) return 2000;
      const status = data as MonthlyPreparationStatus;
      return status.status === 'collecting' ? 2000 : false;
    },
  });
}

/**
 * Hook para listar snapshots de um projeto.
 */
export function useMonthlySnapshots(projectId: string) {
  return useQuery({
    queryKey: ['monthly-snapshots', projectId],
    queryFn: () => axios.get(`${API_BASE}/snapshots/${projectId}`).then(r => r.data),
    enabled: !!projectId,
  });
}

/**
 * Hook para detalhes de um snapshot.
 */
export function useSnapshotDetail(projectId: string, period: string) {
  return useQuery({
    queryKey: ['monthly-snapshot', projectId, period],
    queryFn: () => axios.get(`${API_BASE}/snapshot/${projectId}/${period}`).then(r => r.data),
    enabled: !!projectId && !!period,
  });
}

/**
 * Hook para listar Work Items de um período.
 */
export function useWorkItems(projectId: string, period: string, filters?: WorkItemFilters) {
  return useQuery({
    queryKey: ['monthly-workitems', projectId, period, filters],
    queryFn: () => axios.get(`${API_BASE}/workitems/${projectId}/${period}`, { params: filters }).then(r => r.data),
    enabled: !!projectId && !!period,
  });
}

/**
 * Hook para listar Sprints de um período.
 */
export function useSprints(projectId: string, period: string) {
  return useQuery({
    queryKey: ['monthly-sprints', projectId, period],
    queryFn: () => axios.get(`${API_BASE}/sprints/${projectId}/${period}`).then(r => r.data),
    enabled: !!projectId && !!period,
  });
}

/**
 * Hook para deletar preparação de um período.
 */
export function useDeletePreparation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, period }: { projectId: string; period: string }) =>
      axios.delete(`${API_BASE}/${projectId}/${period}`),
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['monthly-snapshots', projectId] });
    },
  });
}

/**
 * Hook para upload de documentos do período.
 */
export function useUploadPeriodDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, period, file }: { projectId: string; period: string; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return axios.post(`${API_BASE}/upload-documents/${projectId}/${period}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => { /* progress tracking */ },
      });
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ['monthly-snapshots', projectId] });
    },
  });
}

interface WorkItemFilters {
  type?: string;
  state?: string;
  assignedTo?: string;
  page?: number;
  pageSize?: number;
}
```
```

---

### Arquivo 8: src/components/rda/MonthlyPreparation/ (componentes React)

```
Crie os componentes React para a interface de Preparação Mensal.
A tela é acessada após o setup do projeto (Etapa 0) estar completo.

O fluxo de UI é:

1. **Seleção de Período** — usuário escolhe mês/ano
2. **Configuração** — opções de coleta (wiki, WIs, sprints)
3. **Execução** — progresso em tempo real com status por passo
4. **Resultado** — resumo dos dados coletados com ação "Gerar RDA"

### Componente 1: MonthlyPreparationPage.tsx

Página principal que orquestra o fluxo. Contém:
- Header com nome do projeto e navegação
- Lista de meses já preparados (MonthlySnapshots) à esquerda
- Área principal com o wizard/fluxo à direita
- Botão "Nova Preparação" que abre o seletor de período

Se já existir um snapshot 'ready' para o mês selecionado, mostrar 
resumo dos dados com opções:
- "Usar esta preparação" → navegar para Etapa 2 (Preflight)
- "Reprocessar" → forceReprocess=true
- "Ver detalhes" → expandir Work Items e Sprints

### Componente 2: PeriodSelector.tsx

Seletor de mês/ano com:
- Dropdown de mês (Janeiro a Dezembro em PT-BR)
- Dropdown de ano (ano atual e anterior)
- Indicadores visuais de quais meses já foram preparados (badges verdes)
- Botão "Iniciar Preparação"

### Componente 3: PreparationProgress.tsx

Tela de progresso durante a execução:
- Barra de progresso geral (0-100%)
- Lista vertical de passos com ícones de status:
  - 🔄 Running (animação de spin)
  - ✅ Done (verde)
  - ⏳ Pending (cinza)
  - ❌ Error (vermelho)
  - ⏭️ Skipped (cinza claro)
- Para cada passo: nome, status, duração, contadores parciais
- Passos:
  1. "Coletando Work Items..." → "142 work items coletados"
  2. "Coletando Sprints..." → "3 sprints analisadas"
  3. "Sincronizando Wiki..." → "8 páginas atualizadas"
  4. "Processando documentos..." → "2 documentos novos"
  5. "Verificando contexto do projeto..." → "Contexto atualizado"
  6. "Finalizando..." → "Preparação concluída"
- Log de erros expandível (se houver)
- Usa usePreparationStatus com polling

### Componente 4: PreparationSummary.tsx

Resumo pós-preparação:
- Cards com contadores: Work Items, Sprints, Wiki Pages, Documentos, Chunks
- Mini-gráfico ou badge de distribuição de WIs por tipo e estado
- Lista de Sprints com métricas (nome, datas, completados/total)
- Seção de erros/warnings (se houver)
- Botões: 
  - "Gerar RDA" (primário) → navega para Etapa 2
  - "Ver Work Items" → expande lista paginada
  - "Ver Sprints" → expande detalhes
  - "Reprocessar" → confirma e re-executa

### Componente 5: WorkItemsList.tsx

Lista paginada de Work Items com:
- Filtros: tipo (dropdown), estado (dropdown), responsável (dropdown)
- Tabela com: ID, Tipo, Título, Estado, Responsável, Sprint, Story Points
- Badges coloridos para estado: New=azul, Active=amarelo, Closed=verde, Resolved=roxo
- Badges para tipo: Task, Bug, User Story, Epic com cores diferentes
- Paginação (50 por página)
- Link "Abrir no Azure DevOps" em cada WI

### Componente 6: SprintDetails.tsx

Cards de Sprint com:
- Nome e período da Sprint
- Barra de progresso: completados / total
- Métricas: velocity, story points, capacity
- Breakdown por tipo (mini-tabela)
- Link "Abrir Taskboard" → abre URL do Azure DevOps

Use shadcn/ui: Card, Button, Badge, Progress, Select, Dialog, Toast, Table, 
  Tabs, Input, DropdownMenu, Alert, Separator, ScrollArea
Use Tailwind CSS para todos os estilos
Use Lucide React para ícones: Calendar, ArrowRight, CheckCircle, XCircle, Clock, 
  Users, Bug, ListTodo, BarChart3, RefreshCw, ExternalLink, Upload, Trash2,
  ChevronDown, Filter, FileText, Zap, Target, TrendingUp
Use date-fns com locale ptBR para formatação de datas
```

---

## REGRAS GERAIS DE IMPLEMENTAÇÃO

```
1. TypeScript estrito: sem 'any' desnecessário, interfaces para tudo
2. Tratamento de erros: try/catch com mensagens claras em português, nunca crashar silenciosamente
3. Logging: usar console.log com prefixos:
   - [WorkItem] para operações de Work Items
   - [Sprint] para operações de Sprint
   - [MonthlyPrep] para o orquestrador
   - [WikiSync] para sincronização de Wiki
   - [Upload] para upload de documentos
4. Imports: ESM (import/export), compatível com o setup existente do projeto
5. Zod: validar todas as entradas de rotas
6. Raw SQL: usar $queryRaw / $executeRaw do Prisma para operações com pgvector e metadados JSON
   SEMPRE parametrizar queries para evitar SQL injection
7. Todos os textos de UI e mensagens de erro em português brasileiro
8. Performance: logar duração de cada etapa significativa
9. Manter compatibilidade com os serviços da Etapa 0 — reutilizar EmbeddingService, 
   ChunkingService, etc. sem modificá-los
10. Variáveis de ambiente: AZURE_DEVOPS_ORG_URL, AZURE_DEVOPS_PAT (Azure DevOps),
    OPENAI_API_KEY (embeddings), DATABASE_URL e DIRECT_DATABASE_URL (banco)
11. Chunks de Work Items e Sprints devem ter metadata.period = periodKey para 
    permitir filtragem e limpeza por período
```

---

## NENHUMA DEPENDÊNCIA NOVA

```
Todas as dependências já estão instaladas:
- azure-devops-node-api (SDK Azure DevOps)
- openai (embeddings)
- @prisma/client (banco)
- zod (validação)
- Todas as libs do frontend (React, React Query, shadcn, etc.)
```

---

## ORDEM DE IMPLEMENTAÇÃO SUGERIDA

```
Implemente na seguinte ordem (cada item depende dos anteriores):

1. monthly.schema.ts (interfaces TypeScript e Zod schemas — base dos tipos)
2. Modelos Prisma (WorkItemSnapshot, SprintSnapshot, MonthlySnapshot + migration)
3. workitem.service.ts (coleta de Work Items + criação de chunks)
4. sprint.service.ts (coleta de Sprints + agregação de métricas)
5. monthly-preparation.service.ts (orquestrador que coordena tudo)
6. monthly.routes.ts (rotas Fastify + validação)
7. useMonthlyPreparation.ts (hooks React Query)
8. Componentes React (MonthlyPreparationPage, PeriodSelector, PreparationProgress, 
   PreparationSummary, WorkItemsList, SprintDetails)
```

---

## COMO USAR ESTE PROMPT

### No Claude Code (terminal):
```bash
# Cole o prompt inteiro e peça para implementar arquivo por arquivo:
# "Implemente o arquivo 1: monthly.schema.ts"
# Depois: "Agora implemente o arquivo 2: modelos Prisma"
# Depois: "Agora implemente o arquivo 3: workitem.service.ts"
# E assim por diante na ordem sugerida (total: 8 itens)
```

### No Codex / Copilot:
```
# Cole o "Contexto do Projeto" no início
# Depois cole a seção do arquivo específico que quer implementar
# Ex: Cole "Arquivo 3: workitem.service.ts" para implementar a coleta de WIs
# Se precisar das interfaces, cole também o monthly.schema.ts
```

### Se a sessão acabar (limite de tokens):
```
# Inicie nova sessão com:
# 1. O "Contexto do Projeto" (sempre no início)
# 2. A seção do próximo arquivo a implementar
# 3. Se necessário, cole as interfaces do monthly.schema.ts
# 4. Mencione quais arquivos já foram implementados para contexto
# 5. Lembre que os serviços da Etapa 0 estão disponíveis e devem ser REUTILIZADOS
```

### Testando após implementação:
```bash
# 1. Rodar migration:
npx prisma migrate dev --name add_monthly_preparation_models

# 2. Testar coleta de Work Items:
curl -X POST http://localhost:3000/api/rda/monthly/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "xxx",
    "period": {"month": 1, "year": 2026},
    "azureDevOps": {
      "organization": "your-org",
      "project": "PAIR",
      "teamName": "PAIR Team"
    }
  }'

# 3. Verificar snapshots:
curl http://localhost:3000/api/rda/monthly/snapshots/xxx

# 4. Ver Work Items coletados:
curl http://localhost:3000/api/rda/monthly/workitems/xxx/2026-01

# 5. Ver Sprints:
curl http://localhost:3000/api/rda/monthly/sprints/xxx/2026-01

# 6. Testar busca RAG com dados do período:
curl -X POST http://localhost:3000/api/rda/search \
  -H "Content-Type: application/json" \
  -d '{"projectId": "xxx", "query": "atividades Sprint 5 janeiro", "topK": 5}'
# → Deve retornar chunks de Work Items e Sprints do período
```

---

## RELACIONAMENTO COM AS OUTRAS ETAPAS

```
ETAPA 0 (Setup) → fornece:
  - EmbeddingService (gerar embeddings, busca híbrida)
  - ChunkingService (estimar tokens)
  - DocumentIngestionService (processar documentos novos)
  - WikiIngestionService (sync incremental da Wiki)
  - ProjectContextService (verificar/atualizar contexto)
  - Base vetorial pgvector já configurada

ETAPA 1 (esta) → produz:
  - WorkItemSnapshots no banco (dados estruturados)
  - SprintSnapshots no banco (dados agregados)
  - Chunks no pgvector com sourceType='workitem' e sourceType='sprint'
  - MonthlySnapshot como "passaporte" para a Etapa 2

ETAPA 2 (Preflight) → consome:
  - MonthlySnapshot para verificar se dados estão prontos
  - Contadores do snapshot para validar cobertura de dados

ETAPA 3 (Geração) → consome:
  - Chunks de Work Items e Sprints via busca híbrida
  - WorkItemSnapshots para dados estruturados (links, IDs)
  - SprintSnapshots para métricas e URLs de evidência
  - AzureDevOpsUrlBuilder para gerar links de evidência
```
