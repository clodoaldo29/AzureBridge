# PROMPT DE IMPLEMENTAÇÃO — ETAPA 2: PREFLIGHT E VALIDAÇÃO PRÉ-GERAÇÃO

## Contexto do Projeto (cole isso no início de qualquer sessão)

```
Você é um desenvolvedor sênior TypeScript/Node.js implementando o módulo de "Preflight 
e Validação" do sistema AzureBridge v2.0 — um sistema de geração automática de RDA 
(Relatório Demonstrativo Anual - Mensal) para projetos de software.

A Etapa 2 é executada ANTES de cada geração de RDA. Ela verifica se TODOS os recursos 
necessários estão disponíveis e válidos, evitando que a geração falhe no meio do processo.
O Preflight executa verificações em múltiplas camadas:

1. Verifica se o template DOCX ativo existe e é compatível
2. Carrega e valida o Guia de Preenchimento (regras para os agentes)
3. Verifica se o MonthlySnapshot do período está pronto (Etapa 1 concluída)
4. Verifica cobertura de dados: Work Items, Sprints, Wiki, documentos base
5. Verifica se o ProjectContext existe e está atualizado
6. Valida que fontes de dados são suficientes para os placeholders obrigatórios
7. Monta o contexto completo que será passado ao Pipeline de Geração (Etapa 3)
8. Cria o registro RDAGeneration no banco com status 'queued'

Se QUALQUER verificação crítica falhar, a geração é BLOQUEADA e o usuário recebe 
uma mensagem clara do que precisa ser corrigido, com ações sugeridas.

## Stack do Projeto (já existente e configurado)
- Runtime: Node.js 20 + TypeScript (ESM)
- Framework HTTP: Fastify 4.26 com @fastify/multipart para uploads
- ORM: Prisma 5.9.1 com PostgreSQL via Supabase
- Validação: Zod 3.22.4
- LLM: Anthropic SDK 0.74.0 (claude-sonnet-4-20250514)
- Embeddings: OpenAI SDK (text-embedding-3-small, 1536 dimensões)
- Template DOCX: docxtemplater 3.68.1 + pizzip 3.2.0
- Frontend: React 18 + React Query 5 + Zustand + shadcn/ui + Tailwind CSS
- Busca vetorial: PostgreSQL com extensão pgvector (Supabase)
- Azure DevOps: azure-devops-node-api ^12.5.0

## Dependências novas necessárias para esta etapa
- Nenhuma dependência nova — tudo já foi instalado nas etapas anteriores.

## O que já existe da Etapa -1 (Template Fixo)

Artefatos da Etapa -1 (já disponíveis, não precisam ser implementados):
- Template_RDA_Com_Loops.docx: template DOCX com loops docxtemplater 
  - Loop externo: {#ATIVIDADES}...{/ATIVIDADES} (N atividades por RDA)
  - Loop interno: {#RESPONSAVEIS}...{/RESPONSAVEIS} (N responsáveis por atividade)
  - Placeholders simples: {PROJETO_NOME}, {ANO_BASE}, {COMPETENCIA}, {COORDENADOR_TECNICO}, {RESULTADOS_ALCANCADOS}
  - Placeholders de atividade: {NUMERO_ATIVIDADE}, {NOME_ATIVIDADE}, {PERIODO_ATIVIDADE}, 
    {DESCRICAO_ATIVIDADE}, {JUSTIFICATIVA_ATIVIDADE}, {RESULTADO_OBTIDO_ATIVIDADE}, {DISPENDIOS_ATIVIDADE}
  - Placeholders de responsável: {NOME_RESPONSAVEL}, {CPF_RESPONSAVEL}, {JUSTIFICATIVA_RESPONSAVEL}
- Guia_Preenchimento_Placeholders_RDA.md: documento detalhado com regras de preenchimento 
  incluindo links de evidência. Este guia é lido pelo Preflight e passado como contexto 
  para os agentes de geração na Etapa 3.

## O que já existe da Etapa 0 (Setup/RAG)

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
    • estimateTokens(text) → number
  - embedding.service.ts → EmbeddingService
    • hybridSearch(options: SearchOptions) → SearchResult[]
    • deleteChunksBySource(projectId, sourceType, sourceId?) → number
  - document-ingestion.service.ts → DocumentIngestionService
    • ingestDocument(file, projectId, documentType?) → IngestionResult
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

## O que já existe da Etapa 1 (Preparação Mensal)

Schemas (src/modules/rda/schemas/monthly.schema.ts):
  - MonthPeriod, WorkItemQueryParams, NormalizedWorkItem
  - WorkItemCollectionResult, NormalizedSprint, SprintAggregation
  - SprintCollectionResult, MonthlyPreparationConfig
  - MonthlyPreparationStatus, StepStatus, MonthlyPreparationResult

Serviços da Etapa 1:
  - workitem.service.ts → WorkItemService
    • collectWorkItems(params) → WorkItemCollectionResult
    • getWorkItemSnapshots(projectId, periodKey) → WorkItemSnapshot[]
    • getWorkItemStats(projectId, periodKey) → { total, byType, byState, ... }
  - sprint.service.ts → SprintService
    • collectSprints(projectId, org, project, team, period) → SprintCollectionResult
    • getSprintSnapshots(projectId, periodKey) → SprintSnapshot[]
  - monthly-preparation.service.ts → MonthlyPreparationService
    • prepare(config) → MonthlyPreparationResult
    • getStatus(projectId, period) → MonthlyPreparationStatus | null
    • listSnapshots(projectId) → MonthlySnapshot[]
    • deletePreparation(projectId, period) → void

Modelos Prisma existentes (todos):
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

model WorkItemSnapshot {
  id              String   @id @default(uuid())
  projectId       String
  workItemId      Int
  type            String
  title           String
  state           String
  assignedTo      String?
  areaPath        String?
  iterationPath   String?
  tags            String?
  priority        Int?
  storyPoints     Float?
  description     String?
  acceptanceCriteria String?
  createdDate     DateTime
  changedDate     DateTime
  closedDate      DateTime?
  parentId        Int?
  url             String?
  periodKey       String
  collectedAt     DateTime @default(now())
  @@unique([projectId, workItemId, periodKey])
  @@index([projectId, periodKey])
  @@index([projectId, iterationPath])
  @@index([projectId, state])
  @@index([workItemId])
}

model SprintSnapshot {
  id                   String   @id @default(uuid())
  projectId            String
  sprintName           String
  iterationPath        String
  startDate            DateTime?
  endDate              DateTime?
  totalWorkItems       Int      @default(0)
  completedItems       Int      @default(0)
  activeItems          Int      @default(0)
  newItems             Int      @default(0)
  removedItems         Int      @default(0)
  totalStoryPoints     Float?
  completedStoryPoints Float?
  tasksByState         Json     @default("{}")
  bugsByState          Json     @default("{}")
  storiesByState       Json     @default("{}")
  teamCapacity         Float?
  velocity             Float?
  taskboardUrl         String?
  period               String
  collectedAt          DateTime @default(now())
  @@unique([projectId, iterationPath, period])
  @@index([projectId, period])
}

model MonthlySnapshot {
  id                String   @id @default(uuid())
  projectId         String
  period            String
  status            String   @default("collecting")
  workItemsTotal    Int      @default(0)
  workItemsNew      Int      @default(0)
  workItemsClosed   Int      @default(0)
  workItemsActive   Int      @default(0)
  sprintsCount      Int      @default(0)
  wikiPagesUpdated  Int      @default(0)
  documentsUploaded Int      @default(0)
  chunksCreated     Int      @default(0)
  workItemsStatus   String   @default("pending")
  sprintsStatus     String   @default("pending")
  wikiStatus        String   @default("pending")
  documentsStatus   String   @default("pending")
  contextStatus     String   @default("pending")
  errors            Json     @default("[]")
  startedAt         DateTime?
  completedAt       DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@unique([projectId, period])
  @@index([projectId])
  @@index([status])
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
│   ├── project-setup.service.ts      # Etapa 0
│   ├── workitem.service.ts           # Etapa 1
│   ├── sprint.service.ts             # Etapa 1
│   └── monthly-preparation.service.ts # Etapa 1
├── schemas/
│   ├── rag.schema.ts                 # Etapa 0
│   └── monthly.schema.ts             # Etapa 1
├── routes/
│   ├── rda.routes.ts
│   └── monthly.routes.ts             # Etapa 1
├── templates/
│   ├── Template_RDA_Com_Loops.docx
│   └── Guia_Preenchimento_Placeholders_RDA.md
└── utils/
    ├── storage-paths.ts
    └── url-builder.ts                # Etapa 0
```
```

---

## FASE 1: SCHEMAS E INTERFACES

### Arquivo 1: src/modules/rda/schemas/preflight.schema.ts

```
Crie todas as interfaces TypeScript e schemas Zod para o Preflight.

