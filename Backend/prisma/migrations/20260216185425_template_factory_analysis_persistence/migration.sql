-- CreateTable
CREATE TABLE "rda_template_factory_analyses" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "filenames" JSONB NOT NULL,
    "filePaths" JSONB NOT NULL,
    "structures" JSONB NOT NULL,
    "analysis" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "rda_template_factory_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rda_template_factory_analyses_projectId_idx" ON "rda_template_factory_analyses"("projectId");

-- CreateIndex
CREATE INDEX "rda_template_factory_analyses_status_idx" ON "rda_template_factory_analyses"("status");

-- CreateIndex
CREATE INDEX "rda_template_factory_analyses_createdAt_idx" ON "rda_template_factory_analyses"("createdAt");

-- AddForeignKey
ALTER TABLE "rda_template_factory_analyses" ADD CONSTRAINT "rda_template_factory_analyses_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
