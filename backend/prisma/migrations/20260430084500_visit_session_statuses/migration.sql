CREATE TYPE "VisitSessionStatus" AS ENUM ('IN_GYM', 'LEFT', 'OVERDUE', 'FORCE_CLOSED');
CREATE TYPE "VisitCloseReason" AS ENUM ('NORMAL', 'LOST_KEY', 'FOUND_LATER', 'ADMIN_CORRECTION', 'AUTO_TIMEOUT', 'BLOCKED');

ALTER TABLE "VisitSession"
ADD COLUMN "status" "VisitSessionStatus" NOT NULL DEFAULT 'IN_GYM',
ADD COLUMN "closeReason" "VisitCloseReason";

UPDATE "VisitSession"
SET "status" = CASE WHEN "exitedAt" IS NULL THEN 'IN_GYM'::"VisitSessionStatus" ELSE 'LEFT'::"VisitSessionStatus" END;
