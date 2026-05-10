-- Create enums for payment operation metadata
CREATE TYPE "PaymentOperationType" AS ENUM ('SALE', 'REFUND');
CREATE TYPE "RefundMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER');

-- Extend Payment
ALTER TABLE "Payment"
ADD COLUMN "operationType" "PaymentOperationType" NOT NULL DEFAULT 'SALE',
ADD COLUMN "refundMethod" "RefundMethod";

-- Create ContractFreeze history
CREATE TABLE "ContractFreeze" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "durationDays" INTEGER NOT NULL,
  "reason" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractFreeze_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractFreeze_contractId_startDate_endDate_idx"
  ON "ContractFreeze"("contractId", "startDate", "endDate");

ALTER TABLE "ContractFreeze"
  ADD CONSTRAINT "ContractFreeze_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "ContractDocument"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContractFreeze"
  ADD CONSTRAINT "ContractFreeze_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
