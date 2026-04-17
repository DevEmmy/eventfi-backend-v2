-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PayoutAccount" (
    "id" UUID NOT NULL,
    "organizerId" UUID NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRequest" (
    "id" UUID NOT NULL,
    "organizerId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "eventId" UUID,
    "grossRevenue" DOUBLE PRECISION NOT NULL,
    "platformFee" DOUBLE PRECISION NOT NULL,
    "refundsTotal" DOUBLE PRECISION NOT NULL,
    "previousPayouts" DOUBLE PRECISION NOT NULL,
    "netAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" UUID,
    "reviewNote" TEXT,
    "rejectionReason" TEXT,
    "paymentReference" TEXT,
    "requestIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutAccount_organizerId_key" ON "PayoutAccount"("organizerId");

-- CreateIndex
CREATE INDEX "PayoutRequest_organizerId_status_idx" ON "PayoutRequest"("organizerId", "status");

-- CreateIndex
CREATE INDEX "PayoutRequest_eventId_idx" ON "PayoutRequest"("eventId");

-- CreateIndex
CREATE INDEX "PayoutRequest_status_createdAt_idx" ON "PayoutRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Attendee_email_idx" ON "Attendee"("email");

-- CreateIndex
CREATE INDEX "Attendee_orderId_idx" ON "Attendee"("orderId");

-- CreateIndex
CREATE INDEX "BookingOrder_userId_idx" ON "BookingOrder"("userId");

-- CreateIndex
CREATE INDEX "BookingOrder_eventId_status_idx" ON "BookingOrder"("eventId", "status");

-- CreateIndex
CREATE INDEX "ChatMessage_chatId_isDeleted_createdAt_idx" ON "ChatMessage"("chatId", "isDeleted", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_chatId_senderId_idx" ON "ChatMessage"("chatId", "senderId");

-- CreateIndex
CREATE INDEX "Event_startDate_idx" ON "Event"("startDate");

-- CreateIndex
CREATE INDEX "Event_organizerId_idx" ON "Event"("organizerId");

-- CreateIndex
CREATE INDEX "Event_organizerId_status_idx" ON "Event"("organizerId", "status");

-- CreateIndex
CREATE INDEX "Event_status_startDate_idx" ON "Event"("status", "startDate");

-- CreateIndex
CREATE INDEX "Event_category_status_idx" ON "Event"("category", "status");

-- CreateIndex
CREATE INDEX "Ticket_eventId_idx" ON "Ticket"("eventId");

-- AddForeignKey
ALTER TABLE "PayoutAccount" ADD CONSTRAINT "PayoutAccount_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PayoutAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