```typescript
// ============================================================
// INTERFACES PARA VERIFICAÇÕES DO PREFLIGHT
// ============================================================

/**
 * Configuração de entrada do Preflight.
 * Recebida pela rota que inicia a verificação + geração.
 */
interface PreflightConfig {
  projectId: string;
  period: MonthPeriod;             // Do monthly.schema.ts
  templateId?: string;             // Se não informado, usa o template ativo
  options?: {
    skipWikiCheck?: boolean;        // Pular verificação de Wiki (padrão: false)
    allowPartialData?: boolean;     // Permitir dados parciais (padrão: false)
    dryRun?: boolean;               // Apenas verificar, não criar RDAGeneration (padrão: false)
  };
}

/**
 * Resultado individual de cada verificação.
 */
interface PreflightCheck {
  name: string;                    // Nome legível da verificação
  key: string;                     // Chave programática (ex: 'template_active')
  status: 'pass' | 'fail' | 'warn' | 'skip';
  severity: 'critical' | 'warning' | 'info';
  message: string;                 // Mensagem descritiva do resultado
  details?: Record<string, any>;   // Dados adicionais (contadores, IDs, etc.)
  action?: string;                 // Ação sugerida ao usuário se falhou
  duration?: number;               // ms que a verificação levou
}

/**
 * Resultado completo do Preflight.
 */
interface PreflightResult {
  projectId: string;
  period: string;                  // "2026-01"
  status: 'approved' | 'blocked' | 'warning';
  
  // Todas as verificações executadas
  checks: PreflightCheck[];
  
  // Resumo
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
  };
  
  // Motivos de bloqueio (se status='blocked')
  blockers: string[];
  
  // Warnings que não bloqueiam mas devem ser mostrados
  warnings: string[];
  
  // Se aprovado, dados para a geração
  generationReady?: {
    generationId: string;          // ID do RDAGeneration criado
    templateId: string;
    templatePath: string;
    periodKey: string;
    
    // Contexto pré-montado para a Etapa 3
    context: GenerationContext;
  };
  
  duration: number;                // ms total do preflight
}

/**
 * Contexto completo montado pelo Preflight para a Etapa 3.
 * Contém TUDO que o Pipeline de Geração precisa, pré-carregado.
 * 
 * Isso evita que a Etapa 3 precise buscar dados que já foram
 * verificados pelo Preflight.
 */
interface GenerationContext {
  // Identificação
  projectId: string;
  periodKey: string;               // "2026-01"
  generationId: string;
  
  // Template
  templateId: string;
  templatePath: string;            // Caminho físico do template DOCX
  placeholders: PlaceholderInfo[]; // Lista de placeholders com metadados
  
  // Guia de Preenchimento (regras para os agentes)
  fillingGuide: string;            // Conteúdo do Guia_Preenchimento_Placeholders_RDA.md
  
  // ProjectContext (dados estruturados do projeto)
  projectContext: ProjectContextData;
  
  // Dados do período
  monthlySnapshot: {
    workItemsTotal: number;
    workItemsClosed: number;
    workItemsActive: number;
    sprintsCount: number;
    wikiPagesUpdated: number;
    chunksCreated: number;
  };
  
  // Configuração do Azure DevOps (para construir URLs de evidência)
  azureDevOps: {
    organization: string;
    project: string;
    teamName: string;
  };
  
  // Estatísticas de chunks disponíveis por sourceType
  chunkStats: {
    document: number;
    wiki: number;
    workitem: number;
    sprint: number;
    total: number;
  };
}

/**
 * Informações de cada placeholder do template.
 * Extraídas do template DOCX + enriquecidas com dados do Guia.
 */
interface PlaceholderInfo {
  name: string;                    // Ex: "PROJETO_NOME"
  type: 'simple' | 'loop' | 'nested_loop';
  required: boolean;
  section: string;                 // Seção do template onde aparece
  description?: string;            // Descrição do Guia de Preenchimento
  sourceHint?: string;             // Sugestão de fonte de dados (ex: "ProjectContext.projectName")
  loopVariable?: string;           // Para loops: nome da variável de iteração
  childPlaceholders?: PlaceholderInfo[]; // Para loops: placeholders internos
}

/**
 * Configuração de verificações do Preflight.
 * Define quais verificações são obrigatórias e seus limiares.
 */
interface PreflightCheckConfig {
  // Limiares configuráveis
  minWorkItems: number;            // Mínimo de work items para não bloquear (padrão: 1)
  minSprints: number;              // Mínimo de sprints (padrão: 0 — pode não ter sprint no mês)
  maxContextAge: number;           // Idade máxima do ProjectContext em dias (padrão: 60)
  maxWikiAge: number;              // Idade máxima da sync da Wiki em dias (padrão: 30)
  minChunksPerSource: number;      // Mínimo de chunks por tipo de fonte (padrão: 0)
  requiredSourceTypes: string[];   // Fontes obrigatórias (padrão: ['document', 'workitem'])
}
```

