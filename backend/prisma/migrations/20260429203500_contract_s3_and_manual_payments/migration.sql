ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND';

ALTER TABLE "ContractDocument"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "contractDate" DATE,
ADD COLUMN "serviceStartDate" DATE,
ADD COLUMN "serviceEndDate" DATE,
ADD COLUMN "servicePrice" DECIMAL(12,2),
ADD COLUMN "s3Key" TEXT,
ADD COLUMN "s3Url" TEXT;

CREATE INDEX "ContractDocument_status_createdAt_idx" ON "ContractDocument"("status", "createdAt");

ALTER TABLE "Payment"
ADD COLUMN "clientId" TEXT,
ADD COLUMN "contractDocumentId" TEXT,
ADD COLUMN "comment" TEXT,
ADD COLUMN "processedById" TEXT;

CREATE INDEX "Payment_clientId_paidAt_idx" ON "Payment"("clientId", "paidAt");
CREATE INDEX "Payment_contractDocumentId_paidAt_idx" ON "Payment"("contractDocumentId", "paidAt");

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_contractDocumentId_fkey" FOREIGN KEY ("contractDocumentId") REFERENCES "ContractDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payment"
ADD CONSTRAINT "Payment_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
