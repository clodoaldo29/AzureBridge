-- AlterTable
ALTER TABLE "rda_templates" ADD COLUMN     "activeSchemaId" TEXT,
ADD COLUMN     "sourceModels" JSONB;

-- CreateTable
CREATE TABLE "rda_schemas" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "schema" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rda_schemas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rda_examples" (
    "id" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "quality" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rda_examples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rda_schemas_templateId_idx" ON "rda_schemas"("templateId");

-- CreateIndex
CREATE INDEX "rda_schemas_isActive_idx" ON "rda_schemas"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "rda_schemas_templateId_version_key" ON "rda_schemas"("templateId", "version");

-- CreateIndex
CREATE INDEX "rda_examples_schemaId_section_idx" ON "rda_examples"("schemaId", "section");

-- CreateIndex
CREATE INDEX "rda_examples_schemaId_fieldName_idx" ON "rda_examples"("schemaId", "fieldName");

-- CreateIndex
CREATE INDEX "rda_templates_activeSchemaId_idx" ON "rda_templates"("activeSchemaId");

-- AddForeignKey
ALTER TABLE "rda_templates" ADD CONSTRAINT "rda_templates_activeSchemaId_fkey" FOREIGN KEY ("activeSchemaId") REFERENCES "rda_schemas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rda_schemas" ADD CONSTRAINT "rda_schemas_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "rda_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rda_examples" ADD CONSTRAINT "rda_examples_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "rda_schemas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