Crie também os schemas Zod correspondentes para:
- PreflightConfigSchema (validar entrada com defaults para options)
- PreflightResultSchema (para serialização na rota)
- GenerationContextSchema (validar o contexto montado)
- PlaceholderInfoSchema

IMPORTANTE: Exporte tudo com `export` para uso nos outros arquivos.
Importe MonthPeriod e ProjectContextData dos schemas das etapas anteriores.
```

---

## FASE 2: SERVIÇO DE PREFLIGHT

### Arquivo 2: src/modules/rda/services/preflight.service.ts

```
Crie o serviço principal de Preflight. Este é o coração da Etapa 2.
Executa verificações em sequência e monta o contexto para a geração.

```typescript
class PreflightService {
  constructor(
    private prisma: PrismaClient,
    private projectContextService: ProjectContextService,
    private embeddingService: EmbeddingService,
  ) {}

  /**
   * Executa o Preflight completo.
   * 
   * Fluxo sequencial de verificações:
   * 
   * 1. VERIFICAR TEMPLATE (crítico)
   *    - Buscar template ativo (status='active') para o projeto
   *    - Se templateId foi especificado, buscar esse template
   *    - Verificar se o arquivo DOCX existe no filesystem
   *    - Extrair placeholders do DOCX para validação
   *    → Se falhar: bloqueio — "Nenhum template ativo encontrado"
   * 
   * 2. VERIFICAR GUIA DE PREENCHIMENTO (crítico)
   *    - Verificar se Guia_Preenchimento_Placeholders_RDA.md existe
   *    - Ler o conteúdo do arquivo
   *    - Validar que não está vazio
   *    → Se falhar: bloqueio — "Guia de preenchimento não encontrado"
   * 
   * 3. VERIFICAR MONTHLY SNAPSHOT (crítico)
   *    - Buscar MonthlySnapshot para o período
   *    - Verificar se status='ready'
   *    → Se não existe: bloqueio — "Preparação mensal não executada para este período"
   *    → Se status='collecting': bloqueio — "Preparação mensal ainda em andamento"
   *    → Se status='failed': warning — "Preparação mensal teve erros (dados parciais)"
   * 
   * 4. VERIFICAR WORK ITEMS (crítico se requiredSourceTypes inclui 'workitem')
   *    - Contar WorkItemSnapshots do período
   *    - Verificar se total >= minWorkItems
   *    → Se zero: bloqueio — "Nenhum work item encontrado no período"
   *    → Se < minWorkItems: warning — "Poucos work items ({n} encontrados)"
   * 
   * 5. VERIFICAR SPRINTS (warning)
   *    - Contar SprintSnapshots do período
   *    - Verificar se total >= minSprints
   *    → Se zero: warning — "Nenhuma sprint encontrada no período"
   *    → Nunca bloqueia (projeto pode não usar sprints)
   * 
   * 6. VERIFICAR DOCUMENTOS BASE (warning)
   *    - Contar Documents do projeto com chunked=true
   *    → Se zero: warning — "Nenhum documento base indexado"
   *    → Não bloqueia se allowPartialData=true
   * 
   * 7. VERIFICAR WIKI (warning, pode ser skipped)
   *    - Se skipWikiCheck=true: skip
   *    - Contar WikiPages do projeto
   *    - Verificar data da última sync
   *    → Se zero: warning — "Wiki não sincronizada"
   *    → Se última sync > maxWikiAge dias: warning — "Wiki desatualizada (última sync: {data})"
   * 
   * 8. VERIFICAR PROJECT CONTEXT (crítico)
   *    - Buscar ProjectContext do projeto
   *    → Se não existe: bloqueio — "Contexto do projeto não criado (execute o Setup)"
   *    - Verificar lastUpdated
   *    → Se > maxContextAge dias: warning — "Contexto do projeto desatualizado ({n} dias)"
   * 
   * 9. VERIFICAR CHUNKS (warning)
   *    - Contar chunks por sourceType para o projeto
   *    - Verificar mínimos por tipo
   *    → Se zero chunks total: bloqueio
   *    → Se faltar algum sourceType obrigatório: warning
   * 
   * 10. VERIFICAR GERAÇÃO EXISTENTE (info)
   *     - Buscar RDAGeneration existente para o período
   *     → Se existe com status='completed': info — "Já existe um RDA gerado para este período"
   *     → Se existe com status='processing': bloqueio — "Geração em andamento"
   * 
   * APÓS VERIFICAÇÕES:
   * - Se algum check com severity='critical' falhou → status='blocked'
   * - Se apenas warnings → status='warning' (geração permitida)
   * - Se tudo passou → status='approved'
   * 
   * SE APROVADO E dryRun=false:
   * - Montar GenerationContext
   * - Criar RDAGeneration com status='queued'
   * - Retornar generationReady com o contexto
   */
  async runPreflight(config: PreflightConfig): Promise<PreflightResult>

  // ============================================================
  // VERIFICAÇÕES INDIVIDUAIS
  // ============================================================

  /**
   * Verifica template ativo e extrai placeholders.
   */
  private async checkTemplate(
    projectId: string,
    templateId?: string,
  ): Promise<PreflightCheck & { template?: RDATemplate; placeholders?: PlaceholderInfo[] }>

  /**
   * Verifica e carrega o Guia de Preenchimento.
   */
  private async checkFillingGuide(): Promise<PreflightCheck & { content?: string }>

  /**
   * Verifica MonthlySnapshot do período.
   */
  private async checkMonthlySnapshot(
    projectId: string,
    periodKey: string,
  ): Promise<PreflightCheck & { snapshot?: MonthlySnapshot }>

  /**
   * Verifica Work Items coletados para o período.
   */
  private async checkWorkItems(
    projectId: string,
    periodKey: string,
    minRequired: number,
  ): Promise<PreflightCheck>

  /**
   * Verifica Sprints coletadas para o período.
   */
  private async checkSprints(
    projectId: string,
    periodKey: string,
    minRequired: number,
  ): Promise<PreflightCheck>

  /**
   * Verifica documentos base indexados.
   */
  private async checkBaseDocuments(
    projectId: string,
  ): Promise<PreflightCheck>

  /**
   * Verifica Wiki sincronizada.
   */
  private async checkWiki(
    projectId: string,
    maxAgeDays: number,
    skip: boolean,
  ): Promise<PreflightCheck>

  /**
   * Verifica ProjectContext.
   */
  private async checkProjectContext(
    projectId: string,
    maxAgeDays: number,
  ): Promise<PreflightCheck & { context?: ProjectContextData }>

  /**
   * Conta chunks por sourceType.
   */
  private async checkChunks(
    projectId: string,
    requiredSources: string[],
  ): Promise<PreflightCheck & { stats?: Record<string, number> }>

  /**
   * Verifica se já existe geração para o período.
   */
  private async checkExistingGeneration(
    projectId: string,
    periodKey: string,
  ): Promise<PreflightCheck>

  // ============================================================
  // MONTAGEM DO CONTEXTO
  // ============================================================

  /**
   * Monta o GenerationContext completo para a Etapa 3.
   * 
   * Este contexto é salvo no RDAGeneration.metadata e evita que 
   * a Etapa 3 precise refazer as buscas do Preflight.
   * 
   * Inclui:
   * - Template e placeholders
   * - Guia de Preenchimento (texto completo)
   * - ProjectContext
   * - Dados do MonthlySnapshot
   * - Configuração Azure DevOps (extraída do ProjectContext ou variáveis de ambiente)
   * - Estatísticas de chunks
   */
  private async buildGenerationContext(
    projectId: string,
    periodKey: string,
    template: RDATemplate,
    placeholders: PlaceholderInfo[],
    fillingGuide: string,
    projectContext: ProjectContextData,
    snapshot: MonthlySnapshot,
    chunkStats: Record<string, number>,
  ): Promise<GenerationContext>

  /**
   * Cria o registro RDAGeneration no banco.
   * Status inicial: 'queued'
   * Salva o GenerationContext no campo metadata.
   */
  private async createGeneration(
    projectId: string,
    templateId: string,
    periodKey: string,
    context: GenerationContext,
  ): Promise<string> // retorna generationId

  // ============================================================
  // EXTRAÇÃO DE PLACEHOLDERS DO TEMPLATE
  // ============================================================

  /**
   * Extrai placeholders do template DOCX.
   * 
   * ABORDAGEM ROBUSTA (não usar regex simples no texto):
   * 1. Abrir DOCX via PizZip
   * 2. Ler word/document.xml
   * 3. Concatenar todos os <w:t> de cada <w:p> (reconstituir runs fragmentados)
   * 4. Buscar padrões {PLACEHOLDER}, {#LOOP}...{/LOOP} no texto concatenado
   * 5. Classificar: simple, loop, nested_loop
   * 
   * IMPORTANTE sobre o DOCX:
   * O Word fragmenta texto em múltiplos <w:r> (runs). 
   * Um placeholder como {PROJETO_NOME} pode estar dividido em:
   *   <w:r><w:t>{PROJETO_</w:t></w:r>
   *   <w:r><w:t>NOME}</w:t></w:r>
   * 
   * Por isso, PRIMEIRO concatenar todos os <w:t> dentro de cada <w:p>,
   * DEPOIS buscar os padrões no texto completo do parágrafo.
   */
  private extractPlaceholders(templatePath: string): Promise<PlaceholderInfo[]>

  /**
   * Enriquece placeholders com dados do Guia de Preenchimento.
   * Parseia o markdown do Guia e mapeia descriptions, sources e regras
   * para cada placeholder encontrado.
   */
  private enrichPlaceholdersFromGuide(
    placeholders: PlaceholderInfo[],
    guideContent: string,
  ): PlaceholderInfo[]

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Converte MonthPeriod para periodKey ("YYYY-MM")
   */
  private periodToKey(period: MonthPeriod): string

  /**
   * Calcula diferença em dias entre uma data e agora
   */
  private daysSince(date: Date): number

  /**
   * Defaults para PreflightCheckConfig
   */
  private getDefaultConfig(): PreflightCheckConfig
}
```

