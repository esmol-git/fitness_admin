CREATE TABLE "VisitSession" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "lockerNumber" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "enteredById" TEXT,
    "exitedById" TEXT,
    "comment" TEXT,

    CONSTRAINT "VisitSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VisitSession_clientId_enteredAt_idx" ON "VisitSession"("clientId", "enteredAt");
CREATE INDEX "VisitSession_exitedAt_idx" ON "VisitSession"("exitedAt");
CREATE INDEX "VisitSession_lockerNumber_exitedAt_idx" ON "VisitSession"("lockerNumber", "exitedAt");

ALTER TABLE "VisitSession"
ADD CONSTRAINT "VisitSession_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitSession"
ADD CONSTRAINT "VisitSession_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VisitSession"
ADD CONSTRAINT "VisitSession_exitedById_fkey" FOREIGN KEY ("exitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
