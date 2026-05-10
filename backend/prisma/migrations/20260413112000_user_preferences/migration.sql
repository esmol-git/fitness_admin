-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "preferredLocale" TEXT NOT NULL DEFAULT 'ru',
ADD COLUMN "preferredPreset" TEXT NOT NULL DEFAULT 'blue',
ADD COLUMN "preferredTheme" "ThemeMode" NOT NULL DEFAULT 'SYSTEM';
