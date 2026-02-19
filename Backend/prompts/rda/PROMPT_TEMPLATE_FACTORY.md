# PROMPT DE IMPLEMENTAÇÃO — ETAPA -1: TEMPLATE FACTORY

## Contexto do Projeto (cole isso no início de qualquer sessão)

```
Você é um desenvolvedor sênior TypeScript/Node.js implementando o módulo "Template Factory" 
do sistema AzureBridge v2.0 — um sistema de geração automática de RDA (Relatório Demonstrativo 
Anual - Mensal) para projetos de software.

O Template Factory é a Etapa -1 do sistema: recebe 2-5 RDAs reais já preenchidos (DOCX), 
analisa a estrutura, identifica o que é fixo vs variável entre os documentos, e gera 
automaticamente um template DOCX com placeholders + um RDAOutputSchema JSON versionado.

## Stack do Projeto (já existente e configurado)
- Runtime: Node.js 20 + TypeScript (ESM)
- Framework HTTP: Fastify 4.26 com @fastify/multipart para uploads
- ORM: Prisma 5.9.1 com PostgreSQL via Supabase
- Validação: Zod 3.22.4
- LLM: Anthropic SDK 0.74.0 (claude-sonnet-4-20250514)
- Template DOCX: docxtemplater 3.68.1 + pizzip 3.2.0
- Extração de texto: mammoth 1.11.0 (DOCX), pdf-parse 1.1.1 (PDF)
- Frontend: React 18 + React Query 5 + Zustand + shadcn/ui + Tailwind CSS

## Estrutura de Diretórios Existente
```
src/
├── modules/
│   └── rda/
│       ├── agents/
│       │   ├── base.agent.ts          # Classe base dos agentes (já existe)
│       │   └── orchestrator.ts        # Orquestrador do pipeline (já existe)
│       ├── services/
│       │   ├── claude.service.ts      # SDK Anthropic com retry (já existe)
│       │   ├── wiki.service.ts        # Sync Azure DevOps Wiki (já existe)
│       │   └── rda-template.service.ts # Upload/CRUD de templates (já existe, será estendido)
│       ├── routes/
│       │   └── rda.routes.ts          # Rotas Fastify (já existe, será estendido)
│       └── utils/
│           └── storage-paths.ts       # Gerenciamento de diretórios (já existe)
```

## Modelos Prisma Existentes Relevantes
```prisma
model RDATemplate {
  id            String   @id @default(uuid())
  projectId     String?
  name          String
  filePath      String
  placeholders  Json
  status        String   @default("active")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

## Serviço Claude Existente (claude.service.ts)
Já possui 3 métodos disponíveis:
- `complete(system, messages, options)` → texto livre
- `completeJSON<T>(system, messages, options)` → resposta JSON parseada e tipada
- `generateVariations(...)` → variações de texto
Todos com retry automático (3 tentativas, backoff com jitter) para erro 429.
```

---

## FASE 1: NOVOS ARQUIVOS A CRIAR

```
Implemente os seguintes arquivos para a Template Factory. Crie cada arquivo completo, 
funcional e com tipagem TypeScript estrita. Siga as convenções do projeto existente.

### Arquivo 1: src/modules/rda/schemas/template-factory.schema.ts

Crie todas as interfaces e schemas Zod necessários:

```typescript
// Interfaces principais que o sistema inteiro vai usar:

interface DocumentStructure {
  filename: string;
  elements: DocumentElement[];
  styles: Record<string, StyleInfo>;
  headers: HeaderFooterContent[];
  footers: HeaderFooterContent[];
  metadata: { author?: string; created?: string; modified?: string };
}

interface DocumentElement {
  type: 'heading' | 'paragraph' | 'table' | 'list' | 'image' | 'pageBreak';
  content: string;
  style: string;
  level?: number;                    // Para headings (1, 2, 3)
  children?: DocumentElement[];      // Sub-elementos
  tableData?: {
    headers: string[];
    rows: string[][];
    columnCount: number;
    rowCount: number;
  };
  listItems?: string[];              // Para listas
  position: number;                  // Índice sequencial no documento
  xmlPath?: string;                  // Caminho no XML para substituição posterior
}

interface StyleInfo {
  id: string;
  name: string;
  type: 'paragraph' | 'character';
  basedOn?: string;
  formatting: {
    bold?: boolean;
    italic?: boolean;
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    alignment?: string;
  };
}

interface HeaderFooterContent {
  type: 'header' | 'footer';
  position: 'default' | 'first' | 'even';
  content: string;
  elements: DocumentElement[];
}

interface PlaceholderDefinition {
  name: string;                       // Ex: 'RESUMO_EXECUTIVO'
  type: 'text' | 'date' | 'number' | 'list' | 'table' | 'enum' | 'date_range';
  required: boolean;
  section: string;                    // Seção do RDA onde aparece
  description: string;                // Descrição do que deve ser preenchido
  maxLength?: number;
  enumValues?: string[];              // Para tipo 'enum'
  tableColumns?: ColumnDefinition[];  // Para tipo 'table'
  examples: string[];                 // Extraídos dos modelos originais
  avgLength?: number;                 // Média de caracteres nos exemplos
}

interface ColumnDefinition {
  name: string;
  displayName: string;
  type: 'text' | 'date' | 'number' | 'enum';
  required: boolean;
}

interface TemplateAnalysisResult {
  sections: TemplateSection[];
  fixedElements: FixedElement[];
  globalPlaceholders: PlaceholderDefinition[];
}

interface TemplateSection {
  title: string;
  headingLevel: number;
  order: number;
  fixedText: string | null;
  placeholders: PlaceholderDefinition[];
  subsections?: TemplateSection[];
}

interface FixedElement {
  type: 'header' | 'footer' | 'paragraph' | 'image';
  content: string;
  position: number;
  note?: string;
}

interface RDAOutputSchema {
  schemaVersion: string;
  templateId: string;
  sections: Record<string, {
    fields: Record<string, {
      type: PlaceholderDefinition['type'];
      required: boolean;
      description: string;
      maxLength?: number;
      tableSchema?: { columns: ColumnDefinition[] };
      enumValues?: string[];
    }>;
  }>;
}
```

Crie também os schemas Zod correspondentes para validação das rotas da API.

---

### Arquivo 2: src/modules/rda/services/template-extractor.service.ts

Serviço que abre arquivos DOCX e extrai a estrutura hierárquica completa.

Requisitos técnicos:
- Usar PizZip para abrir o DOCX e acessar word/document.xml, word/styles.xml, 
  word/header*.xml, word/footer*.xml
- Parsear o XML usando uma lib leve (use 'fast-xml-parser' — adicione como dependência)
- Mapear cada elemento <w:p> para seu tipo correto baseado no estilo:
  - Se tem <w:pStyle> com val "Heading1", "Heading2", etc. → tipo 'heading' com level
  - Se tem <w:numPr> → tipo 'list'
  - <w:tbl> → tipo 'table' (extrair headers da primeira row, dados das demais)
  - <w:drawing> ou <w:pict> → tipo 'image'
  - Demais → tipo 'paragraph'
- Reconstruir runs fragmentados: DOCX quebra texto em múltiplos <w:r>. 
  Concatenar <w:t> de runs adjacentes com mesmo estilo em um único texto
- Preservar o xmlPath de cada elemento para uso posterior na substituição
- Extrair estilos de word/styles.xml mapeando id → formatação
- Extrair conteúdo de headers e footers

Métodos obrigatórios:
```typescript
class TemplateExtractorService {
  async extractStructure(fileBuffer: Buffer): Promise<DocumentStructure>
  private parseDocumentXml(xmlString: string, styles: Record<string, StyleInfo>): DocumentElement[]
  private extractTableStructure(tableNode: any): DocumentElement
  private extractStyles(stylesXml: string): Record<string, StyleInfo>
  private extractHeaderFooter(zip: PizZip): { headers: HeaderFooterContent[], footers: HeaderFooterContent[] }
  private mergeAdjacentRuns(paragraph: any): string
  private resolveStyle(element: any, styles: Record<string, StyleInfo>): { style: string, level?: number }
}
```

IMPORTANTE: 
- O extractStructure deve funcionar com DOCX reais de diferentes origens (Word, Google Docs, LibreOffice)
- Tratar graciosamente elementos não reconhecidos (loggar warning, não crashar)
- O xmlPath de cada elemento deve ser preciso o suficiente para encontrar o elemento 
  no XML original depois (usado pela template-builder para substituição)

---

### Arquivo 3: src/modules/rda/services/template-analyzer.service.ts

Serviço que usa o Claude para analisar comparativamente as estruturas extraídas 
e identificar fixo vs variável.

Requisitos:
- Receber um array de DocumentStructure (2-5 documentos)
- Usar o claude.service.ts existente (método completeJSON)
- Temperatura: 0.1 (extração factual)
- Max tokens: 8000 para analyzeModels, 4000 para generatePlaceholderMap

Métodos obrigatórios:
```typescript
class TemplateAnalyzerService {
  constructor(private claudeService: ClaudeService) {}
  
  async analyzeModels(structures: DocumentStructure[]): Promise<TemplateAnalysisResult>
  async generatePlaceholderMap(analysis: TemplateAnalysisResult): Promise<PlaceholderDefinition[]>
  extractExamples(structures: DocumentStructure[], analysis: TemplateAnalysisResult): Map<string, string[]>
  private buildAnalysisPrompt(structures: DocumentStructure[]): string
  private buildPlaceholderPrompt(analysis: TemplateAnalysisResult): string
  private validateAnalysisResult(result: any): TemplateAnalysisResult
}
```

System prompt para analyzeModels:
```
Você é um especialista em análise documental. Recebeu {N} versões do mesmo tipo de 
relatório (RDA mensal) de períodos diferentes. Analise a estrutura e conteúdo de cada 
documento e identifique:

1. ESTRUTURA FIXA: seções, headings, textos institucionais e labels que aparecem 
   idênticos ou quase idênticos em todos os documentos.

2. CONTEÚDO VARIÁVEL: partes que mudam entre documentos — são os campos que precisam 
   ser preenchidos a cada mês. Para cada um, forneça:
   - name: nome sugerido para o placeholder (UPPER_SNAKE_CASE)
   - type: tipo do dado (text, date, number, list, table, enum, date_range)
   - required: se aparece preenchido em todos os documentos
   - section: seção do relatório onde aparece
   - description: descrição clara do que deve ser preenchido

3. PADRÕES DE TABELA: tabelas com headers fixos mas linhas variáveis indicam dados 
   dinâmicos que devem virar loops ({#NOME}...{/NOME}).

4. Para campos do tipo 'enum', liste os valores possíveis encontrados nos documentos.

Responda EXCLUSIVAMENTE em JSON válido seguindo o schema TemplateAnalysisResult fornecido.
Não inclua markdown, comentários ou texto fora do JSON.
```

IMPORTANTE:
- Se os documentos forem muito grandes, fazer chunking e enviar seção por seção ao Claude
- O extractExamples NÃO usa LLM — é código determinístico que coleta o conteúdo real 
  de cada campo variável dos modelos originais
- Validar o resultado do Claude contra o schema antes de retornar

---

### Arquivo 4: src/modules/rda/services/template-builder.service.ts

Serviço que constrói o template DOCX real com placeholders a partir da análise.

Requisitos:
- Selecionar o documento mais completo como base (maior número de elementos)
- Abrir o DOCX base via PizZip
- Substituir conteúdo variável por placeholders no XML, preservando formatação
- Converter tabelas dinâmicas em loops docxtemplater
- Testar o template gerado com dados mock para validar que funciona
- MANTER TODA A FORMATAÇÃO ORIGINAL (fontes, cores, estilos, imagens, headers, footers)

Métodos obrigatórios:
```typescript
class TemplateBuilderService {
  async buildTemplate(
    structures: DocumentStructure[],
    analysis: TemplateAnalysisResult, 
    originalFiles: Buffer[]
  ): Promise<{ templateBuffer: Buffer; placeholders: PlaceholderDefinition[] }>
  
  private selectBaseDocument(structures: DocumentStructure[]): number
  
  private replaceContentWithPlaceholders(
    zip: PizZip, 
    analysis: TemplateAnalysisResult,
    structure: DocumentStructure
  ): PizZip
  
  private replaceInXml(
    xml: string, 
    originalContent: string, 
    placeholder: string,
    fuzzyMatch: boolean
  ): string
  
  private convertTableToLoop(
    xml: string, 
    tableElement: DocumentElement, 
    placeholder: PlaceholderDefinition
  ): string
  
  private mergeRunsForPlaceholder(xml: string): string
  
  async validateTemplate(
    templateBuffer: Buffer, 
    placeholders: PlaceholderDefinition[]
  ): Promise<{ valid: boolean; errors: string[] }>
  
  private generateMockData(placeholders: PlaceholderDefinition[]): Record<string, any>
}
```

Regras críticas de substituição no XML:
1. Antes de substituir, fazer merge de runs adjacentes no parágrafo alvo
   (DOCX pode quebrar "Resumo do mês" em <w:r>Resu</w:r><w:r>mo do mês</w:r>)
2. Substituir o conteúdo do <w:t> mantendo todo o <w:rPr> (propriedades de formatação)
3. Para tabelas dinâmicas:
   - Manter a primeira row de headers intacta
   - Na primeira row de dados, substituir conteúdo por placeholders de campo
   - Envolver com tags de loop: {#PLACEHOLDER_TABLE} e {/PLACEHOLDER_TABLE}
   - Remover rows de dados extras (o loop vai gerar quantas forem necessárias)
4. Usar correspondência fuzzy para localizar texto (trim, normalizar espaços, 
   ignorar diferenças menores de pontuação)
5. Se a substituição direta falhar, logar warning e tentar via regex

Validação do template:
- Gerar dados mock para todos os placeholders
- Tentar renderizar o template com docxtemplater + dados mock
- Se falhar, reportar quais placeholders deram problema
- Retornar { valid: true/false, errors: string[] }

---

### Arquivo 5: src/modules/rda/services/template-factory.service.ts

Serviço orquestrador que coordena todo o processo da Template Factory.

```typescript
class TemplateFactoryService {
  constructor(
    private extractorService: TemplateExtractorService,
    private analyzerService: TemplateAnalyzerService,
    private builderService: TemplateBuilderService,
    private prisma: PrismaClient
  ) {}

  async createTemplateFromModels(
    files: Buffer[], 
    filenames: string[],
    projectId?: string
  ): Promise<{
    templateId: string;
    schemaId: string;
    placeholders: PlaceholderDefinition[];
    validationResult: { valid: boolean; errors: string[] };
  }>

  // Fluxo interno:
  // 1. Para cada file: extractorService.extractStructure(file)
  // 2. analyzerService.analyzeModels(structures)
  // 3. analyzerService.extractExamples(structures, analysis)
  // 4. builderService.buildTemplate(structures, analysis, files)
  // 5. builderService.validateTemplate(templateBuffer, placeholders)
  // 6. Salvar template DOCX no filesystem
  // 7. Criar/atualizar registros no banco:
  //    - RDATemplate (com placeholders e filePath)
  //    - RDASchema (com schema versionado)
  //    - RDAExample (exemplos por seção)
  // 8. Retornar resultado com IDs e status de validação

  private generateSchemaVersion(): string  // formato 'YYYY-MM'
  
  private buildOutputSchema(
    placeholders: PlaceholderDefinition[], 
    templateId: string, 
    version: string
  ): RDAOutputSchema
}
```

---

### Arquivo 6: Novos modelos Prisma

Adicione ao schema.prisma existente:

```prisma
model RDASchema {
  id              String   @id @default(uuid())
  version         String
  templateId      String
  schema          Json     // RDAOutputSchema completo
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())

  template        RDATemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([templateId, version])
}

model RDAExample {
  id              String   @id @default(uuid())
  schemaId        String
  section         String
  fieldName       String
  content         Json     // Exemplo de conteúdo real extraído
  source          String   // 'template_factory' | 'approved_generation'
  quality         Float    @default(1.0)
  createdAt       DateTime @default(now())

  schema          RDASchema @relation(fields: [schemaId], references: [id], onDelete: Cascade)

  @@index([schemaId, section])
}
```

E atualize o RDATemplate existente:
```prisma
model RDATemplate {
  id            String   @id @default(uuid())
  projectId     String?
  name          String
  filePath      String
  placeholders  Json
  status        String   @default("active")
  schemaId      String?           // NOVO
  sourceModels  Json?             // NOVO: filenames dos modelos usados
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  schema        RDASchema? @relation(fields: [schemaId], references: [id])  // NOVO
  schemas       RDASchema[]  // NOVO: relação inversa
}
```

---

### Arquivo 7: Rotas da API (adicionar ao rda.routes.ts existente)

Adicione 4 novas rotas:

```
POST   /rda/template-factory/analyze    → Upload de 2-5 DOCX, retorna análise (preview dos placeholders)
POST   /rda/template-factory/generate   → Gera o template a partir da análise aprovada
GET    /rda/template-factory/:id/status → Status da geração do template
GET    /rda/schemas                     → Lista schemas disponíveis
```

A rota /analyze recebe multipart/form-data com os arquivos e retorna:
- Lista de seções identificadas
- Placeholders sugeridos com tipo e obrigatoriedade
- Elementos fixos encontrados
(Isso permite o usuário revisar antes de gerar o template definitivo)

A rota /generate recebe:
- O ID da análise (ou os mesmos arquivos)
- Ajustes do usuário nos placeholders (renomear, mudar tipo, adicionar, remover)
- E gera o template DOCX final + schema

---

### Arquivo 8: Componentes React do Frontend

Crie os componentes para o wizard da Template Factory:

```
src/pages/rda/components/template-factory/
├── TemplateFactoryWizard.tsx      # Wizard de 3 steps
├── Step1ModelUpload.tsx           # Upload dos 2-5 modelos DOCX (react-dropzone)
├── Step2AnalysisReview.tsx        # Revisão da análise: seções, placeholders, fixo vs variável
├── Step3TemplatePreview.tsx       # Preview do template gerado + botão de download/ativar
└── hooks/
    ├── useAnalyzeModels.ts        # React Query mutation para POST /analyze
    ├── useGenerateTemplate.ts     # React Query mutation para POST /generate
    └── useTemplateFactoryStatus.ts # React Query polling para GET /status
```

Step1: 
- react-dropzone aceitando apenas .docx
- Mínimo 2 arquivos, máximo 5
- Barra de progresso no upload
- Botão "Analisar" que envia para /analyze

Step2:
- Exibir seções encontradas em cards expansíveis
- Cada placeholder com: nome (editável), tipo (select), obrigatório (toggle), descrição
- Elementos fixos em seção separada colapsável
- Botão "Adicionar placeholder" para placeholders que o Claude não detectou
- Botão "Remover" para placeholders incorretos
- Botão "Gerar Template" quando satisfeito

Step3:
- Indicador de progresso da geração
- Resultado da validação (verde/vermelho com lista de erros se houver)
- Botão "Download Template" para verificar manualmente
- Botão "Ativar Template" para usar na geração de RDAs
- Exibir o schema JSON gerado (colapsável, para usuários técnicos)

Use shadcn/ui (Card, Button, Badge, Progress, Select, Switch, Tabs, Dialog, Toast).
Use Tailwind CSS para estilos. Use Lucide React para ícones.
Use os mesmos padrões de hooks React Query do projeto existente.
```

---

## REGRAS GERAIS DE IMPLEMENTAÇÃO

```
1. TypeScript estrito: sem 'any' desnecessário, interfaces para tudo
2. Tratamento de erros: try/catch com mensagens claras, nunca crashar silenciosamente
3. Logging: usar console.log com prefixo [TemplateFactory] para todas as operações
4. Imports: ESM (import/export), compatível com o setup existente do projeto
5. Zod: validar todas as entradas de rotas E saídas do Claude
6. Testes: se possível, incluir exemplos de testes com vitest para os serviços principais
7. Dependência nova necessária: fast-xml-parser (para parsing do XML do DOCX)
   Instalar: npm install fast-xml-parser
8. Todos os textos de UI em português brasileiro
9. Manter compatibilidade com os serviços existentes (claude.service.ts, storage-paths.ts)
10. Nenhum placeholder hardcoded — tudo derivado da análise dos documentos
```

---

## ORDEM DE IMPLEMENTAÇÃO SUGERIDA

```
Implemente na seguinte ordem (cada item depende dos anteriores):

1. template-factory.schema.ts (interfaces e Zod schemas — base de tudo)
2. Modelos Prisma (adicionar ao schema.prisma + rodar prisma generate)
3. template-extractor.service.ts (extração estrutural do DOCX)
4. template-analyzer.service.ts (análise com Claude)
5. template-builder.service.ts (geração do template DOCX)
6. template-factory.service.ts (orquestrador)
7. Rotas Fastify (API endpoints)
8. Hooks React Query (frontend data layer)
9. Componentes React (UI do wizard)
```

---

## COMO USAR ESTE PROMPT

### No Claude Code (terminal):
```bash
# Cole o prompt inteiro e peça para implementar arquivo por arquivo:
# "Implemente o arquivo 1: template-factory.schema.ts"
# Depois: "Agora implemente o arquivo 2: modelos Prisma"
# E assim por diante...
```

### No Codex / Copilot / Antigravity:
```
# Cole o "Contexto do Projeto" no início
# Depois cole a seção do arquivo específico que quer implementar
# Ex: Cole "Arquivo 3: template-analyzer.service.ts" para implementar esse serviço
```

### Se a sessão acabar (limite de tokens):
```
# Inicie nova sessão com:
# 1. O "Contexto do Projeto" (sempre no início)
# 2. A seção do próximo arquivo a implementar
# 3. Se necessário, cole as interfaces do schema.ts que já foi implementado
```
