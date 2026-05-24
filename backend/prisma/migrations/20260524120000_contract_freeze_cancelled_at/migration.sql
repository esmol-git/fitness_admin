-- Early resume: mark freeze episode closed without deleting history.
ALTER TABLE "ContractFreeze" ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE INDEX "ContractFreeze_contractId_cancelledAt_idx"
  ON "ContractFreeze"("contractId", "cancelledAt");