EXTRAÇÃO DE PLACEHOLDERS — DETALHAMENTO:

O template Template_RDA_Com_Loops.docx usa docxtemplater com estes padrões:

```
Simples:     {PLACEHOLDER_NAME}
Loop:        {#LOOP_NAME} ... {/LOOP_NAME}
Nested loop: {#OUTER} {#INNER} ... {/INNER} {/OUTER}
```

Regex para extração (após reconstruir texto dos parágrafos):
```typescript
// Placeholders simples
const simpleRegex = /\{([A-Z_]+)\}/g;

// Abertura de loop
const loopOpenRegex = /\{#([A-Z_]+)\}/g;

// Fechamento de loop
const loopCloseRegex = /\{\/([A-Z_]+)\}/g;
```

O GUIA DE PREENCHIMENTO tem este formato (para parseamento):
```markdown
## {PLACEHOLDER_NAME}
- **Tipo:** text | loop | ...
- **Obrigatório:** Sim/Não
- **Fonte:** ProjectContext.field / Azure DevOps / ...
- **Descrição:** Texto descritivo...
- **Regras:** Mínimo X palavras, deve conter Y...
```

O método enrichPlaceholdersFromGuide deve parsear este markdown e
mapear cada seção para o placeholder correspondente.

TRATAMENTO DE ERROS:
- Se o template DOCX está corrompido: bloqueio com mensagem clara
- Se o Guia não é markdown válido: warning (usa placeholders sem enriquecimento)
- Todas as verificações são executadas em try/catch individual
- O Preflight NUNCA crashar — sempre retorna PreflightResult com os erros
```

---

## FASE 3: ROTAS FASTIFY

### Arquivo 3: src/modules/rda/routes/preflight.routes.ts

```
Crie as rotas Fastify para o Preflight.

