-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "azureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "state" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "azureId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "uniqueName" TEXT NOT NULL,
    "imageUrl" TEXT,
    "role" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_capacities" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "availableHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "allocatedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "daysOff" JSONB,
    "activitiesPerDay" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_capacities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints" (
    "id" TEXT NOT NULL,
    "azureId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL,
    "timeFrame" TEXT NOT NULL,
    "totalPlannedHours" DOUBLE PRECISION DEFAULT 0,
    "totalCompletedHours" DOUBLE PRECISION DEFAULT 0,
    "totalRemainingHours" DOUBLE PRECISION DEFAULT 0,
    "totalStoryPoints" INTEGER DEFAULT 0,
    "completedStoryPoints" INTEGER DEFAULT 0,
    "teamCapacityHours" DOUBLE PRECISION DEFAULT 0,
    "commitmentHours" DOUBLE PRECISION DEFAULT 0,
    "isOnTrack" BOOLEAN NOT NULL DEFAULT true,
    "riskLevel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastCalculatedAt" TIMESTAMP(3),

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprint_snapshots" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "snapshotTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remainingWork" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedWork" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalWork" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingPoints" INTEGER NOT NULL DEFAULT 0,
    "completedPoints" INTEGER NOT NULL DEFAULT 0,
    "totalPoints" INTEGER NOT NULL DEFAULT 0,
    "todoCount" INTEGER NOT NULL DEFAULT 0,
    "inProgressCount" INTEGER NOT NULL DEFAULT 0,
    "doneCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "addedCount" INTEGER NOT NULL DEFAULT 0,
    "removedCount" INTEGER NOT NULL DEFAULT 0,
    "idealRemaining" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sprint_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_items" (
    "id" INTEGER NOT NULL,
    "azureId" INTEGER NOT NULL,
    "projectId" TEXT NOT NULL,
    "sprintId" TEXT,
    "parentId" INTEGER,
    "type" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reason" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "acceptanceCriteria" TEXT,
    "reproSteps" TEXT,
    "assignedToId" TEXT,
    "originalEstimate" DOUBLE PRECISION DEFAULT 0,
    "completedWork" DOUBLE PRECISION DEFAULT 0,
    "remainingWork" DOUBLE PRECISION DEFAULT 0,
    "storyPoints" INTEGER,
    "effort" INTEGER,
    "priority" INTEGER DEFAULT 3,
    "severity" TEXT,
    "createdDate" TIMESTAMP(3) NOT NULL,
    "changedDate" TIMESTAMP(3) NOT NULL,
    "closedDate" TIMESTAMP(3),
    "resolvedDate" TIMESTAMP(3),
    "stateChangeDate" TIMESTAMP(3),
    "activatedDate" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "closedBy" TEXT,
    "resolvedBy" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "isDelayed" BOOLEAN NOT NULL DEFAULT false,
    "isRemoved" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "areaPath" TEXT NOT NULL,
    "iterationPath" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "attachmentCount" INTEGER NOT NULL DEFAULT 0,
    "relationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_item_revisions" (
    "id" TEXT NOT NULL,
    "workItemId" INTEGER NOT NULL,
    "rev" INTEGER NOT NULL,
    "revisedDate" TIMESTAMP(3) NOT NULL,
    "revisedBy" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "changedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_item_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_item_comments" (
    "id" TEXT NOT NULL,
    "azureId" INTEGER NOT NULL,
    "workItemId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdDate" TIMESTAMP(3) NOT NULL,
    "modifiedDate" TIMESTAMP(3),
    "modifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_item_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_snapshots" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sprintId" TEXT,
    "metricType" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "pdfUrl" TEXT,
    "docxUrl" TEXT,
    "jsonUrl" TEXT,
    "templateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "structure" JSONB NOT NULL,
    "styles" JSONB,
    "projectId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sprintId" TEXT,
    "workItemId" INTEGER,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "dismissedBy" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'light',
    "dashboardLayout" JSONB,
    "favoriteProjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "favoriteSprints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "savedFilters" JSONB,
    "notifications" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "syncType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "itemsProcessed" INTEGER NOT NULL DEFAULT 0,
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "itemsFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "error" TEXT,
    "errorDetails" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_azureId_key" ON "projects"("azureId");

-- CreateIndex
CREATE INDEX "projects_azureId_idx" ON "projects"("azureId");

-- CreateIndex
CREATE INDEX "projects_name_idx" ON "projects"("name");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_azureId_key" ON "team_members"("azureId");

-- CreateIndex
CREATE INDEX "team_members_projectId_idx" ON "team_members"("projectId");

-- CreateIndex
CREATE INDEX "team_members_azureId_idx" ON "team_members"("azureId");

-- CreateIndex
CREATE INDEX "team_members_uniqueName_idx" ON "team_members"("uniqueName");

-- CreateIndex
CREATE INDEX "team_capacities_sprintId_idx" ON "team_capacities"("sprintId");

-- CreateIndex
CREATE INDEX "team_capacities_memberId_idx" ON "team_capacities"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "team_capacities_memberId_sprintId_key" ON "team_capacities"("memberId", "sprintId");

-- CreateIndex
CREATE UNIQUE INDEX "sprints_azureId_key" ON "sprints"("azureId");

-- CreateIndex
CREATE INDEX "sprints_projectId_idx" ON "sprints"("projectId");

-- CreateIndex
CREATE INDEX "sprints_azureId_idx" ON "sprints"("azureId");

-- CreateIndex
CREATE INDEX "sprints_state_idx" ON "sprints"("state");

-- CreateIndex
CREATE INDEX "sprints_startDate_endDate_idx" ON "sprints"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "sprints_name_idx" ON "sprints"("name");

-- CreateIndex
CREATE INDEX "sprint_snapshots_sprintId_idx" ON "sprint_snapshots"("sprintId");

-- CreateIndex
CREATE INDEX "sprint_snapshots_snapshotDate_idx" ON "sprint_snapshots"("snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "sprint_snapshots_sprintId_snapshotDate_key" ON "sprint_snapshots"("sprintId", "snapshotDate");

-- CreateIndex
CREATE UNIQUE INDEX "work_items_azureId_key" ON "work_items"("azureId");

-- CreateIndex
CREATE INDEX "work_items_projectId_idx" ON "work_items"("projectId");

-- CreateIndex
CREATE INDEX "work_items_sprintId_idx" ON "work_items"("sprintId");

-- CreateIndex
CREATE INDEX "work_items_azureId_idx" ON "work_items"("azureId");

-- CreateIndex
CREATE INDEX "work_items_type_idx" ON "work_items"("type");

-- CreateIndex
CREATE INDEX "work_items_state_idx" ON "work_items"("state");

-- CreateIndex
CREATE INDEX "work_items_assignedToId_idx" ON "work_items"("assignedToId");

-- CreateIndex
CREATE INDEX "work_items_parentId_idx" ON "work_items"("parentId");

-- CreateIndex
CREATE INDEX "work_items_createdDate_idx" ON "work_items"("createdDate");

-- CreateIndex
CREATE INDEX "work_items_changedDate_idx" ON "work_items"("changedDate");

-- CreateIndex
CREATE INDEX "work_items_isBlocked_idx" ON "work_items"("isBlocked");

-- CreateIndex
CREATE INDEX "work_items_isDelayed_idx" ON "work_items"("isDelayed");

-- CreateIndex
CREATE INDEX "work_item_revisions_workItemId_idx" ON "work_item_revisions"("workItemId");

-- CreateIndex
CREATE INDEX "work_item_revisions_revisedDate_idx" ON "work_item_revisions"("revisedDate");

-- CreateIndex
CREATE INDEX "work_item_revisions_revisedBy_idx" ON "work_item_revisions"("revisedBy");

-- CreateIndex
CREATE UNIQUE INDEX "work_item_revisions_workItemId_rev_key" ON "work_item_revisions"("workItemId", "rev");

-- CreateIndex
CREATE INDEX "work_item_comments_workItemId_idx" ON "work_item_comments"("workItemId");

-- CreateIndex
CREATE INDEX "work_item_comments_createdDate_idx" ON "work_item_comments"("createdDate");

-- CreateIndex
CREATE INDEX "work_item_comments_createdBy_idx" ON "work_item_comments"("createdBy");

-- CreateIndex
CREATE INDEX "metric_snapshots_projectId_metricType_idx" ON "metric_snapshots"("projectId", "metricType");

-- CreateIndex
CREATE INDEX "metric_snapshots_sprintId_metricType_idx" ON "metric_snapshots"("sprintId", "metricType");

-- CreateIndex
CREATE INDEX "metric_snapshots_metricType_period_idx" ON "metric_snapshots"("metricType", "period");

-- CreateIndex
CREATE INDEX "metric_snapshots_snapshotDate_idx" ON "metric_snapshots"("snapshotDate");

-- CreateIndex
CREATE INDEX "reports_projectId_idx" ON "reports"("projectId");

-- CreateIndex
CREATE INDEX "reports_type_idx" ON "reports"("type");

-- CreateIndex
CREATE INDEX "reports_period_idx" ON "reports"("period");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_generatedAt_idx" ON "reports"("generatedAt");

-- CreateIndex
CREATE INDEX "report_templates_type_idx" ON "report_templates"("type");

-- CreateIndex
CREATE INDEX "report_templates_projectId_idx" ON "report_templates"("projectId");

-- CreateIndex
CREATE INDEX "report_templates_isDefault_idx" ON "report_templates"("isDefault");

-- CreateIndex
CREATE INDEX "alerts_projectId_idx" ON "alerts"("projectId");

-- CreateIndex
CREATE INDEX "alerts_sprintId_idx" ON "alerts"("sprintId");

-- CreateIndex
CREATE INDEX "alerts_workItemId_idx" ON "alerts"("workItemId");

-- CreateIndex
CREATE INDEX "alerts_type_idx" ON "alerts"("type");

-- CreateIndex
CREATE INDEX "alerts_severity_idx" ON "alerts"("severity");

-- CreateIndex
CREATE INDEX "alerts_status_idx" ON "alerts"("status");

-- CreateIndex
CREATE INDEX "alerts_detectedAt_idx" ON "alerts"("detectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");

-- CreateIndex
CREATE INDEX "user_preferences_userId_idx" ON "user_preferences"("userId");

-- CreateIndex
CREATE INDEX "sync_logs_projectId_idx" ON "sync_logs"("projectId");

-- CreateIndex
CREATE INDEX "sync_logs_syncType_idx" ON "sync_logs"("syncType");

-- CreateIndex
CREATE INDEX "sync_logs_status_idx" ON "sync_logs"("status");

-- CreateIndex
CREATE INDEX "sync_logs_startedAt_idx" ON "sync_logs"("startedAt");

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_capacities" ADD CONSTRAINT "team_capacities_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "team_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_capacities" ADD CONSTRAINT "team_capacities_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_snapshots" ADD CONSTRAINT "sprint_snapshots_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "work_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "team_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item_revisions" ADD CONSTRAINT "work_item_revisions_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item_comments" ADD CONSTRAINT "work_item_comments_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
