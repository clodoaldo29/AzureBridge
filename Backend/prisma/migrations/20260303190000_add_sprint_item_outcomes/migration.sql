CREATE TABLE IF NOT EXISTS "sprint_item_outcomes" (
    "id" TEXT NOT NULL,
    "sprintId" TEXT NOT NULL,
    "workItemId" INTEGER NOT NULL,
    "plannedInitialHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scopeAddedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scopeRemovedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scopeAddedAfterSprintHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scopeRemovedAfterSprintHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedInSprintHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "completedAfterSprintHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remainingAtSprintEndHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wasInSprintAtD0" BOOLEAN NOT NULL DEFAULT false,
    "enteredAfterD0" BOOLEAN NOT NULL DEFAULT false,
    "leftDuringSprint" BOOLEAN NOT NULL DEFAULT false,
    "inSprintAtEnd" BOOLEAN NOT NULL DEFAULT false,
    "doneAfterSprint" BOOLEAN NOT NULL DEFAULT false,
    "doneAfterSprintDate" TIMESTAMP(3),
    "lastScopeEventDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sprint_item_outcomes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sprint_item_outcomes_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sprint_item_outcomes_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "sprint_item_outcomes"
    ADD COLUMN IF NOT EXISTS "scopeAddedAfterSprintHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "scopeRemovedAfterSprintHours" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "sprint_item_outcomes_sprintId_workItemId_key"
    ON "sprint_item_outcomes"("sprintId", "workItemId");

CREATE INDEX IF NOT EXISTS "sprint_item_outcomes_sprintId_idx"
    ON "sprint_item_outcomes"("sprintId");

CREATE INDEX IF NOT EXISTS "sprint_item_outcomes_workItemId_idx"
    ON "sprint_item_outcomes"("workItemId");

CREATE INDEX IF NOT EXISTS "sprint_item_outcomes_doneAfterSprint_sprintId_idx"
    ON "sprint_item_outcomes"("doneAfterSprint", "sprintId");
