-- CreateEnum
CREATE TYPE "CommunityVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- AlterTable
ALTER TABLE "Community" ADD COLUMN "visibility" "CommunityVisibility" NOT NULL DEFAULT 'PUBLIC';
