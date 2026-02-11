-- Add remaining work history fields
ALTER TABLE "work_items"
ADD COLUMN "initialRemainingWork" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN "lastRemainingWork" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN "doneRemainingWork" DOUBLE PRECISION DEFAULT 0;
