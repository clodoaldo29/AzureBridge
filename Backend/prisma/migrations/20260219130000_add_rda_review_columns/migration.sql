-- RDA Etapa 4 - colunas de revisao Human-in-the-Loop

ALTER TABLE "rda_generations"
  ADD COLUMN IF NOT EXISTS "overrides" JSONB,
  ADD COLUMN IF NOT EXISTS "validationReport" JSONB,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB,
  ADD COLUMN IF NOT EXISTS "period" JSONB,
  ADD COLUMN IF NOT EXISTS "schemaVersion" TEXT;
