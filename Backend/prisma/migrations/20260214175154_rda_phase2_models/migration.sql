-- CreateTable
CREATE TABLE "rda_templates" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filePath" TEXT NOT NULL,
    "placeholders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rda_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rda_generations" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "periodType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "outputFilePath" TEXT,
    "fileSize" INTEGER,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "partialResults" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rda_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rda_templates_projectId_idx" ON "rda_templates"("projectId");

-- CreateIndex
CREATE INDEX "rda_templates_isActive_idx" ON "rda_templates"("isActive");

-- CreateIndex
CREATE INDEX "rda_generations_projectId_idx" ON "rda_generations"("projectId");

-- CreateIndex
CREATE INDEX "rda_generations_templateId_idx" ON "rda_generations"("templateId");

-- CreateIndex
CREATE INDEX "rda_generations_status_idx" ON "rda_generations"("status");

-- CreateIndex
CREATE INDEX "rda_generations_createdAt_idx" ON "rda_generations"("createdAt");

-- AddForeignKey
ALTER TABLE "rda_templates" ADD CONSTRAINT "rda_templates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rda_generations" ADD CONSTRAINT "rda_generations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rda_generations" ADD CONSTRAINT "rda_generations_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "rda_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
