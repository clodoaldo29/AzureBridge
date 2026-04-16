-- CreateTable
CREATE TABLE IF NOT EXISTS "users" (
    "id" TEXT NOT NULL,
    "azureId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "user_preferences"
ADD COLUMN IF NOT EXISTS "ownerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_azureId_key" ON "users"("azureId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_azureId_idx" ON "users"("azureId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "user_preferences_ownerId_key" ON "user_preferences"("ownerId");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'user_preferences_ownerId_fkey'
    ) THEN
        ALTER TABLE "user_preferences"
        ADD CONSTRAINT "user_preferences_ownerId_fkey"
        FOREIGN KEY ("ownerId") REFERENCES "users"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;
    END IF;
END $$;
