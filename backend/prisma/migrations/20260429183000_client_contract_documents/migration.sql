CREATE TABLE "ContractDocument" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "contractNumber" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContractDocument_clientId_createdAt_idx" ON "ContractDocument"("clientId", "createdAt");

ALTER TABLE "ContractDocument"
ADD CONSTRAINT "ContractDocument_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Client"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
