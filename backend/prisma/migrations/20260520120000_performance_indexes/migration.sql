-- Partial unique: one open visit per client and per locker (DB-level check-in safety).
CREATE UNIQUE INDEX "VisitSession_clientId_open_unique" ON "VisitSession" ("clientId") WHERE "exitedAt" IS NULL;
CREATE UNIQUE INDEX "VisitSession_lockerNumber_open_unique" ON "VisitSession" ("lockerNumber") WHERE "exitedAt" IS NULL;

-- Open-visit lookups (scanner, client list «в зале»).
CREATE INDEX "VisitSession_clientId_open_idx" ON "VisitSession" ("clientId") WHERE "exitedAt" IS NULL;

-- Client list / scanner
CREATE INDEX "Client_lastName_firstName_idx" ON "Client"("lastName", "firstName");
CREATE INDEX "Client_createdAt_idx" ON "Client"("createdAt");
CREATE INDEX "Client_membershipType_idx" ON "Client"("membershipType");
CREATE INDEX "Client_accessKey_idx" ON "Client"("accessKey");

-- Visit journal filters
CREATE INDEX "VisitSession_status_enteredAt_idx" ON "VisitSession"("status", "enteredAt");
CREATE INDEX "VisitSession_enteredAt_idx" ON "VisitSession"("enteredAt");
CREATE INDEX "VisitSession_clientId_status_idx" ON "VisitSession"("clientId", "status");

-- Payments registry & contract balance aggregates
CREATE INDEX "Payment_status_paidAt_idx" ON "Payment"("status", "paidAt");
CREATE INDEX "Payment_contractDocumentId_operationType_status_idx" ON "Payment"("contractDocumentId", "operationType", "status");

-- Contract cron & registry
CREATE INDEX "ContractDocument_serviceEndDate_idx" ON "ContractDocument"("serviceEndDate");
CREATE INDEX "ContractDocument_status_serviceEndDate_idx" ON "ContractDocument"("status", "serviceEndDate");

-- Freeze expiry cron
CREATE INDEX "ContractFreeze_endDate_idx" ON "ContractFreeze"("endDate");

-- Membership catalog & legacy membership alerts
CREATE INDEX "MembershipCatalog_isActive_name_idx" ON "MembershipCatalog"("isActive", "name");
CREATE INDEX "Membership_clientId_idx" ON "Membership"("clientId");
CREATE INDEX "Membership_status_endDate_idx" ON "Membership"("status", "endDate");

-- Users list
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- Refresh token cleanup
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");
