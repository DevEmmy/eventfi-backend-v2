-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('LUCKY_DRAW', 'APPLAUSE_METER');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('IDLE', 'ACTIVE', 'ENDED');

-- CreateTable
CREATE TABLE "EventActivity" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "type" "ActivityType" NOT NULL,
    "status" "ActivityStatus" NOT NULL DEFAULT 'IDLE',
    "config" JSONB NOT NULL DEFAULT '{}',
    "results" JSONB,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEntry" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "response" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityEntry_activityId_idx" ON "ActivityEntry"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityEntry_activityId_userId_key" ON "ActivityEntry"("activityId", "userId");

-- AddForeignKey
ALTER TABLE "EventActivity" ADD CONSTRAINT "EventActivity_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEntry" ADD CONSTRAINT "ActivityEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "EventActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
