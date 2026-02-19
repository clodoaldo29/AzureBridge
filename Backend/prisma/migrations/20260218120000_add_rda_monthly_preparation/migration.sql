-- RDA Etapa 1 - snapshots mensais

CREATE TABLE IF NOT EXISTS "rda_work_item_snapshots" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "workItemId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "assignedTo" TEXT,
  "areaPath" TEXT,
  "iterationPath" TEXT,
  "tags" TEXT,
  "priority" INTEGER,
  "storyPoints" DOUBLE PRECISION,
  "description" TEXT,
  "acceptanceCriteria" TEXT,
  "createdDate" TIMESTAMP(3) NOT NULL,
  "changedDate" TIMESTAMP(3) NOT NULL,
  "closedDate" TIMESTAMP(3),
  "parentId" INTEGER,
  "url" TEXT,
  "periodKey" TEXT NOT NULL,
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rda_work_item_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rda_work_item_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "rda_work_item_snapshots_projectId_workItemId_periodKey_key" ON "rda_work_item_snapshots"("projectId", "workItemId", "periodKey");
CREATE INDEX IF NOT EXISTS "rda_work_item_snapshots_projectId_idx" ON "rda_work_item_snapshots"("projectId");
CREATE INDEX IF NOT EXISTS "rda_work_item_snapshots_projectId_periodKey_idx" ON "rda_work_item_snapshots"("projectId", "periodKey");
CREATE INDEX IF NOT EXISTS "rda_work_item_snapshots_projectId_iterationPath_idx" ON "rda_work_item_snapshots"("projectId", "iterationPath");
CREATE INDEX IF NOT EXISTS "rda_work_item_snapshots_projectId_state_idx" ON "rda_work_item_snapshots"("projectId", "state");
CREATE INDEX IF NOT EXISTS "rda_work_item_snapshots_workItemId_idx" ON "rda_work_item_snapshots"("workItemId");

CREATE TABLE IF NOT EXISTS "rda_sprint_snapshots" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "sprintName" TEXT NOT NULL,
  "iterationPath" TEXT NOT NULL,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "totalWorkItems" INTEGER NOT NULL DEFAULT 0,
  "completedItems" INTEGER NOT NULL DEFAULT 0,
  "activeItems" INTEGER NOT NULL DEFAULT 0,
  "newItems" INTEGER NOT NULL DEFAULT 0,
  "removedItems" INTEGER NOT NULL DEFAULT 0,
  "totalStoryPoints" DOUBLE PRECISION,
  "completedStoryPoints" DOUBLE PRECISION,
  "tasksByState" JSONB NOT NULL DEFAULT '{}',
  "bugsByState" JSONB NOT NULL DEFAULT '{}',
  "storiesByState" JSONB NOT NULL DEFAULT '{}',
  "teamCapacity" DOUBLE PRECISION,
  "velocity" DOUBLE PRECISION,
  "taskboardUrl" TEXT,
  "period" TEXT NOT NULL,
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rda_sprint_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rda_sprint_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "rda_sprint_snapshots_projectId_iterationPath_period_key" ON "rda_sprint_snapshots"("projectId", "iterationPath", "period");
CREATE INDEX IF NOT EXISTS "rda_sprint_snapshots_projectId_period_idx" ON "rda_sprint_snapshots"("projectId", "period");
CREATE INDEX IF NOT EXISTS "rda_sprint_snapshots_projectId_idx" ON "rda_sprint_snapshots"("projectId");

CREATE TABLE IF NOT EXISTS "rda_monthly_snapshots" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'collecting',
  "workItemsTotal" INTEGER NOT NULL DEFAULT 0,
  "workItemsNew" INTEGER NOT NULL DEFAULT 0,
  "workItemsClosed" INTEGER NOT NULL DEFAULT 0,
  "workItemsActive" INTEGER NOT NULL DEFAULT 0,
  "sprintsCount" INTEGER NOT NULL DEFAULT 0,
  "wikiPagesUpdated" INTEGER NOT NULL DEFAULT 0,
  "documentsUploaded" INTEGER NOT NULL DEFAULT 0,
  "chunksCreated" INTEGER NOT NULL DEFAULT 0,
  "workItemsStatus" TEXT NOT NULL DEFAULT 'pending',
  "sprintsStatus" TEXT NOT NULL DEFAULT 'pending',
  "wikiStatus" TEXT NOT NULL DEFAULT 'pending',
  "documentsStatus" TEXT NOT NULL DEFAULT 'pending',
  "contextStatus" TEXT NOT NULL DEFAULT 'pending',
  "errors" JSONB NOT NULL DEFAULT '[]',
  "metadata" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rda_monthly_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rda_monthly_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "rda_monthly_snapshots_projectId_period_key" ON "rda_monthly_snapshots"("projectId", "period");
CREATE INDEX IF NOT EXISTS "rda_monthly_snapshots_projectId_idx" ON "rda_monthly_snapshots"("projectId");
CREATE INDEX IF NOT EXISTS "rda_monthly_snapshots_status_idx" ON "rda_monthly_snapshots"("status");
CREATE INDEX IF NOT EXISTS "rda_monthly_snapshots_projectId_period_idx" ON "rda_monthly_snapshots"("projectId", "period");

ALTER TABLE "rda_monthly_snapshots"
ADD COLUMN IF NOT EXISTS "metadata" JSONB;
