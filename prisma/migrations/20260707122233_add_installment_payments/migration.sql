-- CreateEnum
CREATE TYPE "InstallmentPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DEFAULTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InstallmentPaymentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'INSTALLMENT_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'INSTALLMENT_OVERDUE';
ALTER TYPE "NotificationType" ADD VALUE 'INSTALLMENT_PAID';
ALTER TYPE "NotificationType" ADD VALUE 'INSTALLMENT_DEFAULTED';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "allowInstallments" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxInstallments" INTEGER;

-- CreateTable
CREATE TABLE "InstallmentPlan" (
    "id" UUID NOT NULL,
    "bookingOrderId" UUID NOT NULL,
    "installmentCount" INTEGER NOT NULL,
    "downPaymentAmount" DOUBLE PRECISION NOT NULL,
    "finalDueDate" TIMESTAMP(3) NOT NULL,
    "status" "InstallmentPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentPayment" (
    "id" UUID NOT NULL,
    "installmentPlanId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "InstallmentPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallmentPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPlan_bookingOrderId_key" ON "InstallmentPlan"("bookingOrderId");

-- CreateIndex
CREATE INDEX "InstallmentPlan_status_idx" ON "InstallmentPlan"("status");

-- CreateIndex
CREATE INDEX "InstallmentPayment_status_dueDate_idx" ON "InstallmentPayment"("status", "dueDate");

-- CreateIndex
CREATE INDEX "InstallmentPayment_paymentReference_idx" ON "InstallmentPayment"("paymentReference");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPayment_installmentPlanId_sequence_key" ON "InstallmentPayment"("installmentPlanId", "sequence");

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_bookingOrderId_fkey" FOREIGN KEY ("bookingOrderId") REFERENCES "BookingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPayment" ADD CONSTRAINT "InstallmentPayment_installmentPlanId_fkey" FOREIGN KEY ("installmentPlanId") REFERENCES "InstallmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
