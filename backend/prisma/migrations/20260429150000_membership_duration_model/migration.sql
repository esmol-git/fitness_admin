CREATE TYPE "MembershipDurationUnit" AS ENUM ('DAY', 'WEEK', 'MONTH', 'TRIAL');

ALTER TABLE "MembershipCatalog"
ADD COLUMN "durationValue" INTEGER,
ADD COLUMN "durationUnit" "MembershipDurationUnit";

UPDATE "MembershipCatalog"
SET "durationValue" = "durationDays",
    "durationUnit" = CASE
      WHEN "durationDays" IS NULL THEN NULL
      ELSE 'DAY'::"MembershipDurationUnit"
    END;

ALTER TABLE "MembershipCatalog" DROP COLUMN "durationDays";
