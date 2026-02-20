# PROMPT DE IMPLEMENTAÇÃO — ETAPA 0: SETUP DO PROJETO E RAG

## Contexto do Projeto (cole isso no início de qualquer sessão)

```
Você é um desenvolvedor sênior TypeScript/Node.js implementando o módulo de "Setup do Projeto 
e RAG" do sistema AzureBridge v2.0 — um sistema de geração automática de RDA (Relatório 
Demonstrativo Anual - Mensal) para projetos de software.

A Etapa 0 é executada uma única vez por projeto e cria toda a base de conhecimento necessária 
para a geração dos RDAs mensais. O processo envolve:
1. Ingestão de documentos base (PDF, DOCX) com extração inteligente de texto
2. Chunking semântico (divisão em blocos otimizados para busca)
3. Geração de embeddings vetoriais e armazenamento com pgvector
4. Busca híbrida (vetorial + full-text) via Reciprocal Rank Fusion
5. Construção do ProjectContext (entidade persistente com dados estruturados do projeto)

## Stack do Projeto (já existente e configurado)
- Runtime: Node.js 20 + TypeScript (ESM)
- Framework HTTP: Fastify 4.26 com @fastify/multipart para uploads
- ORM: Prisma 5.9.1 com PostgreSQL via Supabase
- Validação: Zod 3.22.4
- LLM: Anthropic SDK 0.74.0 (claude-sonnet-4-20250514)
- Template DOCX: docxtemplater 3.68.1 + pizzip 3.2.0
- Extração de texto: mammoth 1.11.0 (DOCX), pdf-parse 1.1.1 (PDF)
- Frontend: React 18 + React Query 5 + Zustand + shadcn/ui + Tailwind CSS
- Busca vetorial: PostgreSQL com extensão pgvector (Supabase já suporta nativamente)

## Dependências novas necessárias para esta etapa
- openai (SDK OpenAI para embeddings text-embedding-3-small)
  → npm install openai
- Nenhuma outra dependência nova — pdf-parse, mammoth e pizzip já existem

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
- Guia_Preenchimento_Placeholders_RDA.md: documento detalhado descrevendo como cada 
  placeholder deve ser preenchido, incluindo:
  - Tipo, obrigatoriedade e fonte de dados de cada campo
  - Regras de redação (mínimo de palavras, o que deve conter obrigatoriamente)
  - Regra de links de evidência (URLs do Azure DevOps, Figma, SharePoint, Planner)
  - Exemplos concretos de preenchimento
  - Estrutura JSON completa para o docxtemplater
  → Este guia alimenta os system prompts dos agentes de geração (Etapa 3)

Modelos Prisma existentes relevantes: RDATemplate, RDASchema, RDAExample

## Modelos Prisma já existentes
```prisma
model Document {
  id            String   @id @default(uuid())
  projectId     String
  filename      String
  fileType      String           // 'pdf' | 'docx'
  filePath      String
  fileSize      Int
  extractedText String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model WikiPage {
  id            String   @id @default(uuid())
  projectId     String
  wikiId        String
  path          String
  title         String
  content       String           // Markdown
  version       Int
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([projectId, wikiId, path])
}

model RDATemplate {
  id            String   @id @default(uuid())
  projectId     String?
  name          String
  filePath      String
  placeholders  Json
  status        String   @default("active")
  schemaId      String?
  sourceModels  Json?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model RDAGeneration {
  id            String   @id @default(uuid())
  projectId     String
  templateId    String
  status        String   @default("queued")
  progress      Int      @default(0)
  currentStep   String?
  tokensUsed    Int      @default(0)
  partialResults Json?
  filePath      String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

## Serviços já existentes relevantes
```
claude.service.ts
  - complete(system, messages, options) → texto livre
  - completeJSON<T>(system, messages, options) → resposta JSON parseada e tipada
  - Retry automático (3 tentativas, backoff com jitter) para erro 429

wiki.service.ts
  - syncWiki(projectId, organization, project) → sincroniza páginas da Wiki Azure DevOps
  - getPages(projectId) → lista páginas sincronizadas
  - searchPages(projectId, query) → busca full-text nas páginas

document.service.ts
  - uploadDocument(file, projectId) → salva arquivo + extrai texto básico
  - getDocuments(projectId) → lista documentos do projeto
  - deleteDocument(id) → remove documento

storage-paths.ts
  - RDA_UPLOADS_DIR, RDA_TEMPLATES_DIR, RDA_GENERATED_DIR
  - ensureDirectory(path) → cria diretório se não existir
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
│   └── rda-template.service.ts
├── schemas/
│   (vazio — rag.schema.ts será criado nesta etapa)
├── routes/
│   └── rda.routes.ts
├── templates/
│   ├── Template_RDA_Com_Loops.docx          # Template fixo da Etapa -1
│   └── Guia_Preenchimento_Placeholders.md   # Guia de preenchimento da Etapa -1
└── utils/
    └── storage-paths.ts
```
```

---

## FASE 1: MODELOS PRISMA E SCHEMAS

### Arquivo 1: Atualizações no schema.prisma

```
Adicione os seguintes modelos ao schema.prisma existente. Estes modelos são a fundação 
de toda a camada RAG e do ProjectContext.

### Novo modelo: DocumentChunk

```prisma
model DocumentChunk {
  id            String   @id @default(uuid())
  documentId    String?                        // Referência ao Document (se veio de PDF/DOCX)
  wikiPageId    String?                        // Referência ao WikiPage (se veio da Wiki)
  projectId     String                         // Projeto ao qual pertence
  content       String                         // Texto do chunk
  metadata      Json                           // {page, section, contentType, position, documentName}
  embedding     Unsupported("vector(1536)")    // Embedding vetorial (pgvector)
  chunkIndex    Int                            // Índice sequencial dentro do documento
  tokenCount    Int                            // Contagem de tokens do chunk
  sourceType    String                         // 'document' | 'wiki' | 'workitem' | 'sprint'
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  document      Document?  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  wikiPage      WikiPage?  @relation(fields: [wikiPageId], references: [id], onDelete: Cascade)

  @@index([projectId])
  @@index([documentId])
  @@index([wikiPageId])
  @@index([sourceType])
  @@index([projectId, sourceType])
}
```

### Novo modelo: ProjectContext

```prisma
model ProjectContext {
  id              String   @id @default(uuid())
  projectId       String   @unique              // Um contexto por projeto
  projectName     String
  projectScope    String                        // Escopo extraído do Documento de Visão
  objectives      Json     @default("[]")       // [{description, priority}]
  teamMembers     Json     @default("[]")       // [{name, role, area}]
  technologies    Json     @default("[]")       // [{name, category, version}]
  keyMilestones   Json     @default("[]")       // [{name, date, deliverable, status}]
  businessRules   Json     @default("[]")       // [{id, description, area, priority}]
  deliveryPlan    Json     @default("[]")       // [{phase, startDate, endDate, objectives, deliverables}]
  stakeholders    Json     @default("[]")       // [{name, role, organization, contact}]
  summary         String?                       // Resumo geral do projeto gerado pelo Claude
  lastUpdated     DateTime @updatedAt
  createdAt       DateTime @default(now())
}
```

### Atualizações nos modelos existentes

Adicione relações e campos novos:

```prisma
// Atualizar model Document — adicionar:
model Document {
  // ... campos existentes ...
  extractionMethod  String?    // 'pdf-parse' | 'mammoth' | 'vision' | 'pizzip-xml'
  extractionQuality Float?     // 0.0 a 1.0 (qualidade estimada da extração)
  chunked           Boolean    @default(false)  // Se já passou pelo chunking
  chunkCount        Int?       // Quantidade de chunks gerados
  chunks            DocumentChunk[]  // Relação com chunks
}

// Atualizar model WikiPage — adicionar:
model WikiPage {
  // ... campos existentes ...
  chunked           Boolean    @default(false)
  chunkCount        Int?
  chunks            DocumentChunk[]
}
```

### Migration SQL para pgvector (rodar manualmente no Supabase)

Crie também um arquivo `prisma/migrations/manual/001_pgvector_setup.sql`:

```sql
-- Habilitar extensão pgvector (Supabase já inclui, mas garantir)
CREATE EXTENSION IF NOT EXISTS vector;

-- Índice vetorial para busca por similaridade (IVFFlat)
-- Usar APÓS ter pelo menos 1000 chunks para o índice ser eficiente
-- Para menos chunks, a busca sequencial é mais rápida
CREATE INDEX IF NOT EXISTS idx_document_chunk_embedding 
  ON "DocumentChunk" 
  USING ivfflat (embedding vector_cosine_ops) 
  WITH (lists = 100);

-- Coluna tsvector para busca full-text em português
ALTER TABLE "DocumentChunk" 
  ADD COLUMN IF NOT EXISTS tsv tsvector 
  GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED;

-- Índice GIN para busca full-text
CREATE INDEX IF NOT EXISTS idx_document_chunk_tsv 
  ON "DocumentChunk" 
  USING gin(tsv);

-- Índice composto para filtrar por projeto + sourceType na busca
CREATE INDEX IF NOT EXISTS idx_document_chunk_project_source 
  ON "DocumentChunk"("projectId", "sourceType");

-- Função helper para busca vetorial com filtros
CREATE OR REPLACE FUNCTION search_chunks_hybrid(
  query_embedding vector(1536),
  p_project_id UUID,
  p_source_types TEXT[] DEFAULT NULL,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  content TEXT,
  metadata JSONB,
  source_type TEXT,
  similarity FLOAT,
  ts_rank FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    dc.id,
    dc.content,
    dc.metadata,
    dc."sourceType",
    1 - (dc.embedding <=> query_embedding) AS similarity,
    0::FLOAT AS ts_rank
  FROM "DocumentChunk" dc
  WHERE dc."projectId" = p_project_id::TEXT
    AND (p_source_types IS NULL OR dc."sourceType" = ANY(p_source_types))
  ORDER BY dc.embedding <=> query_embedding
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
```

IMPORTANTE:
- O Prisma não suporta nativamente o tipo `vector`. Por isso usamos `Unsupported("vector(1536)")` 
  no schema e raw queries ($queryRaw / $executeRaw) para operações com embeddings.
- A migration SQL deve ser rodada manualmente no Supabase SQL Editor ou via psql.
- O índice IVFFlat deve ser criado APÓS popular os chunks (precisa de dados para treinar).
  Em desenvolvimento, pode começar sem o índice (busca sequencial funciona para poucos chunks).
```

---

### Arquivo 2: src/modules/rda/schemas/rag.schema.ts

```
Crie todas as interfaces TypeScript e schemas Zod para a camada RAG.

```typescript
// ============================================================
// INTERFACES PARA CHUNKING
// ============================================================

interface ChunkingOptions {
  targetSize: number;        // Tamanho alvo em tokens (padrão: 1000)
  maxSize: number;           // Tamanho máximo em tokens (padrão: 1500)
  overlap: number;           // Overlap em tokens (padrão: 120)
  separators: string[];      // Separadores por prioridade: ['\n## ', '\n### ', '\n\n', '\n', '. ']
}

interface ChunkMetadata {
  documentId?: string;
  wikiPageId?: string;
  documentName: string;
  pageNumber?: number;          // Para PDFs
  sectionHeading?: string;      // Heading mais próximo acima do chunk
  contentType: 'text' | 'table' | 'list' | 'code' | 'mixed';
  position: number;             // Posição sequencial no documento original
  sourceType: 'document' | 'wiki' | 'workitem' | 'sprint';
  urls?: string[];              // URLs encontradas no chunk (preservadas na ingestão)
  urlTypes?: Array<{            // Classificação das URLs para uso nos agentes
    url: string;
    type: 'azure_devops_sprint' | 'azure_devops_wiki' | 'azure_devops_workitem' |
          'azure_devops_deliveryplan' | 'figma' | 'sharepoint' | 'planner' | 'network_path' | 'other';
  }>;
}

interface DocumentChunkData {
  content: string;
  metadata: ChunkMetadata;
  chunkIndex: number;
  tokenCount: number;
}

// ============================================================
// INTERFACES PARA EMBEDDINGS E BUSCA
// ============================================================

interface EmbeddingResult {
  text: string;
  embedding: number[];       // Vetor de 1536 dimensões
  tokenCount: number;
}

interface SearchResult {
  id: string;
  content: string;
  metadata: ChunkMetadata;
  sourceType: string;
  score: number;              // Score combinado (RRF ou similaridade)
  matchType: 'vector' | 'fulltext' | 'hybrid';
}

interface SearchOptions {
  projectId: string;
  query: string;
  topK?: number;              // Padrão: 10
  sourceTypes?: string[];     // Filtrar por tipo de fonte
  minScore?: number;          // Score mínimo para incluir (padrão: 0.0)
  includeMetadata?: boolean;  // Incluir metadados completos (padrão: true)
}

interface HybridSearchWeights {
  vectorWeight: number;       // Peso da busca vetorial (padrão: 0.7)
  fullTextWeight: number;     // Peso da busca full-text (padrão: 0.3)
  rrfK: number;               // Constante RRF (padrão: 60)
}

// ============================================================
// INTERFACES PARA INGESTÃO DE DOCUMENTOS
// ============================================================

interface ExtractionResult {
  text: string;
  method: 'pdf-parse' | 'mammoth' | 'vision' | 'pizzip-xml';
  quality: number;            // 0.0 a 1.0
  pageCount?: number;
  warnings: string[];         // Avisos de problemas na extração
  tables?: ExtractedTable[];  // Tabelas extraídas separadamente
}

interface ExtractedTable {
  headers: string[];
  rows: string[][];
  pageNumber?: number;
  caption?: string;
}

interface IngestionResult {
  documentId: string;
  chunksCreated: number;
  embeddingsGenerated: number;
  extractionMethod: string;
  extractionQuality: number;
  warnings: string[];
  duration: number;            // ms
}

interface IngestionProgress {
  documentId: string;
  step: 'extracting' | 'chunking' | 'embedding' | 'storing' | 'completed' | 'failed';
  progress: number;            // 0-100
  details?: string;
}

// ============================================================
// INTERFACES PARA PROJECT CONTEXT
// ============================================================

interface ProjectContextData {
  projectName: string;
  projectScope: string;
  objectives: Array<{
    description: string;
    priority: 'alta' | 'media' | 'baixa';
  }>;
  teamMembers: Array<{
    name: string;
    role: string;
    area: string;
  }>;
  technologies: Array<{
    name: string;
    category: 'frontend' | 'backend' | 'database' | 'infrastructure' | 'tool' | 'other';
    version?: string;
  }>;
  keyMilestones: Array<{
    name: string;
    date?: string;
    deliverable: string;
    status: 'planejado' | 'em_andamento' | 'concluido' | 'atrasado';
  }>;
  businessRules: Array<{
    id: string;
    description: string;
    area: string;
    priority: 'alta' | 'media' | 'baixa';
  }>;
  deliveryPlan: Array<{
    phase: string;
    startDate?: string;
    endDate?: string;
    objectives: string[];
    deliverables: string[];
  }>;
  stakeholders: Array<{
    name: string;
    role: string;
    organization: string;
    contact?: string;
  }>;
  summary?: string;
}

// Mapeamento de tipos de documento para extração do ProjectContext
interface DocumentTypeMapping {
  documentType: 'visao' | 'plano_trabalho' | 'delivery_plan' | 'requisitos' | 'regras_negocio' | 'prototipagem' | 'outro';
  fieldsToExtract: Array<keyof ProjectContextData>;
  searchQueries: string[];    // Queries para buscar chunks relevantes
}

// ============================================================
// INTERFACES PARA WIKI CHUNKS
// ============================================================

interface WikiSyncResult {
  pagesProcessed: number;
  pagesNew: number;
  pagesUpdated: number;
  pagesUnchanged: number;
  chunksCreated: number;
  embeddingsGenerated: number;
  duration: number;
}
```

Crie também os schemas Zod correspondentes para:
- Validação de opções de chunking (ChunkingOptionsSchema)
- Validação de opções de busca (SearchOptionsSchema)
- Validação dos dados do ProjectContext (ProjectContextDataSchema)
- Validação da rota de ingestão (IngestDocumentSchema — projectId, documentType)
- Validação da rota de busca (SearchQuerySchema — query, topK, sourceTypes)
- Validação da rota de setup do projeto (SetupProjectSchema — projectId, documentTypes mapping)
```

---

## FASE 2: SERVIÇOS DE INFRAESTRUTURA

### Arquivo 3: src/modules/rda/utils/url-builder.ts

```
Crie um utilitário para construção e classificação de URLs do Azure DevOps e outras ferramentas.
Usado pelo ChunkingService (classificação) e pelos Agentes de geração (construção de links).

```typescript
/**
 * Constrói URLs do Azure DevOps a partir de dados da API.
 * Permite gerar links de evidência mesmo quando o link não aparece nos chunks.
 */
class AzureDevOpsUrlBuilder {
  constructor(
    private organization: string,  // Ex: 'org-name'
    private project: string,       // Ex: 'PAIR'
    private teamName: string,      // Ex: 'PAIR Team'
  ) {}

  /** URL do taskboard de uma Sprint */
  sprintTaskboard(sprintName: string): string

  /** URL de um Work Item específico */
  workItem(workItemId: number): string

  /** URL de uma página da Wiki */
  wikiPage(wikiName: string, pageId: number, pagePath: string): string

  /** URL do Delivery Plan */
  deliveryPlan(planId: string): string

  /** URL do backlog */
  backlog(): string

  /** URL do board de uma Sprint */
  sprintBoard(sprintName: string): string
}

/**
 * Classifica uma URL por tipo.
 * Retorna o tipo para armazenar em ChunkMetadata.urlTypes
 */
function classifyUrl(url: string): 
  'azure_devops_sprint' | 'azure_devops_wiki' | 'azure_devops_workitem' |
  'azure_devops_deliveryplan' | 'figma' | 'sharepoint' | 'planner' | 'network_path' | 'other'

/**
 * Extrai URLs e caminhos de rede de um texto.
 * Captura: https://, http:// e caminhos \\servidor\...
 */
function extractUrls(text: string): string[]
```

Implementação da classificação:
- dev.azure.com + _sprints → 'azure_devops_sprint'
- dev.azure.com + _wiki → 'azure_devops_wiki'
- dev.azure.com + _workitems → 'azure_devops_workitem'
- dev.azure.com + _deliveryplans → 'azure_devops_deliveryplan'
- figma.com → 'figma'
- sharepoint.com ou -my.sharepoint.com → 'sharepoint'
- planner.cloud.microsoft → 'planner'
- Começa com \\\\ → 'network_path'
- Qualquer outro → 'other'

IMPORTANTE: O AzureDevOpsUrlBuilder será instanciado com dados do ProjectContext 
(organization, project, teamName) e usado pelos agentes na Etapa 3 para gerar links 
de evidência mesmo quando o link exato não está nos chunks. 
Os dados de organização e projeto vêm da configuração do Azure DevOps no sistema.
```

---

### Arquivo 4: src/modules/rda/services/chunking.service.ts

```
Crie o serviço de chunking semântico. Este serviço divide textos extraídos em blocos 
otimizados para busca vetorial, respeitando limites naturais do texto.

Requisitos técnicos:
- Implementar contagem de tokens aproximada (1 token ≈ 4 caracteres em português)
  Não usar lib externa de tokenização — a aproximação é suficiente para chunking
- Respeitar hierarquia de separadores: Heading > Parágrafo duplo > Parágrafo > Frase
- Tabelas são tratadas como chunks individuais (nunca subdivididas)
- Cada chunk recebe metadados ricos para rastreabilidade
- Overlap entre chunks para não perder informação nas fronteiras

Métodos obrigatórios:

```typescript
class ChunkingService {
  private defaultOptions: ChunkingOptions = {
    targetSize: 1000,
    maxSize: 1500,
    overlap: 120,
    separators: ['\n## ', '\n### ', '\n\n', '\n', '. '],
  };

  /**
   * Divide um texto em chunks semânticos com metadados.
   * Ponto de entrada principal do serviço.
   */
  chunkDocument(
    text: string,
    metadata: Omit<ChunkMetadata, 'position' | 'contentType' | 'sectionHeading'>,
    options?: Partial<ChunkingOptions>
  ): DocumentChunkData[]

  /**
   * Divide texto em chunks de uma tabela extraída.
   * Tabelas viram 1 chunk cada (cabeçalho + todas as linhas formatadas como texto).
   * Se a tabela for muito grande (> maxSize), divide por grupos de linhas mantendo o cabeçalho.
   */
  chunkTable(
    table: ExtractedTable,
    metadata: Omit<ChunkMetadata, 'position' | 'contentType' | 'sectionHeading'>,
    options?: Partial<ChunkingOptions>
  ): DocumentChunkData[]

  /**
   * Divide páginas de Wiki (Markdown) em chunks.
   * Usa headings Markdown (##, ###) como separadores primários.
   */
  chunkWikiPage(
    markdownContent: string,
    wikiPageId: string,
    wikiPageTitle: string,
    options?: Partial<ChunkingOptions>
  ): DocumentChunkData[]

  /**
   * Cria chunks a partir de Work Items do Azure DevOps.
   * Cada Work Item vira 1 chunk com metadados estruturados.
   * Work Items relacionados na mesma sprint podem ser agrupados.
   */
  chunkWorkItems(
    workItems: any[],  // WorkItem[] do Azure DevOps
    projectId: string
  ): DocumentChunkData[]

  /**
   * Cria chunks a partir de dados de Sprint.
   * Cada sprint vira 1 chunk com métricas e resumo.
   */
  chunkSprintData(
    sprintData: any,  // Sprint data do Azure DevOps
    projectId: string
  ): DocumentChunkData[]

  // --- Métodos privados ---

  /**
   * Algoritmo principal de splitting recursivo.
   * Tenta dividir pelo separador de maior prioridade; se os blocos resultantes
   * ainda forem grandes demais, recursa com o próximo separador.
   */
  private recursiveSplit(
    text: string,
    separators: string[],
    maxSize: number
  ): string[]

  /**
   * Aplica overlap entre chunks consecutivos.
   * Copia os últimos N tokens do chunk anterior para o início do próximo.
   */
  private applyOverlap(
    chunks: string[],
    overlapSize: number
  ): string[]

  /**
   * Detecta o heading mais próximo acima de uma posição no texto.
   * Usado para preencher sectionHeading nos metadados.
   */
  private detectSectionHeading(
    fullText: string,
    chunkStartPosition: number
  ): string | undefined

  /**
   * Detecta o tipo de conteúdo predominante no chunk.
   */
  private detectContentType(
    text: string
  ): 'text' | 'table' | 'list' | 'code' | 'mixed'

  /**
   * Conta tokens de forma aproximada.
   * Regra: 1 token ≈ 4 caracteres para português.
   * Mais preciso que split por espaços, menos custoso que tokenizer real.
   */
  private estimateTokens(text: string): number

  /**
   * Garante que URLs não sejam quebradas entre chunks.
   * Se o ponto de split cai no meio de uma URL, move para antes da URL.
   */
  private preserveUrls(text: string, splitPoint: number): number

  /**
   * Extrai todas as URLs de um texto para armazenar nos metadados do chunk.
   * Captura: https://, http://, e caminhos de rede (\\servidor\...)
   */
  private extractUrls(text: string): string[]

  /**
   * Classifica uma URL por tipo para facilitar o uso nos agentes de geração.
   * Tipos: azure_devops_sprint, azure_devops_wiki, azure_devops_workitem,
   *        azure_devops_deliveryplan, figma, sharepoint, planner, network_path, other
   */
  private classifyUrl(url: string): string
}
```

Algoritmo de chunking (implementar exatamente):

1. Receber texto completo + metadados base
2. Identificar todas as posições de headings no texto (para sectionHeading)
3. Fazer split pelo separador de maior prioridade (heading markers)
4. Para cada bloco resultante:
   a. Se tokenCount <= targetSize: aceitar como chunk
   b. Se targetSize < tokenCount <= maxSize: aceitar (dentro do tolerável)
   c. Se tokenCount > maxSize: recursão com próximo separador
5. Após todos os chunks definidos, aplicar overlap
6. Para cada chunk final: 
   a. Anexar metadados (chunkIndex, tokenCount, sectionHeading, contentType)
   b. Extrair URLs do conteúdo e classificar → preencher metadata.urls e metadata.urlTypes
7. Retornar array de DocumentChunkData

Regra crítica de preservação de URLs:
- Ao calcular pontos de split, verificar se o ponto cai dentro de uma URL
- Se sim, mover o split para ANTES da URL (a URL fica inteira no chunk atual)
- Regex para detectar URLs: /https?:\/\/[^\s<>)"]+/g
- Regex para caminhos de rede: /\\\\[^\s]+/g
- URLs são tokens atômicos — nunca quebrar no meio

Classificação de URLs (para metadata.urlTypes):
```typescript
function classifyUrl(url: string): string {
  if (url.includes('dev.azure.com') && url.includes('_sprints')) return 'azure_devops_sprint';
  if (url.includes('dev.azure.com') && url.includes('_wiki')) return 'azure_devops_wiki';
  if (url.includes('dev.azure.com') && url.includes('_workitems')) return 'azure_devops_workitem';
  if (url.includes('dev.azure.com') && url.includes('_deliveryplans')) return 'azure_devops_deliveryplan';
  if (url.includes('figma.com')) return 'figma';
  if (url.includes('sharepoint.com') || url.includes('-my.sharepoint.com')) return 'sharepoint';
  if (url.includes('planner.cloud.microsoft')) return 'planner';
  if (url.startsWith('\\\\')) return 'network_path';
  return 'other';
}
```

Casos especiais:
- Tabelas: converter para texto formatado "| header1 | header2 |\n| val1 | val2 |"
  e tratar como chunk único. Se > maxSize, dividir por grupos de linhas mantendo header.
- Listas: manter itens juntos quando possível (separar entre itens, não no meio)
- Código: blocos de código (``` ... ```) são chunks atômicos
- Texto muito curto (< 50 tokens): concatenar com chunk anterior se possível
```

---

### Arquivo 5: src/modules/rda/services/embedding.service.ts

```
Crie o serviço de embeddings e busca vetorial/híbrida. Este é o coração do sistema RAG.

Usa o SDK OpenAI para gerar embeddings e Prisma raw queries para busca no pgvector.

Variáveis de ambiente necessárias:
- OPENAI_API_KEY: chave da API OpenAI para embeddings

Requisitos técnicos:
- Usar modelo text-embedding-3-small (1536 dimensões, melhor custo-benefício)
- Batch de embeddings: até 2048 textos por chamada à API OpenAI
- Busca híbrida com Reciprocal Rank Fusion (RRF) combinando vetorial + full-text
- Rate limiting: respeitar limites da API OpenAI (máx 3000 RPM para embeddings)
- Cache de embeddings em memória para queries repetidas na mesma sessão

```typescript
import OpenAI from 'openai';
import { PrismaClient, Prisma } from '@prisma/client';

class EmbeddingService {
  private openai: OpenAI;
  private prisma: PrismaClient;
  private queryCache: Map<string, number[]>;  // Cache de embeddings de queries
  private readonly MODEL = 'text-embedding-3-small';
  private readonly DIMENSIONS = 1536;
  private readonly MAX_BATCH_SIZE = 2048;
  private readonly RRF_K = 60;  // Constante de suavização do RRF

  constructor(prisma: PrismaClient) {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.prisma = prisma;
    this.queryCache = new Map();
  }

  // ============================================================
  // GERAÇÃO DE EMBEDDINGS
  // ============================================================

  /**
   * Gera embedding para um único texto.
   * Usa cache se disponível.
   */
  async generateEmbedding(text: string): Promise<number[]>

  /**
   * Gera embeddings em lote para múltiplos textos.
   * Divide em batches de MAX_BATCH_SIZE e processa sequencialmente.
   * Retorna array na mesma ordem dos inputs.
   * Inclui retry com backoff para erros de rate limit.
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]>

  // ============================================================
  // ARMAZENAMENTO DE CHUNKS
  // ============================================================

  /**
   * Recebe chunks com metadados, gera embeddings em batch e insere no banco.
   * Usa transação Prisma para garantir consistência.
   * Reporta progresso via callback opcional.
   * 
   * IMPORTANTE: Usa $executeRaw porque Prisma não suporta tipo vector nativamente.
   * O embedding é inserido como string no formato '[0.1, 0.2, ...]'::vector
   */
  async storeChunks(
    chunks: DocumentChunkData[],
    projectId: string,
    onProgress?: (progress: { current: number; total: number; step: string }) => void
  ): Promise<{ stored: number; failed: number; errors: string[] }>

  /**
   * Remove todos os chunks de um documento específico.
   * Usado quando o documento é re-processado ou deletado.
   */
  async deleteChunksByDocument(documentId: string): Promise<number>

  /**
   * Remove todos os chunks de uma wiki page específica.
   */
  async deleteChunksByWikiPage(wikiPageId: string): Promise<number>

  /**
   * Remove todos os chunks de um projeto.
   * CUIDADO: operação destrutiva, usado no reset do projeto.
   */
  async deleteChunksByProject(projectId: string): Promise<number>

  // ============================================================
  // BUSCA VETORIAL
  // ============================================================

  /**
   * Busca por similaridade vetorial pura (cosine similarity).
   * Usa a extensão pgvector do PostgreSQL.
   * 
   * Query SQL gerada:
   * SELECT id, content, metadata, "sourceType",
   *        1 - (embedding <=> $1::vector) AS similarity
   * FROM "DocumentChunk"
   * WHERE "projectId" = $2
   *   AND ("sourceType" = ANY($3) OR $3 IS NULL)
   * ORDER BY embedding <=> $1::vector
   * LIMIT $4
   */
  async vectorSearch(options: SearchOptions): Promise<SearchResult[]>

  // ============================================================
  // BUSCA FULL-TEXT
  // ============================================================

  /**
   * Busca full-text usando tsvector do PostgreSQL com stemming em português.
   * 
   * Query SQL gerada:
   * SELECT id, content, metadata, "sourceType",
   *        ts_rank(tsv, plainto_tsquery('portuguese', $1)) AS rank
   * FROM "DocumentChunk"
   * WHERE "projectId" = $2
   *   AND tsv @@ plainto_tsquery('portuguese', $1)
   *   AND ("sourceType" = ANY($3) OR $3 IS NULL)
   * ORDER BY rank DESC
   * LIMIT $4
   */
  async fullTextSearch(options: SearchOptions): Promise<SearchResult[]>

  // ============================================================
  // BUSCA HÍBRIDA (RRF)
  // ============================================================

  /**
   * Busca híbrida combinando vetorial + full-text usando Reciprocal Rank Fusion.
   * 
   * Algoritmo:
   * 1. Executa vectorSearch e fullTextSearch em paralelo (ambas com topK * 2)
   * 2. Para cada chunk que aparece em qualquer resultado:
   *    score_final = sum(1 / (RRF_K + rank_i)) para cada busca i
   * 3. Ordena por score_final descendente
   * 4. Retorna top-K resultados
   * 
   * O RRF normaliza rankings de diferentes escalas sem precisar de calibração.
   * Chunks que aparecem em ambas as buscas recebem score mais alto naturalmente.
   */
  async hybridSearch(options: SearchOptions): Promise<SearchResult[]>

  // ============================================================
  // BUSCA CONTEXTUAL POR SEÇÃO
  // ============================================================

  /**
   * Busca otimizada para o pipeline de geração do RDA.
   * Recebe o nome de uma seção do RDA + descrição e retorna os chunks mais relevantes.
   * Combina a query semântica com filtros por sourceType apropriados.
   * 
   * Exemplo: para seção "Atividades do Período", busca em:
   * - sourceType: ['workitem', 'sprint', 'wiki', 'document']
   * Para seção "Riscos", busca preferencialmente em:
   * - sourceType: ['document', 'wiki']
   */
  async searchForSection(
    projectId: string,
    sectionName: string,
    sectionDescription: string,
    topK?: number
  ): Promise<SearchResult[]>

  // ============================================================
  // UTILITÁRIOS
  // ============================================================

  /**
   * Retorna estatísticas dos chunks de um projeto.
   */
  async getProjectStats(projectId: string): Promise<{
    totalChunks: number;
    chunksBySourceType: Record<string, number>;
    chunksByDocument: Array<{ documentName: string; count: number }>;
    avgTokensPerChunk: number;
    totalTokens: number;
  }>

  /**
   * Limpa o cache de embeddings de queries.
   */
  clearQueryCache(): void

  // --- Métodos privados ---

  /**
   * Formata embedding como string para inserção SQL no pgvector.
   * Formato: '[0.123, -0.456, ...]'
   */
  private formatEmbeddingForSQL(embedding: number[]): string

  /**
   * Implementa retry com exponential backoff para chamadas à API OpenAI.
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    baseDelay: number
  ): Promise<T>
}
```

Detalhes de implementação da busca híbrida (RRF):

```typescript
// Pseudocódigo do hybridSearch:
async hybridSearch(options: SearchOptions): Promise<SearchResult[]> {
  const topK = options.topK || 10;
  const expandedK = topK * 2;  // Buscar mais para ter overlap

  // 1. Executar buscas em paralelo
  const [vectorResults, textResults] = await Promise.all([
    this.vectorSearch({ ...options, topK: expandedK }),
    this.fullTextSearch({ ...options, topK: expandedK }),
  ]);

  // 2. Calcular scores RRF
  const scores = new Map<string, { score: number; result: SearchResult }>();

  vectorResults.forEach((result, rank) => {
    const rrfScore = 1 / (this.RRF_K + rank + 1);
    const existing = scores.get(result.id);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(result.id, { score: rrfScore, result: { ...result, matchType: 'hybrid' } });
    }
  });

  textResults.forEach((result, rank) => {
    const rrfScore = 1 / (this.RRF_K + rank + 1);
    const existing = scores.get(result.id);
    if (existing) {
      existing.score += rrfScore;
      existing.result.matchType = 'hybrid';  // Apareceu em ambas
    } else {
      scores.set(result.id, { score: rrfScore, result: { ...result, matchType: 'fulltext' } });
    }
  });

  // 3. Ordenar e retornar top-K
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ score, result }) => ({ ...result, score }));
}
```

IMPORTANTE:
- Todas as queries SQL devem usar `$queryRawUnsafe` ou `$queryRaw` do Prisma com parametrização
- NUNCA concatenar strings em queries SQL — sempre usar parâmetros para evitar SQL injection
- O embedding deve ser passado como string formatada: `'[0.1, 0.2, ...]'::vector`
- Tratar o caso onde o projeto tem 0 chunks (retornar array vazio, não crashar)
- Log de performance: medir e logar tempo de cada busca
```

---

## FASE 3: SERVIÇOS DE INGESTÃO

### Arquivo 6: src/modules/rda/services/document-ingestion.service.ts

```
Crie o serviço que orquestra a ingestão completa de documentos: extração de texto,
chunking semântico e armazenamento de embeddings.

Este serviço estende/substitui o fluxo existente do document.service.ts, adicionando 
toda a camada RAG. O document.service.ts continua responsável pelo CRUD básico 
(upload, listagem, deleção do arquivo), enquanto este serviço cuida do processamento.

```typescript
class DocumentIngestionService {
  constructor(
    private chunkingService: ChunkingService,
    private embeddingService: EmbeddingService,
    private claudeService: ClaudeService,  // Para Vision API (PDFs escaneados)
    private prisma: PrismaClient
  ) {}

  // ============================================================
  // INGESTÃO DE DOCUMENTOS INDIVIDUAIS
  // ============================================================

  /**
   * Pipeline completo de ingestão de um documento.
   * 1. Detectar tipo e extrair texto
   * 2. Avaliar qualidade da extração
   * 3. Se qualidade baixa e PDF → tentar Vision API
   * 4. Chunking semântico
   * 5. Gerar embeddings em batch
   * 6. Armazenar chunks no banco
   * 7. Atualizar metadados do Document
   */
  async ingestDocument(
    documentId: string,
    onProgress?: (progress: IngestionProgress) => void
  ): Promise<IngestionResult>

  /**
   * Re-ingestão de um documento (quando atualizado ou com nova configuração).
   * Remove chunks antigos antes de re-processar.
   */
  async reingestDocument(
    documentId: string,
    onProgress?: (progress: IngestionProgress) => void
  ): Promise<IngestionResult>

  // ============================================================
  // INGESTÃO DE WIKI PAGES
  // ============================================================

  /**
   * Processa todas as wiki pages de um projeto que ainda não foram chunkeadas,
   * ou que foram atualizadas desde o último chunking.
   * 
   * Para cada página:
   * 1. Se chunked=true e não foi atualizada → skip
   * 2. Se chunked=true e foi atualizada → deletar chunks antigos, re-chunkar
   * 3. Se chunked=false → chunkar
   */
  async ingestWikiPages(
    projectId: string,
    onProgress?: (progress: { current: number; total: number }) => void
  ): Promise<WikiSyncResult>

  /**
   * Ingere uma única wiki page.
   */
  async ingestWikiPage(
    wikiPageId: string
  ): Promise<{ chunksCreated: number }>

  // ============================================================
  // INGESTÃO EM LOTE (SETUP DO PROJETO)
  // ============================================================

  /**
   * Processa todos os documentos de um projeto em sequência.
   * Usado no setup inicial do projeto.
   * Reporta progresso geral e por documento.
   */
  async ingestAllDocuments(
    projectId: string,
    onProgress?: (progress: {
      currentDocument: number;
      totalDocuments: number;
      currentStep: string;
      overallProgress: number;
    }) => void
  ): Promise<{
    documentsProcessed: number;
    totalChunks: number;
    totalEmbeddings: number;
    errors: Array<{ documentId: string; filename: string; error: string }>;
    duration: number;
  }>

  // ============================================================
  // EXTRAÇÃO DE TEXTO
  // ============================================================

  /**
   * Extrai texto de um PDF.
   * Usa pdf-parse como método primário.
   * Se a qualidade for baixa (< 100 chars/página), tenta Vision API do Claude.
   */
  private async extractFromPDF(
    filePath: string
  ): Promise<ExtractionResult>

  /**
   * Extrai texto de um DOCX.
   * Usa mammoth como método primário.
   * Para tabelas, usa PizZip para parsear XML direto e extrair estrutura.
   */
  private async extractFromDOCX(
    filePath: string
  ): Promise<ExtractionResult>

  /**
   * Extrai texto de PDF escaneado usando Vision API do Claude.
   * Converte cada página em imagem base64 e envia ao Claude.
   * CUSTO ALTO — usado apenas como fallback quando pdf-parse falha.
   * 
   * Usa o claude.service.ts existente:
   * - Envia cada página como imagem no content do message
   * - Prompt: "Extraia todo o texto desta página de documento, preservando estrutura"
   * - Temperatura: 0.0
   * - Processa páginas em paralelo (max 3 simultâneas para não estourar rate limit)
   */
  private async extractWithVision(
    filePath: string
  ): Promise<ExtractionResult>

  /**
   * Avalia a qualidade de uma extração.
   * Heurísticas:
   * - Chars por página > 200 → boa qualidade
   * - Chars por página entre 50-200 → qualidade média
   * - Chars por página < 50 → qualidade ruim (provavelmente escaneado)
   * - Muitos caracteres especiais/garbled → qualidade ruim
   * - Texto sem espaços ou com encoding errado → qualidade ruim
   */
  private evaluateExtractionQuality(
    text: string,
    pageCount: number
  ): number  // 0.0 a 1.0

  /**
   * Detecta se o PDF é escaneado (imagem) baseado na quantidade de texto extraído.
   */
  private isScannedPDF(
    text: string,
    pageCount: number
  ): boolean
}
```

Detalhes do pipeline de ingestão (ingestDocument):

```
1. EXTRAÇÃO
   - Buscar Document do banco (id, filePath, fileType)
   - Se PDF → extractFromPDF(filePath)
   - Se DOCX → extractFromDOCX(filePath)
   - Avaliar qualidade: evaluateExtractionQuality(text, pageCount)
   - Se qualidade < 0.3 E tipo é PDF → extractWithVision(filePath)
   - Salvar extractedText, extractionMethod, extractionQuality no Document
   - Reportar progresso: step='extracting', progress=20

2. CHUNKING
   - Passar texto extraído para chunkingService.chunkDocument()
   - Se houver tabelas extraídas, passar para chunkingService.chunkTable() separadamente
   - Combinar todos os chunks em um array único
   - Reportar progresso: step='chunking', progress=40

3. EMBEDDING
   - Extrair textos de todos os chunks
   - Passar para embeddingService.generateBatchEmbeddings()
   - Reportar progresso: step='embedding', progress=70

4. ARMAZENAMENTO
   - Combinar chunks + embeddings
   - Passar para embeddingService.storeChunks(chunks, projectId)
   - Atualizar Document: chunked=true, chunkCount=N
   - Reportar progresso: step='storing', progress=90

5. FINALIZAÇÃO
   - Reportar progresso: step='completed', progress=100
   - Retornar IngestionResult com todas as métricas
```

IMPORTANTE sobre Vision API para PDFs escaneados:
- Usar o claude.service.ts existente
- A Vision API do Claude aceita imagens no content da mensagem
- Para converter PDF em imagens, usar: 
  ```
  import { exec } from 'child_process';
  // Usar pdftoppm se disponível, ou canvas/sharp como fallback
  // pdftoppm -jpeg -r 150 input.pdf output_prefix
  ```
- Se pdftoppm não estiver disponível, logar warning e marcar como 'extraction_failed'
- NÃO bloquear a ingestão se Vision falhar — salvar o que conseguiu com quality baixa
```

---

### Arquivo 7: src/modules/rda/services/wiki-ingestion.service.ts

```
Crie um serviço dedicado para a ingestão de wiki pages no pipeline RAG.
Este serviço trabalha em conjunto com o wiki.service.ts existente (que faz a sincronização 
das páginas da Wiki do Azure DevOps) e adiciona a camada de chunking + embeddings.

```typescript
class WikiIngestionService {
  constructor(
    private chunkingService: ChunkingService,
    private embeddingService: EmbeddingService,
    private prisma: PrismaClient
  ) {}

  /**
   * Processa todas as wiki pages de um projeto.
   * Identifica páginas novas ou atualizadas e faz chunking + embedding.
   * Páginas sem alteração desde o último processamento são ignoradas.
   */
  async processProjectWikiPages(
    projectId: string,
    onProgress?: (progress: { current: number; total: number; pageName: string }) => void
  ): Promise<WikiSyncResult>

  /**
   * Processa uma única wiki page.
   * Remove chunks antigos se existirem antes de criar novos.
   */
  async processWikiPage(wikiPageId: string): Promise<{ chunksCreated: number }>

  /**
   * Verifica quais wiki pages precisam ser (re)processadas.
   * Retorna IDs das páginas que:
   * - Nunca foram chunkeadas (chunked = false)
   * - Foram atualizadas após o último chunking (updatedAt > chunk.createdAt mais recente)
   */
  private async getStalePages(projectId: string): Promise<string[]>
}
```
```

---

## FASE 4: PROJECT CONTEXT

### Arquivo 8: src/modules/rda/services/project-context.service.ts

```
Crie o serviço que constrói e mantém o ProjectContext — uma entidade persistente com 
dados estruturados extraídos da documentação base do projeto.

O ProjectContext é construído uma vez no setup e reutilizado em toda geração de RDA, 
evitando reprocessar a documentação fundamental todo mês.

Usa o sistema RAG (embedding.service.ts) para buscar chunks relevantes por tipo de 
documento, e o Claude para extrair informações estruturadas.

```typescript
class ProjectContextService {
  constructor(
    private embeddingService: EmbeddingService,
    private claudeService: ClaudeService,
    private prisma: PrismaClient
  ) {}

  // Mapeamento de tipo de documento para campos do ProjectContext
  private readonly DOCUMENT_TYPE_MAPPINGS: DocumentTypeMapping[] = [
    {
      documentType: 'visao',
      fieldsToExtract: ['projectName', 'projectScope', 'objectives', 'stakeholders'],
      searchQueries: [
        'visão geral do projeto escopo objetivo',
        'justificativa propósito finalidade do projeto',
        'partes interessadas stakeholders beneficiários',
      ],
    },
    {
      documentType: 'plano_trabalho',
      fieldsToExtract: ['teamMembers', 'keyMilestones', 'deliveryPlan'],
      searchQueries: [
        'equipe membros papéis responsabilidades',
        'cronograma marcos entregas milestones',
        'plano fases etapas do projeto',
      ],
    },
    {
      documentType: 'delivery_plan',
      fieldsToExtract: ['deliveryPlan', 'keyMilestones'],
      searchQueries: [
        'delivery plan entregas planejadas sprints',
        'cronograma releases versões lançamentos',
      ],
    },
    {
      documentType: 'requisitos',
      fieldsToExtract: ['businessRules', 'technologies'],
      searchQueries: [
        'requisitos funcionais não-funcionais especificação',
        'regras de negócio restrições condições',
        'tecnologias arquitetura stack ferramentas',
      ],
    },
    {
      documentType: 'regras_negocio',
      fieldsToExtract: ['businessRules'],
      searchQueries: [
        'regras de negócio validações processos',
        'fluxos condições exceções tratamento',
      ],
    },
    {
      documentType: 'prototipagem',
      fieldsToExtract: ['technologies'],
      searchQueries: [
        'tecnologias frameworks bibliotecas linguagens',
        'arquitetura infraestrutura banco de dados APIs',
        'prototipação wireframes telas interfaces',
      ],
    },
  ];

  // ============================================================
  // CONSTRUÇÃO DO CONTEXTO
  // ============================================================

  /**
   * Constrói o ProjectContext completo a partir dos chunks RAG do projeto.
   * 
   * Processo:
   * 1. Para cada DocumentTypeMapping:
   *    a. Busca chunks relevantes via hybridSearch para cada searchQuery
   *    b. Deduplica chunks encontrados
   *    c. Envia chunks ao Claude com prompt de extração estruturada
   *    d. Valida resposta contra schema Zod
   *    e. Merge com dados já extraídos (sem sobrescrever com vazio)
   * 2. Gera summary via Claude com todos os dados consolidados
   * 3. Persiste no banco via upsert
   */
  async buildProjectContext(
    projectId: string,
    documentTypeMappings?: Array<{ documentId: string; documentType: string }>,
    onProgress?: (progress: { step: string; current: number; total: number }) => void
  ): Promise<ProjectContextData>

  /**
   * Atualiza campos específicos do ProjectContext.
   * Usado quando um documento é adicionado ou atualizado.
   * Só reprocessa os campos relevantes ao tipo de documento.
   */
  async updateProjectContext(
    projectId: string,
    documentType: string,
    onProgress?: (progress: { step: string; progress: number }) => void
  ): Promise<ProjectContextData>

  /**
   * Retorna o ProjectContext atual do projeto.
   * Retorna null se ainda não foi construído.
   */
  async getProjectContext(projectId: string): Promise<ProjectContextData | null>

  /**
   * Deleta o ProjectContext de um projeto.
   */
  async deleteProjectContext(projectId: string): Promise<void>

  // ============================================================
  // EXTRAÇÃO COM CLAUDE
  // ============================================================

  /**
   * Extrai campos específicos a partir de chunks usando Claude.
   * 
   * Temperatura: 0.1 (extração factual)
   * Max tokens: 4000
   * 
   * O prompt pede ao Claude para retornar EXCLUSIVAMENTE JSON
   * com os campos solicitados, baseado nos chunks fornecidos.
   * Campos que não puderem ser extraídos devem vir como array vazio.
   */
  private async extractFieldsFromChunks(
    chunks: SearchResult[],
    fieldsToExtract: Array<keyof ProjectContextData>,
    existingContext?: Partial<ProjectContextData>
  ): Promise<Partial<ProjectContextData>>

  /**
   * Gera um resumo consolidado do projeto baseado em todos os dados do contexto.
   * 
   * Temperatura: 0.3
   * Max tokens: 1000
   */
  private async generateProjectSummary(
    context: ProjectContextData
  ): Promise<string>

  // ============================================================
  // PROMPTS
  // ============================================================

  /**
   * Monta o system prompt para extração de campos.
   * 
   * Prompt base:
   * "Você é um extrator de dados de documentação de projetos de software.
   *  Analise os trechos de documentos fornecidos e extraia as informações 
   *  solicitadas. Retorne EXCLUSIVAMENTE JSON válido.
   *  
   *  Para cada campo:
   *  - Se encontrar a informação: preencha com os dados extraídos
   *  - Se NÃO encontrar: retorne array vazio [] ou string vazia ""
   *  - NUNCA invente informações que não estão nos documentos
   *  
   *  Campos a extrair: {fieldsToExtract}
   *  Schema esperado: {jsonSchema para os campos}"
   */
  private buildExtractionPrompt(
    fieldsToExtract: Array<keyof ProjectContextData>
  ): string

  /**
   * Monta a mensagem do usuário com os chunks formatados.
   */
  private buildChunksMessage(
    chunks: SearchResult[]
  ): string

  // ============================================================
  // MERGE E VALIDAÇÃO
  // ============================================================

  /**
   * Faz merge de dados novos com dados existentes do contexto.
   * Regras:
   * - Arrays: concatena e deduplica por campo chave (name para membros, id para regras)
   * - Strings: sobrescreve apenas se o novo valor não for vazio
   * - Nunca apaga dados existentes com valores vazios
   */
  private mergeContextData(
    existing: Partial<ProjectContextData>,
    newData: Partial<ProjectContextData>
  ): Partial<ProjectContextData>

  /**
   * Valida os dados extraídos contra o schema Zod.
   * Retorna dados limpos e validados.
   */
  private validateContextData(data: any): Partial<ProjectContextData>
}
```

System prompt completo para extração:

```
Você é um extrator de dados de documentação de projetos de software. Sua tarefa é 
analisar trechos de documentos fornecidos e extrair informações estruturadas.

REGRAS ABSOLUTAS:
1. Retorne EXCLUSIVAMENTE JSON válido, sem markdown, sem comentários, sem texto fora do JSON
2. Extraia APENAS informações explicitamente presentes nos documentos
3. NUNCA invente, infira ou assuma informações que não estão nos trechos
4. Se não encontrar dados para um campo, retorne array vazio [] ou string vazia ""
5. Para nomes de pessoas, use exatamente como aparecem nos documentos
6. Para tecnologias, use nomes oficiais (React.js, C#/.NET, MySQL, etc.)
7. Para datas, use formato ISO quando possível (YYYY-MM-DD) ou mantenha como aparece

CAMPOS A EXTRAIR:
{lista dinâmica baseada nos fieldsToExtract}

SCHEMA DE RESPOSTA:
{JSON schema para os campos solicitados}

TRECHOS DE DOCUMENTOS:
{chunks formatados com sourceType e metadata}
```
```

---

## FASE 5: SERVIÇO ORQUESTRADOR

### Arquivo 9: src/modules/rda/services/project-setup.service.ts

```
Crie o serviço orquestrador que coordena todo o processo de setup de um projeto.
É o ponto de entrada principal da Etapa 0.

```typescript
class ProjectSetupService {
  constructor(
    private documentIngestionService: DocumentIngestionService,
    private wikiIngestionService: WikiIngestionService,
    private projectContextService: ProjectContextService,
    private embeddingService: EmbeddingService,
    private prisma: PrismaClient
  ) {}

  /**
   * Executa o setup completo de um projeto para geração de RDA.
   * 
   * Fluxo:
   * 1. Validar pré-requisitos (projeto existe, tem documentos)
   * 2. Ingerir todos os documentos (extração + chunking + embeddings)
   * 3. Ingerir wiki pages (se houver)
   * 4. Construir ProjectContext a partir dos chunks
   * 5. Retornar relatório de setup
   * 
   * Este processo pode levar vários minutos dependendo da quantidade de documentos.
   * O progresso é reportado via callback para atualização em tempo real no frontend.
   */
  async setupProject(
    projectId: string,
    options: {
      documentTypeMappings?: Array<{ documentId: string; documentType: string }>;
      includeWiki?: boolean;
      forceReprocess?: boolean;  // Re-processar mesmo documentos já chunkeados
    },
    onProgress?: (progress: SetupProgress) => void
  ): Promise<SetupResult>

  /**
   * Verifica o status atual do setup de um projeto.
   * Útil para o frontend saber se o projeto já foi configurado
   * e quais etapas estão completas.
   */
  async getSetupStatus(projectId: string): Promise<SetupStatus>

  /**
   * Reseta o setup de um projeto (remove todos os chunks e ProjectContext).
   * Usado para recomeçar do zero.
   */
  async resetProject(projectId: string): Promise<void>

  /**
   * Adiciona um novo documento a um projeto já configurado.
   * Ingere o documento e atualiza o ProjectContext incrementalmente.
   */
  async addDocument(
    projectId: string,
    documentId: string,
    documentType: string,
    onProgress?: (progress: IngestionProgress) => void
  ): Promise<IngestionResult>

  /**
   * Re-sincroniza a Wiki e atualiza chunks.
   * Usado quando o conteúdo da Wiki foi atualizado no Azure DevOps.
   */
  async refreshWiki(
    projectId: string,
    onProgress?: (progress: { current: number; total: number }) => void
  ): Promise<WikiSyncResult>
}

// Interfaces de resultado
interface SetupProgress {
  phase: 'documents' | 'wiki' | 'context' | 'completed';
  currentStep: string;
  overallProgress: number;    // 0-100
  details: {
    documentsTotal: number;
    documentsProcessed: number;
    wikiPagesTotal: number;
    wikiPagesProcessed: number;
    contextFields: number;
    contextFieldsExtracted: number;
  };
}

interface SetupResult {
  projectId: string;
  documentsIngested: number;
  wikiPagesIngested: number;
  totalChunks: number;
  totalEmbeddings: number;
  projectContextBuilt: boolean;
  errors: Array<{ source: string; error: string }>;
  duration: number;
  stats: {
    chunksBySourceType: Record<string, number>;
    avgTokensPerChunk: number;
    totalTokens: number;
    embeddingCost: number;  // Estimativa de custo em USD
  };
}

interface SetupStatus {
  projectId: string;
  isSetupComplete: boolean;
  hasDocuments: boolean;
  documentsChunked: number;
  documentsTotal: number;
  hasWikiSync: boolean;
  wikiPagesChunked: number;
  hasProjectContext: boolean;
  projectContextFields: {
    projectName: boolean;
    projectScope: boolean;
    teamMembers: boolean;
    technologies: boolean;
    keyMilestones: boolean;
    businessRules: boolean;
    deliveryPlan: boolean;
  };
  totalChunks: number;
  lastUpdated?: Date;
}
```

Fluxo detalhado do setupProject:

```
1. VALIDAÇÃO (progress: 0%)
   - Verificar se projeto existe
   - Verificar se tem pelo menos 1 documento
   - Se forceReprocess=true, deletar chunks existentes

2. INGESTÃO DE DOCUMENTOS (progress: 0-50%)
   - Buscar todos os documentos do projeto
   - Para cada documento:
     a. Se já chunkeado E forceReprocess=false → skip
     b. Senão → documentIngestionService.ingestDocument(docId)
   - Reportar progresso por documento

3. INGESTÃO DA WIKI (progress: 50-70%)
   - Se includeWiki=true:
     a. wikiIngestionService.processProjectWikiPages(projectId)
   - Se includeWiki=false → skip

4. CONSTRUÇÃO DO PROJECTCONTEXT (progress: 70-95%)
   - projectContextService.buildProjectContext(projectId, documentTypeMappings)
   - Reportar progresso por campo extraído

5. FINALIZAÇÃO (progress: 95-100%)
   - Coletar estatísticas via embeddingService.getProjectStats()
   - Calcular estimativa de custo de embeddings:
     totalTokens * (0.02 / 1_000_000)  // $0.02 por 1M tokens (text-embedding-3-small)
   - Montar e retornar SetupResult
```
```

---

## FASE 6: API ROUTES

### Arquivo 10: Novas rotas (adicionar ao rda.routes.ts existente)

```
Adicione as seguintes rotas ao rda.routes.ts. Todas usam validação Zod e 
seguem o padrão existente das rotas RDA.

### Rotas de Setup do Projeto

```
POST   /rda/setup/:projectId
  - Inicia o setup completo do projeto
  - Body: { documentTypeMappings?: [{documentId, documentType}], includeWiki?: boolean, forceReprocess?: boolean }
  - Retorna: { setupId, status: 'processing' }
  - Executa assincronamente (o setup pode levar minutos)
  - O progresso é salvo em algum lugar consultável (Redis, banco, ou in-memory)

GET    /rda/setup/:projectId/status
  - Retorna o status atual do setup
  - Retorna: SetupStatus (isSetupComplete, documentsChunked, hasProjectContext, etc.)

POST   /rda/setup/:projectId/reset
  - Reseta o setup (remove chunks e ProjectContext)
  - Retorna: { success: true, chunksDeleted: number }
```

### Rotas de Ingestão Individual

```
POST   /rda/documents/:id/ingest
  - Ingere (ou re-ingere) um documento específico no RAG
  - Body: { documentType?: string, forceReprocess?: boolean }
  - Retorna: IngestionResult

POST   /rda/wiki/ingest
  - Processa todas as wiki pages pendentes para o RAG
  - Body: { projectId: string }
  - Retorna: WikiSyncResult
```

### Rotas de Busca (RAG)

```
POST   /rda/search
  - Busca híbrida nos chunks do projeto
  - Body: { projectId, query, topK?, sourceTypes?, minScore? }
  - Retorna: SearchResult[]
  - ÚTIL para debug: permite testar buscas antes de gerar o RDA

GET    /rda/chunks/stats/:projectId
  - Estatísticas dos chunks do projeto
  - Retorna: { totalChunks, chunksBySourceType, avgTokensPerChunk, etc. }
```

### Rotas de ProjectContext

```
GET    /rda/context/:projectId
  - Retorna o ProjectContext atual do projeto
  - Retorna: ProjectContextData | null

POST   /rda/context/:projectId/rebuild
  - Reconstrói o ProjectContext do zero
  - Body: { documentTypeMappings?: [...] }
  - Retorna: ProjectContextData

PUT    /rda/context/:projectId
  - Atualiza manualmente campos do ProjectContext
  - Body: Partial<ProjectContextData>
  - Retorna: ProjectContextData atualizado
  - Permite o usuário corrigir dados que o Claude extraiu errado
```

Todas as rotas devem:
- Validar inputs com Zod
- Tratar erros com try/catch e retornar mensagens claras
- Logar operações com prefixo [RAG] ou [ProjectContext]
- Retornar status HTTP apropriados (200, 201, 400, 404, 500)
```

---

## FASE 7: FRONTEND

### Arquivo 11: Hooks React Query

```
Crie os hooks em:
src/pages/rda/hooks/

useProjectSetup.ts
  - useSetupProject: mutation para POST /rda/setup/:projectId
  - useSetupStatus: query para GET /rda/setup/:projectId/status (com polling durante setup)
  - useResetProject: mutation para POST /rda/setup/:projectId/reset

useRAGSearch.ts
  - useRAGSearch: mutation para POST /rda/search (busca sob demanda)
  - useChunkStats: query para GET /rda/chunks/stats/:projectId

useProjectContext.ts
  - useProjectContext: query para GET /rda/context/:projectId
  - useRebuildContext: mutation para POST /rda/context/:projectId/rebuild
  - useUpdateContext: mutation para PUT /rda/context/:projectId

useDocumentIngestion.ts
  - useIngestDocument: mutation para POST /rda/documents/:id/ingest
  - useIngestWiki: mutation para POST /rda/wiki/ingest

Todos seguem o padrão existente:
- Axios como cliente HTTP base
- React Query para cache e estado
- onSuccess com toast de sucesso
- onError com toast de erro
- Polling com refetchInterval onde aplicável (setup status)
```

### Arquivo 12: Componentes React do Setup

```
Crie os componentes em:
src/pages/rda/components/project-setup/

ProjectSetupWizard.tsx
  - Wizard de 4 steps para o setup do projeto
  - Step 1: Upload e classificação de documentos
  - Step 2: Sincronização da Wiki (opcional)
  - Step 3: Progresso da ingestão + construção do contexto
  - Step 4: Revisão do ProjectContext + estatísticas do RAG

Step1DocumentClassification.tsx
  - Lista todos os documentos já enviados ao projeto
  - Para cada documento: Select para escolher o tipo (Visão, Plano de Trabalho, etc.)
  - Botão para upload de documentos novos (react-dropzone, reutilizar o existente)
  - Indicador visual de quais tipos de documento ainda faltam
  - Mínimo recomendado: pelo menos Documento de Visão + Plano de Trabalho

Step2WikiSync.tsx
  - Toggle para incluir ou não a Wiki no setup
  - Se ativado: botão "Sincronizar Wiki"
  - Progresso da sincronização
  - Lista de páginas sincronizadas com preview do conteúdo
  - Opção de desmarcar páginas irrelevantes

Step3IngestionProgress.tsx
  - Barra de progresso geral (0-100%)
  - Lista de documentos com status individual:
    - ⏳ Aguardando | ⚙️ Processando | ✅ Concluído | ❌ Erro
  - Para cada documento em processamento: sub-progresso (Extraindo → Chunking → Embeddings → Armazenando)
  - Seção de progresso do Wiki (se incluído)
  - Seção de progresso do ProjectContext
  - Tempo decorrido (usar date-fns ptBR)
  - Estimativa de custo de embeddings

Step4ContextReview.tsx
  - Exibir ProjectContext em cards por categoria:
    - Card "Projeto": nome, escopo, resumo
    - Card "Equipe": membros com nome e papel
    - Card "Tecnologias": lista agrupada por categoria
    - Card "Marcos": timeline com datas e status
    - Card "Regras de Negócio": lista com ID e descrição
    - Card "Plano de Entrega": fases com datas
  - Cada card com botão "Editar" que abre Dialog de edição
  - Seção "Estatísticas do RAG":
    - Total de chunks
    - Chunks por tipo de fonte (gráfico de barras ou badges)
    - Média de tokens por chunk
    - Custo estimado de embeddings
  - Botão "Concluir Setup" 
  - Botão "Testar Busca" que abre modal com input de query para testar o RAG

Use shadcn/ui: Card, Button, Badge, Progress, Select, Switch, Dialog, Toast, Tabs, Input, Textarea
Use Tailwind CSS para todos os estilos
Use Lucide React para ícones: Upload, Database, Search, CheckCircle, AlertTriangle, Brain, Users, Code, 
  Calendar, FileText, Globe, Settings, RefreshCw, Trash2, Eye, Edit, Play
Use date-fns com locale ptBR para tempos relativos
```

---

## REGRAS GERAIS DE IMPLEMENTAÇÃO

```
1. TypeScript estrito: sem 'any' desnecessário, interfaces para tudo
2. Tratamento de erros: try/catch com mensagens claras em português, nunca crashar silenciosamente
3. Logging: usar console.log com prefixos:
   - [Chunking] para operações de chunking
   - [Embedding] para operações de embedding e busca
   - [Ingestion] para pipeline de ingestão
   - [ProjectContext] para construção/atualização do contexto
   - [RAG] para buscas
   - [Setup] para o orquestrador de setup
4. Imports: ESM (import/export), compatível com o setup existente do projeto
5. Zod: validar todas as entradas de rotas E saídas do Claude
6. Raw SQL: usar $queryRaw / $executeRaw do Prisma para operações com pgvector
   SEMPRE parametrizar queries para evitar SQL injection
7. Todos os textos de UI e mensagens de erro em português brasileiro
8. Performance: logar duração de cada etapa significativa
9. Manter compatibilidade com os serviços existentes (claude.service.ts, document.service.ts, wiki.service.ts)
10. Variáveis de ambiente: OPENAI_API_KEY (nova), DATABASE_URL e DIRECT_DATABASE_URL (existentes)
```

---

## DEPENDÊNCIA NOVA

```bash
npm install openai
```

Configurar OPENAI_API_KEY no .env:
```
OPENAI_API_KEY=sk-...
```

---

## ORDEM DE IMPLEMENTAÇÃO SUGERIDA

```
Implemente na seguinte ordem (cada item depende dos anteriores):

1. rag.schema.ts (interfaces TypeScript e Zod schemas — base de tudo)
2. Modelos Prisma (atualizar schema.prisma + migration SQL do pgvector)
3. url-builder.ts (construção e classificação de URLs — utilitário usado por vários serviços)
4. chunking.service.ts (divisão de textos em chunks com preservação de URLs)
5. embedding.service.ts (embeddings + busca vetorial/híbrida)
6. document-ingestion.service.ts (pipeline de ingestão de documentos)
7. wiki-ingestion.service.ts (pipeline de ingestão da Wiki)
8. project-context.service.ts (construção do ProjectContext com Claude)
9. project-setup.service.ts (orquestrador do setup)
10. Rotas Fastify (API endpoints)
11. Hooks React Query
12. Componentes React (wizard de 4 steps)
```

---

## COMO USAR ESTE PROMPT

### No Claude Code (terminal):
```bash
# Cole o prompt inteiro e peça para implementar arquivo por arquivo:
# "Implemente o arquivo 1: rag.schema.ts"
# Depois: "Agora implemente o arquivo 2: modelos Prisma e migration SQL"
# Depois: "Agora implemente o arquivo 3: url-builder.ts"
# E assim por diante na ordem sugerida (total: 12 arquivos)
```

### No Codex / Copilot / Antigravity:
```
# Cole o "Contexto do Projeto" no início
# Depois cole a seção do arquivo específico que quer implementar
# Ex: Cole "Arquivo 5: embedding.service.ts" para implementar a busca vetorial
# Se precisar das interfaces, cole também o rag.schema.ts
```

### Se a sessão acabar (limite de tokens):
```
# Inicie nova sessão com:
# 1. O "Contexto do Projeto" (sempre no início)
# 2. A seção do próximo arquivo a implementar
# 3. Se necessário, cole as interfaces do rag.schema.ts
# 4. Mencione quais arquivos já foram implementados para contexto
# 5. Lembre que a Etapa -1 é template fixo (não há Template Factory)
```

### Testando o RAG após implementação:
```
# Use a rota POST /rda/search para testar buscas:
curl -X POST http://localhost:3000/rda/search \
  -H "Content-Type: application/json" \
  -d '{"projectId": "xxx", "query": "atividades de desenvolvimento", "topK": 5}'

# Se os resultados forem relevantes, o RAG está funcionando.
# Se retornar chunks irrelevantes, ajustar:
# - Tamanho dos chunks (targetSize/maxSize)
# - Overlap
# - Weights da busca híbrida (vectorWeight/fullTextWeight)
```
