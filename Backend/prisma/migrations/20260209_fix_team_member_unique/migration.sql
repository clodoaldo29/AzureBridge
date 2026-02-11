-- Fix unique constraint for team_members (allow same azureId across projects)
DROP INDEX IF EXISTS "team_members_azureId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_azureId_projectId_key"
ON "team_members"("azureId", "projectId");
