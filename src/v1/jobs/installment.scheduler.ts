import cron from 'node-cron';
import { prisma } from '../config/database';
import { NotificationService } from '../services/notification.service';
import { BookingService } from '../services/booking.service';
import { emailQueue } from './email.queue';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_WINDOW_DAYS = 3; // send a reminder when a due date is within this many days
const GRACE_DAYS = 4; // must match INSTALLMENT_GRACE_DAYS in booking.service.ts

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://eventfi.live';

async function getRecipient(orderId: string, userId: string): Promise<{ name?: string | null; email: string } | null> {
    const primaryAttendee = await prisma.attendee.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
        select: { name: true, email: true },
    });
    if (primaryAttendee?.email) return primaryAttendee;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { displayName: true, email: true } });
    return user ? { name: user.displayName, email: user.email } : null;
}

async function alreadyNotified(installmentPaymentId: string, type: 'INSTALLMENT_DUE' | 'INSTALLMENT_OVERDUE'): Promise<boolean> {
    const existing = await prisma.notification.findFirst({
        where: {
            type,
            metadata: { path: ['installmentPaymentId'], equals: installmentPaymentId },
        },
        select: { id: true },
    });
    return !!existing;
}

/**
 * Send a reminder for installments due within REMINDER_WINDOW_DAYS (one-shot per installment).
 */
async function sendUpcomingReminders() {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_WINDOW_DAYS * ONE_DAY_MS);

    const due = await prisma.installmentPayment.findMany({
        where: {
            status: 'PENDING',
            dueDate: { gte: now, lte: windowEnd },
            installmentPlan: { status: 'ACTIVE' },
        },
        include: {
            installmentPlan: {
                include: { bookingOrder: { include: { event: { select: { title: true } } } } },
            },
        },
    });

    let sent = 0;
    for (const installment of due) {
        if (await alreadyNotified(installment.id, 'INSTALLMENT_DUE')) continue;

        const order = installment.installmentPlan.bookingOrder;
        const recipient = await getRecipient(order.id, order.userId);

        const dueDateStr = installment.dueDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        const payUrl = `${FRONTEND_URL}/profile?tab=payments&orderId=${order.id}`;

        await NotificationService.create({
            userId: order.userId,
            type: 'INSTALLMENT_DUE',
            title: 'Installment payment due soon',
            message: `Installment ${installment.sequence}/${installment.installmentPlan.installmentCount} for "${order.event.title}" (${order.currency} ${installment.amount.toLocaleString()}) is due ${dueDateStr}.`,
            actionUrl: `/profile?tab=payments`,
            metadata: { eventId: order.eventId, orderId: order.id, installmentPaymentId: installment.id },
        }).catch(() => {});

        if (recipient?.email) {
            emailQueue.add('installment-reminder', {
                type: 'installment-reminder',
                to: recipient.email,
                eventTitle: order.event.title,
                sequence: installment.sequence,
                installmentCount: installment.installmentPlan.installmentCount,
                amount: installment.amount,
                currency: order.currency,
                dueDate: dueDateStr,
                payUrl,
                name: recipient.name,
            }).catch((err: unknown) => console.error('[InstallmentScheduler] Failed to queue reminder email:', err));
        }

        sent++;
    }

    if (sent > 0) console.log(`[InstallmentScheduler] Sent ${sent} upcoming installment reminder(s)`);
}

/**
 * Flip PENDING installments past their due date to OVERDUE and notify (one-shot per installment).
 */
async function flagOverdue() {
    const now = new Date();

    const overdue = await prisma.installmentPayment.findMany({
        where: {
            status: 'PENDING',
            dueDate: { lt: now },
            installmentPlan: { status: 'ACTIVE' },
        },
        include: {
            installmentPlan: {
                include: { bookingOrder: { include: { event: { select: { title: true } } } } },
            },
        },
    });

    for (const installment of overdue) {
        await prisma.installmentPayment.update({
            where: { id: installment.id },
            data: { status: 'OVERDUE' },
        });

        const order = installment.installmentPlan.bookingOrder;
        const recipient = await getRecipient(order.id, order.userId);
        const payUrl = `${FRONTEND_URL}/profile?tab=payments&orderId=${order.id}`;

        NotificationService.create({
            userId: order.userId,
            type: 'INSTALLMENT_OVERDUE',
            title: 'Installment payment overdue',
            message: `Installment ${installment.sequence}/${installment.installmentPlan.installmentCount} for "${order.event.title}" is overdue. Pay within ${GRACE_DAYS} days to keep your tickets.`,
            actionUrl: `/profile?tab=payments`,
            metadata: { eventId: order.eventId, orderId: order.id, installmentPaymentId: installment.id },
        }).catch(() => {});

        if (recipient?.email) {
            emailQueue.add('installment-overdue', {
                type: 'installment-overdue',
                to: recipient.email,
                eventTitle: order.event.title,
                sequence: installment.sequence,
                installmentCount: installment.installmentPlan.installmentCount,
                amount: installment.amount,
                currency: order.currency,
                graceDays: GRACE_DAYS,
                payUrl,
                name: recipient.name,
            }).catch((err: unknown) => console.error('[InstallmentScheduler] Failed to queue overdue email:', err));
        }
    }

    if (overdue.length > 0) console.log(`[InstallmentScheduler] Flagged ${overdue.length} installment(s) overdue`);
}

/**
 * Default plans whose overdue installment has exceeded the grace period —
 * releases ticket inventory and cancels the order (no partial refund).
 */
async function sweepDefaults() {
    const cutoff = new Date(Date.now() - GRACE_DAYS * ONE_DAY_MS);

    const expired = await prisma.installmentPayment.findMany({
        where: {
            status: 'OVERDUE',
            dueDate: { lt: cutoff },
            installmentPlan: { status: 'ACTIVE' },
        },
        distinct: ['installmentPlanId'],
        select: { installmentPlanId: true, installmentPlan: { select: { bookingOrderId: true } } },
    });

    for (const item of expired) {
        await BookingService.defaultInstallmentPlan(item.installmentPlan.bookingOrderId);
    }

    if (expired.length > 0) console.log(`[InstallmentScheduler] Defaulted ${expired.length} installment plan(s)`);
}

/**
 * Start all installment payment cron jobs.
 * Call this once from index.ts after the server starts.
 */
export function startInstallmentScheduler() {
    // Due dates are day-granularity — every 6 hours is frequent enough for all three sweeps
    cron.schedule('0 */6 * * *', async () => {
        try {
            await sendUpcomingReminders();
        } catch (err) {
            console.error('[InstallmentScheduler] Reminder job error:', err);
        }
    });

    cron.schedule('0 */6 * * *', async () => {
        try {
            await flagOverdue();
        } catch (err) {
            console.error('[InstallmentScheduler] Overdue job error:', err);
        }
    });

    cron.schedule('0 */6 * * *', async () => {
        try {
            await sweepDefaults();
        } catch (err) {
            console.error('[InstallmentScheduler] Default sweep job error:', err);
        }
    });

    console.log('⏰ Installment payment scheduler started (reminders/overdue/defaults: every 6h)');
}
