/*
  Warnings:

  - You are about to drop the column `lastSyncAt` on the `Project` table. All the data in the column will be lost.
  - You are about to drop the column `lastSyncAt` on the `Sprint` table. All the data in the column will be lost.
  - You are about to drop the column `lastSyncAt` on the `TeamMember` table. All the data in the column will be lost.
  - You are about to drop the column `lastSyncAt` on the `WorkItem` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "syncType" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "itemsCreated" INTEGER DEFAULT 0,
    "itemsUpdated" INTEGER DEFAULT 0,
    "itemsDeleted" INTEGER DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncLog_syncedAt_idx" ON "SyncLog"("syncedAt");
CREATE INDEX "SyncLog_syncType_idx" ON "SyncLog"("syncType");
