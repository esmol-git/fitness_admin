-- Номер шкафчика клиента (бронь); сбрасывается при отсутствии действующего договора.
ALTER TABLE "Client" ADD COLUMN "lockerNumber" TEXT;

CREATE INDEX "Client_lockerNumber_idx" ON "Client"("lockerNumber");