```typescript
// Registrar com prefixo: /api/rda/preflight

/**
 * POST /api/rda/preflight/run
 * 
 * Executa o Preflight completo.
 * Se aprovado e dryRun=false, cria RDAGeneration e retorna contexto.
 * Se aprovado e dryRun=true, apenas retorna resultado das verificações.
 * 
 * Body: PreflightConfig
 * 
 * Resposta 200: PreflightResult
 * Resposta 400: Validação do body falhou
 * Resposta 404: Projeto não encontrado
 */

/**
 * POST /api/rda/preflight/dry-run
 * 
 * Atalho para Preflight com dryRun=true.
 * Útil para o frontend verificar se pode gerar antes do usuário clicar "Gerar RDA".
 * 
 * Body: { projectId, period }
 * 
 * Resposta 200: PreflightResult (sem generationReady)
 */

/**
 * GET /api/rda/preflight/template-info/:projectId
 * 
 * Retorna informações do template ativo e seus placeholders.
 * Útil para o frontend mostrar a estrutura do RDA ao usuário.
 * 
 * Resposta 200: { template: RDATemplate, placeholders: PlaceholderInfo[] }
 * Resposta 404: Nenhum template ativo
 */

/**
 * GET /api/rda/preflight/readiness/:projectId/:period
 * 
 * Verifica rapidamente se o projeto está pronto para gerar RDA do período.
 * Versão simplificada do Preflight — não monta contexto, apenas verifica.
 * Retorna status simplificado + lista de problemas.
 * 
 * Usado pelo frontend para mostrar ícone verde/amarelo/vermelho na lista de meses.
 * 
 * Resposta 200: { ready: boolean, issues: string[], warnings: string[] }
 */

/**
 * GET /api/rda/preflight/filling-guide/:projectId
 * 
 * Retorna o conteúdo do Guia de Preenchimento.
 * Pode ser usado pelo frontend para mostrar as regras ao usuário.
 * 
 * Resposta 200: { content: string, placeholderCount: number }
 * Resposta 404: Guia não encontrado
 */
```

