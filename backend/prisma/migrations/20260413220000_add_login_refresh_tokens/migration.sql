-- Add login (nullable first), backfill from email, then enforce NOT NULL + unique.
ALTER TABLE "User" ADD COLUMN "login" TEXT;

UPDATE "User" SET "login" = lower(trim("email")) WHERE "login" IS NULL;

ALTER TABLE "User" ALTER COLUMN "login" SET NOT NULL;

CREATE UNIQUE INDEX "User_login_key" ON "User"("login");

ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

-- RefreshToken for opaque refresh sessions
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
