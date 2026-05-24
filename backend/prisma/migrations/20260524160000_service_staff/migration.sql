-- CreateEnum
CREATE TYPE "ServiceStaffStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "ServiceStaff" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "position" TEXT,
    "phone" TEXT,
    "cardNumber" TEXT NOT NULL,
    "accessKey" TEXT,
    "status" "ServiceStaffStatus" NOT NULL DEFAULT 'ACTIVE',
    "photoUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceStaff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceStaffVisitSession" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),
    "status" "VisitSessionStatus" NOT NULL DEFAULT 'IN_GYM',
    "closeReason" "VisitCloseReason",
    "enteredById" TEXT,
    "exitedById" TEXT,
    "comment" TEXT,

    CONSTRAINT "ServiceStaffVisitSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceStaff_cardNumber_key" ON "ServiceStaff"("cardNumber");

-- CreateIndex
CREATE INDEX "ServiceStaff_lastName_firstName_idx" ON "ServiceStaff"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "ServiceStaff_status_idx" ON "ServiceStaff"("status");

-- CreateIndex
CREATE INDEX "ServiceStaff_accessKey_idx" ON "ServiceStaff"("accessKey");

-- CreateIndex
CREATE INDEX "ServiceStaffVisitSession_staffId_enteredAt_idx" ON "ServiceStaffVisitSession"("staffId", "enteredAt");

-- CreateIndex
CREATE INDEX "ServiceStaffVisitSession_exitedAt_idx" ON "ServiceStaffVisitSession"("exitedAt");

-- CreateIndex
CREATE INDEX "ServiceStaffVisitSession_status_enteredAt_idx" ON "ServiceStaffVisitSession"("status", "enteredAt");

-- CreateIndex
CREATE INDEX "ServiceStaffVisitSession_enteredAt_idx" ON "ServiceStaffVisitSession"("enteredAt");

-- CreateIndex
CREATE INDEX "ServiceStaffVisitSession_staffId_status_idx" ON "ServiceStaffVisitSession"("staffId", "status");

-- AddForeignKey
ALTER TABLE "ServiceStaffVisitSession" ADD CONSTRAINT "ServiceStaffVisitSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "ServiceStaff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceStaffVisitSession" ADD CONSTRAINT "ServiceStaffVisitSession_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceStaffVisitSession" ADD CONSTRAINT "ServiceStaffVisitSession_exitedById_fkey" FOREIGN KEY ("exitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