VALIDAÇÕES NAS ROTAS:
- projectId: uuid válido, projeto deve existir
- period: objeto com month (1-12) e year (>= 2020)
- Verificar que AZURE_DEVOPS_ORG_URL e AZURE_DEVOPS_PAT estão configuradas
```

---

## FASE 4: FRONTEND

### Arquivo 4: src/hooks/usePreflight.ts

```
Crie os hooks React Query para o Preflight.

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

const API_BASE = '/api/rda/preflight';

/**
 * Hook para executar o Preflight completo.
 * Retorna mutation que pode ser chamada quando o usuário clica "Gerar RDA".
 */
export function useRunPreflight() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: PreflightConfig) =>
      axios.post(`${API_BASE}/run`, config).then(r => r.data as PreflightResult),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['readiness', variables.projectId] });
    },
  });
}

/**
 * Hook para dry-run (verificação sem criar geração).
 * Executado automaticamente quando o usuário seleciona um período.
 */
export function useDryRun(projectId: string, period: MonthPeriod, enabled = false) {
  return useQuery({
    queryKey: ['preflight-dryrun', projectId, period],
    queryFn: () => axios.post(`${API_BASE}/dry-run`, { projectId, period }).then(r => r.data),
    enabled: enabled && !!projectId,
    staleTime: 30_000, // Cache por 30 segundos
  });
}

/**
 * Hook para verificar readiness de um período (versão rápida).
 * Usado para indicadores visuais na lista de meses.
 */
export function useReadiness(projectId: string, period: string, enabled = true) {
  return useQuery({
    queryKey: ['readiness', projectId, period],
    queryFn: () => axios.get(`${API_BASE}/readiness/${projectId}/${period}`).then(r => r.data),
    enabled: enabled && !!projectId && !!period,
    staleTime: 60_000, // Cache por 1 minuto
  });
}

/**
 * Hook para informações do template ativo.
 */
export function useTemplateInfo(projectId: string) {
  return useQuery({
    queryKey: ['template-info', projectId],
    queryFn: () => axios.get(`${API_BASE}/template-info/${projectId}`).then(r => r.data),
    enabled: !!projectId,
  });
}

/**
 * Hook para o Guia de Preenchimento.
 */
