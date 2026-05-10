CREATE TABLE "MembershipCatalog" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MembershipCatalog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MembershipCatalog_name_key" ON "MembershipCatalog"("name");
