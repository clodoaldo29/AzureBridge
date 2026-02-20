-- RDA Fase 0 (RAG): alinhar schema com codigo em producao

CREATE EXTENSION IF NOT EXISTS vector;

-- documents: metadados de extracao/chunking
ALTER TABLE "documents"
  ADD COLUMN IF NOT EXISTS "extractionMethod" TEXT,
  ADD COLUMN IF NOT EXISTS "extractionQuality" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "chunked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "chunkCount" INTEGER;

-- wiki_pages: metadados de chunking
ALTER TABLE "wiki_pages"
  ADD COLUMN IF NOT EXISTS "chunked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "chunkCount" INTEGER;

-- chunks com embeddings
CREATE TABLE IF NOT EXISTS "document_chunks" (
  "id" TEXT NOT NULL,
  "documentId" TEXT,
  "wikiPageId" TEXT,
  "projectId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "sourceType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- contexto agregado do projeto
CREATE TABLE IF NOT EXISTS "project_contexts" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "projectName" TEXT NOT NULL,
  "projectScope" TEXT NOT NULL,
  "objectives" JSONB NOT NULL DEFAULT '[]',
  "teamMembers" JSONB NOT NULL DEFAULT '[]',
  "technologies" JSONB NOT NULL DEFAULT '[]',
  "keyMilestones" JSONB NOT NULL DEFAULT '[]',
  "businessRules" JSONB NOT NULL DEFAULT '[]',
  "deliveryPlan" JSONB NOT NULL DEFAULT '[]',
  "stakeholders" JSONB NOT NULL DEFAULT '[]',
  "summary" TEXT,
  "lastUpdated" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_contexts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_contexts_projectId_key" ON "project_contexts"("projectId");
CREATE INDEX IF NOT EXISTS "project_contexts_projectId_idx" ON "project_contexts"("projectId");

CREATE INDEX IF NOT EXISTS "document_chunks_projectId_idx" ON "document_chunks"("projectId");
CREATE INDEX IF NOT EXISTS "document_chunks_documentId_idx" ON "document_chunks"("documentId");
CREATE INDEX IF NOT EXISTS "document_chunks_wikiPageId_idx" ON "document_chunks"("wikiPageId");
CREATE INDEX IF NOT EXISTS "document_chunks_sourceType_idx" ON "document_chunks"("sourceType");
CREATE INDEX IF NOT EXISTS "document_chunks_projectId_sourceType_idx" ON "document_chunks"("projectId", "sourceType");

-- ANN index para busca vetorial
CREATE INDEX IF NOT EXISTS "document_chunks_embedding_ivfflat_idx"
  ON "document_chunks"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 100);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_chunks_documentId_fkey'
  ) THEN
    ALTER TABLE "document_chunks"
      ADD CONSTRAINT "document_chunks_documentId_fkey"
      FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_chunks_wikiPageId_fkey'
  ) THEN
    ALTER TABLE "document_chunks"
      ADD CONSTRAINT "document_chunks_wikiPageId_fkey"
      FOREIGN KEY ("wikiPageId") REFERENCES "wiki_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'document_chunks_projectId_fkey'
  ) THEN
    ALTER TABLE "document_chunks"
      ADD CONSTRAINT "document_chunks_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_contexts_projectId_fkey'
  ) THEN
    ALTER TABLE "project_contexts"
      ADD CONSTRAINT "project_contexts_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