export function useFillingGuide(projectId: string) {
  return useQuery({
    queryKey: ['filling-guide', projectId],
    queryFn: () => axios.get(`${API_BASE}/filling-guide/${projectId}`).then(r => r.data),
    enabled: !!projectId,
  });
}
```
```

---

### Arquivo 5: src/components/rda/Preflight/ (componentes React)

```
Crie os componentes React para a interface do Preflight.
O Preflight é integrado ao fluxo de geração — não é uma tela separada,
mas sim o "passo 1" do wizard de geração.

### Componente 1: PreflightPanel.tsx

Painel principal de Preflight. Mostrado quando o usuário clica "Gerar RDA"
na tela de Preparação Mensal. Executa as verificações e mostra resultados.

Fluxo da UI:
1. Ao montar, executa automaticamente o dry-run
2. Mostra checklist vertical com status de cada verificação:
   - ✅ Pass (verde)
   - ❌ Fail (vermelho) — com ação sugerida
   - ⚠️ Warning (amarelo)
   - ⏭️ Skipped (cinza)
3. Na parte inferior:
   - Se aprovado: botão "Iniciar Geração" (primário, verde)
   - Se blocked: botão desabilitado + mensagem de bloqueio
   - Se warning: botão "Gerar Mesmo Assim" (com confirmação)

Layout:
```
┌────────────────────────────────────────────┐
│  ⚡ Preflight — Verificação Pré-Geração    │
│  Período: Janeiro 2026                      │
├────────────────────────────────────────────┤
│  ✅ Template ativo encontrado               │
│     Template_RDA_Com_Loops.docx             │
│                                             │
│  ✅ Guia de preenchimento carregado         │
│     15 placeholders mapeados                │
│                                             │
│  ✅ Preparação mensal concluída             │
│     142 work items • 3 sprints • 8 wiki     │
│                                             │
│  ✅ Work Items do período                   │
│     142 total (45 fechados, 30 ativos)      │
│                                             │
│  ⚠️ Wiki desatualizada                     │
│     Última sync: 15 dias atrás              │
│     [Sincronizar Wiki]                      │
│                                             │
│  ✅ Contexto do projeto                     │
│     Atualizado há 5 dias                    │
│                                             │
│  ✅ Base de conhecimento                    │
│     847 chunks (doc:320, wiki:185,          │
│     workitem:302, sprint:40)                │
├────────────────────────────────────────────┤
│  Status: ⚠️ Aprovado com warnings           │
│                                             │
│  [Sincronizar Wiki]  [Iniciar Geração →]   │
└────────────────────────────────────────────┘
```

### Componente 2: PreflightCheckItem.tsx

Componente individual de cada verificação na checklist:
- Ícone de status à esquerda
- Nome da verificação em negrito
- Descrição/detalhes em texto menor
- Se falhou: botão de ação sugerida à direita
- Animação de loading enquanto verifica

Props:
- check: PreflightCheck
- onAction?: () => void

### Componente 3: PreflightSummaryBanner.tsx

Banner no topo mostrando o resultado final do Preflight:
- Verde: "Pronto para gerar" com ícone CheckCircle
- Amarelo: "Aprovado com {n} avisos" com ícone AlertTriangle
- Vermelho: "Geração bloqueada — {n} problemas encontrados" com ícone XCircle
- Loading: "Verificando..." com spinner

### Componente 4: TemplatePreview.tsx

Prévia do template com placeholders:
- Lista de seções do template
- Para cada seção: placeholders que serão preenchidos
- Indicação visual de loops ({#ATIVIDADES}...{/ATIVIDADES})
- Para cada placeholder: nome, tipo, obrigatório/opcional, descrição do Guia
- Usado como informação complementar para o usuário

### Componente 5: GenerationReadinessIndicator.tsx

Componente compacto (badge/ícone) para mostrar na lista de meses:
- 🟢 Pronto para gerar (preflight aprovado)
- 🟡 Com avisos
- 🔴 Bloqueado  
- ⚪ Não verificado
- Usa useReadiness com polling leve

Pequeno o suficiente para ser integrado no PeriodSelector da Etapa 1.

Use shadcn/ui: Card, Button, Badge, Alert, AlertDescription, Separator,
  Dialog, DialogContent, DialogTrigger, Tooltip, ScrollArea
Use Tailwind CSS para todos os estilos
Use Lucide React para ícones: CheckCircle, XCircle, AlertTriangle, 
  SkipForward, Loader2, FileText, Database, Calendar, Users, 
  ArrowRight, RefreshCw, Info, Shield, Zap, Eye
Use date-fns com locale ptBR para tempos relativos (formatDistanceToNow)
```

---

## REGRAS GERAIS DE IMPLEMENTAÇÃO

