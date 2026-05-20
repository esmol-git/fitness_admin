-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('CASH', 'NON_CASH');

-- AlterTable: существующие платежи — наличные
ALTER TABLE "Payment" ADD COLUMN "channel" "PaymentChannel" NOT NULL DEFAULT 'CASH';
