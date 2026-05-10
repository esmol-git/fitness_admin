UPDATE "Payment"
SET "status" = 'REFUNDED'
WHERE "status" = 'REFUND';

ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";

CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

ALTER TABLE "Payment"
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "PaymentStatus"
USING ("status"::text::"PaymentStatus"),
ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP TYPE "PaymentStatus_old";
