CREATE TABLE "sprint_history_summaries" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sprintName" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "capacityHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plannedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveredHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scopeAddedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scopeRemovedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finalDeviationHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "planVsCapacityPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveredVsPlannedPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deliveredVsCapacityPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "snapshotCount" INTEGER NOT NULL DEFAULT 0,
    "capacityMemberCount" INTEGER NOT NULL DEFAULT 0,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprint_history_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sprint_history_summaries_sprintId_key" ON "sprint_history_summaries"("sprintId");
CREATE INDEX "sprint_history_summaries_projectId_startDate_idx" ON "sprint_history_summaries"("projectId", "startDate");
CREATE INDEX "sprint_history_summaries_projectId_isCurrent_idx" ON "sprint_history_summaries"("projectId", "isCurrent");
CREATE INDEX "sprint_history_summaries_calculatedAt_idx" ON "sprint_history_summaries"("calculatedAt");

ALTER TABLE "sprint_history_summaries"
ADD CONSTRAINT "sprint_history_summaries_sprintId_fkey"
FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sprint_history_summaries"
ADD CONSTRAINT "sprint_history_summaries_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
