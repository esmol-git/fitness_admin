-- CreateEnum
CREATE TYPE "public"."ClientStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."Gender" AS ENUM ('MALE', 'FEMALE');

-- AlterTable
ALTER TABLE "public"."Client"
ADD COLUMN "accessKey" TEXT,
ADD COLUMN "address" TEXT,
ADD COLUMN "cardNumber" TEXT,
ADD COLUMN "contractEndDate" DATE,
ADD COLUMN "contractNumber" TEXT,
ADD COLUMN "contractStartDate" DATE,
ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "firstName" TEXT,
ADD COLUMN "gender" "public"."Gender",
ADD COLUMN "lastName" TEXT,
ADD COLUMN "managerId" TEXT,
ADD COLUMN "membershipType" TEXT,
ADD COLUMN "middleName" TEXT,
ADD COLUMN "passport" TEXT,
ADD COLUMN "paymentDate" DATE,
ADD COLUMN "status" "public"."ClientStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill required fields from existing `name`
UPDATE "public"."Client"
SET
  "firstName" = COALESCE(NULLIF(split_part("name", ' ', 2), ''), "name"),
  "lastName" = COALESCE(NULLIF(split_part("name", ' ', 1), ''), "name");

-- Fallback to stable placeholders if still null/empty
UPDATE "public"."Client"
SET
  "firstName" = COALESCE(NULLIF(TRIM("firstName"), ''), 'Client'),
  "lastName" = COALESCE(NULLIF(TRIM("lastName"), ''), 'Unknown');

-- Make required columns required
ALTER TABLE "public"."Client"
ALTER COLUMN "firstName" SET NOT NULL,
ALTER COLUMN "lastName" SET NOT NULL;

-- Old rows may have null phone; keep API contract predictable
UPDATE "public"."Client"
SET "phone" = COALESCE(NULLIF(TRIM("phone"), ''), 'N/A');

ALTER TABLE "public"."Client"
ALTER COLUMN "phone" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."Client"
ADD CONSTRAINT "Client_managerId_fkey"
FOREIGN KEY ("managerId") REFERENCES "public"."User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Add indexes
CREATE INDEX "Client_managerId_idx" ON "public"."Client"("managerId");
CREATE INDEX "Client_status_idx" ON "public"."Client"("status");
