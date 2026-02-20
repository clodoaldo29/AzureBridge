-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- IVFFlat vector index (recommended after enough rows)
CREATE INDEX IF NOT EXISTS idx_document_chunk_embedding
  ON "document_chunks"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Full text generated column for portuguese search
ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('portuguese', content)) STORED;

-- GIN index for full text search
CREATE INDEX IF NOT EXISTS idx_document_chunk_tsv
  ON "document_chunks"
  USING gin(tsv);

-- Composite index for project + source type filtering
CREATE INDEX IF NOT EXISTS idx_document_chunk_project_source
  ON "document_chunks"("projectId", "sourceType");

-- Helper function for hybrid search
CREATE OR REPLACE FUNCTION search_chunks_hybrid(
  query_embedding vector(1536),
  p_project_id TEXT,
  p_source_types TEXT[] DEFAULT NULL,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id TEXT,
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
    dc.metadata::jsonb,
    dc."sourceType" AS source_type,
    1 - (dc.embedding <=> query_embedding) AS similarity,
    0::FLOAT AS ts_rank
  FROM "document_chunks" dc
  WHERE dc."projectId" = p_project_id
    AND (p_source_types IS NULL OR dc."sourceType" = ANY(p_source_types))
  ORDER BY dc.embedding <=> query_embedding
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
