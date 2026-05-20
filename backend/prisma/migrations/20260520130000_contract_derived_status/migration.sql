-- CreateEnum
CREATE TYPE "ContractDerivedStatus" AS ENUM ('SAVED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ContractDocument" ADD COLUMN "derivedStatus" "ContractDerivedStatus" NOT NULL DEFAULT 'SAVED';

-- Indexes for registry filters and blocking-membership checks
CREATE INDEX "ContractDocument_derivedStatus_createdAt_idx" ON "ContractDocument"("derivedStatus", "createdAt");
CREATE INDEX "ContractDocument_clientId_derivedStatus_idx" ON "ContractDocument"("clientId", "derivedStatus");

-- Backfill from raw status (cron / POST sync-statuses refines date-based rules)
UPDATE "ContractDocument" SET "derivedStatus" = 'CANCELLED' WHERE status = 'CANCELLED';
UPDATE "ContractDocument" SET "derivedStatus" = 'PAUSED' WHERE status = 'PAUSED';
UPDATE "ContractDocument" SET "derivedStatus" = 'EXPIRED' WHERE status = 'EXPIRED';
UPDATE "ContractDocument" SET "derivedStatus" = 'SAVED' WHERE status IN ('DRAFT', 'SAVED');
UPDATE "ContractDocument" SET "derivedStatus" = 'ACTIVE' WHERE status IN ('ACTIVE', 'SIGNED') AND "derivedStatus" = 'SAVED';