```
1. TypeScript estrito: sem 'any' desnecessário, interfaces para tudo
2. Tratamento de erros: try/catch com mensagens claras em português, nunca crashar silenciosamente
3. Logging: usar console.log com prefixos:
   - [Preflight] para o serviço principal
   - [Template] para extração de placeholders
   - [Guide] para parsing do Guia de Preenchimento
4. Imports: ESM (import/export), compatível com o setup existente do projeto
5. Zod: validar todas as entradas de rotas
6. Raw SQL: usar $queryRaw / $executeRaw do Prisma para operações com pgvector
   SEMPRE parametrizar queries para evitar SQL injection
7. Todos os textos de UI e mensagens de erro em português brasileiro
8. Performance: logar duração de cada verificação + total
9. Manter compatibilidade com os serviços das Etapas 0 e 1 — reutilizar sem modificar
10. O Preflight NUNCA deve crashar — sempre retorna PreflightResult com status e erros
11. Verificações são executadas em sequência para poder curto-circuitar se crítico falhar
12. O GenerationContext é armazenado no RDAGeneration.metadata como JSON
```

---

## NENHUMA DEPENDÊNCIA NOVA

```
Todas as dependências já estão instaladas:
- pizzip (leitura do DOCX para extrair placeholders)
- @prisma/client (banco)
- zod (validação)
- Todas as libs do frontend (React, React Query, shadcn, etc.)
```

---

## ORDEM DE IMPLEMENTAÇÃO SUGERIDA

```
Implemente na seguinte ordem (cada item depende dos anteriores):

1. preflight.schema.ts (interfaces TypeScript e Zod schemas)
2. preflight.service.ts (serviço principal com verificações + montagem de contexto)
3. preflight.routes.ts (rotas Fastify)
4. usePreflight.ts (hooks React Query)
5. Componentes React (PreflightPanel, PreflightCheckItem, PreflightSummaryBanner,
   TemplatePreview, GenerationReadinessIndicator)
```

---

## COMO USAR ESTE PROMPT

### No Claude Code (terminal):
```bash
# Cole o prompt inteiro e peça para implementar arquivo por arquivo:
# "Implemente o arquivo 1: preflight.schema.ts"
# Depois: "Agora implemente o arquivo 2: preflight.service.ts"
# E assim por diante na ordem sugerida (total: 5 itens)
```

### Se a sessão acabar (limite de tokens):
```
# Inicie nova sessão com:
# 1. O "Contexto do Projeto" (sempre no início)
# 2. A seção do próximo arquivo a implementar
# 3. Se necessário, cole as interfaces do preflight.schema.ts
# 4. Mencione quais arquivos já foram implementados para contexto
# 5. Lembre que os serviços das Etapas 0 e 1 estão disponíveis
```

### Testando após implementação:
```bash
# 1. Testar dry-run:
curl -X POST http://localhost:3000/api/rda/preflight/dry-run \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "xxx",
    "period": {"month": 1, "year": 2026}
  }'
# → Deve retornar checklist de verificações sem criar geração

# 2. Testar readiness rápida:
curl http://localhost:3000/api/rda/preflight/readiness/xxx/2026-01
# → Deve retornar { ready: true/false, issues: [...], warnings: [...] }

# 3. Testar template info:
curl http://localhost:3000/api/rda/preflight/template-info/xxx
# → Deve retornar template ativo com placeholders extraídos

# 4. Testar preflight completo (cria geração):
curl -X POST http://localhost:3000/api/rda/preflight/run \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "xxx",
    "period": {"month": 1, "year": 2026}
  }'
# → Se aprovado, retorna generationReady com generationId

# 5. Verificar RDAGeneration criado:
# SELECT * FROM "RDAGeneration" WHERE "projectId" = 'xxx' ORDER BY "createdAt" DESC LIMIT 1;
# → Deve ter status='queued' e metadata com GenerationContext completo
```

---

## RELACIONAMENTO COM AS OUTRAS ETAPAS

```
ETAPA 0 (Setup) → fornece:
  - EmbeddingService (contagem de chunks por sourceType)
  - ProjectContextService (verificar existência e idade do contexto)
  - Base vetorial pgvector já configurada

ETAPA 1 (Preparação Mensal) → fornece:
  - MonthlySnapshot com status e contadores
  - WorkItemSnapshots (contagem para verificação)
  - SprintSnapshots (contagem para verificação)

ETAPA 2 (esta) → produz:
  - PreflightResult com status de aprovação
  - GenerationContext completo (template + guia + contexto + dados do período)
  - RDAGeneration com status='queued' e metadata contendo o contexto
  - "Passaporte" que a Etapa 3 consome para iniciar a geração

ETAPA 3 (Pipeline de Geração) → consome:
  - RDAGeneration.metadata → GenerationContext
    Contém TUDO que os agentes precisam:
    - templatePath: caminho do template DOCX
    - placeholders: lista completa com metadados
    - fillingGuide: texto do Guia de Preenchimento (regras para os agentes)
    - projectContext: dados estruturados do projeto
    - monthlySnapshot: resumo dos dados do período
    - azureDevOps: config para construir URLs de evidência
    - chunkStats: quantos chunks de cada tipo estão disponíveis
  - generationId para atualizar progresso e resultados parciais

ETAPA 4 (Revisão) → consome:
  - RDAGeneration com resultados + validationReport
```
