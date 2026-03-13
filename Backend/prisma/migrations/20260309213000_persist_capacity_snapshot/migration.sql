ALTER TABLE "team_capacities"
ADD COLUMN "completedHours" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "sprints"
ADD COLUMN "capacityDetails" JSONB;
