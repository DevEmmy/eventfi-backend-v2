import { prisma } from '../config/database';
import redis from '../config/redis';
import { emailQueue } from '../jobs/email.queue';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum payout in the event's base currency (NGN). */
const MIN_PAYOUT_AMOUNT = 1_000;

/**
 * Hours after an event ends before a payout can be requested.
 * Gives time for chargebacks / refund disputes to surface.
 */
const PAYOUT_HOLDOFF_HOURS = 24;

/** Max payout requests per organizer in a 24-hour rolling window. */
const MAX_REQUESTS_PER_DAY = 3;

/** Statuses that "lock" revenue so it cannot be requested again. */
const ACTIVE_PAYOUT_STATUSES = ['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED'] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RegisterAccountInput {
    bankName: string;
    bankCode: string;
    accountNumber: string;
    accountName: string; // organizer-supplied; must be re-confirmed by caller via bank verification
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute the organizer's available payout balance for a given event (or all events).
 * Returns a breakdown so the response is transparent to the organizer.
 */
async function computeBalance(organizerId: string, eventId?: string) {
    const eventFilter = eventId ? { eventId } : { event: { organizerId } };

    // 1. Sum subtotals from confirmed, fully-paid orders
    const revenueAgg = await prisma.bookingOrder.aggregate({
        where: {
            ...eventFilter,
            status: 'CONFIRMED',
            paymentStatus: 'COMPLETED',
        },
        _sum: { subtotal: true },
    });
    const grossRevenue = revenueAgg._sum.subtotal ?? 0;

    // 2. Platform fees (service charges) already collected — stay with EventFi
    const feeAgg = await prisma.bookingOrder.aggregate({
        where: {
            ...eventFilter,
            status: 'CONFIRMED',
            paymentStatus: 'COMPLETED',
        },
        _sum: { serviceFee: true },
    });
    const platformFee = feeAgg._sum.serviceFee ?? 0;

    // 3. Total amount refunded to customers
    const refundAgg = await prisma.bookingOrder.aggregate({
        where: {
            ...eventFilter,
            status: 'REFUNDED',
        },
        _sum: { total: true },
    });
    const refundsTotal = refundAgg._sum.total ?? 0;

    // 4. Already-claimed or in-flight payouts (prevent double-claiming)
    const priorPayoutsAgg = await prisma.payoutRequest.aggregate({
        where: {
            organizerId,
            ...(eventId ? { eventId } : {}),
            status: { in: ACTIVE_PAYOUT_STATUSES as any },
        },
        _sum: { netAmount: true },
    });
    const previousPayouts = priorPayoutsAgg._sum.netAmount ?? 0;

    const netAmount = Math.max(0, grossRevenue - refundsTotal - previousPayouts);

    return { grossRevenue, platformFee, refundsTotal, previousPayouts, netAmount };
}

/**
 * Enforce a rolling 24-hour rate limit on payout requests (stored in Redis).
 * Throws if the organizer has exceeded MAX_REQUESTS_PER_DAY.
 */
async function checkRateLimit(organizerId: string): Promise<void> {
    const key = `payout_rl:${organizerId}`;
    try {
        const count = await redis.incr(key);
        if (count === 1) {
            // First request in the window — set 24h expiry
            await redis.expire(key, 24 * 60 * 60);
        }
        if (count > MAX_REQUESTS_PER_DAY) {
            throw new Error(
                `Payout request limit reached. You may submit up to ${MAX_REQUESTS_PER_DAY} requests per 24 hours.`
            );
        }
    } catch (e: any) {
        // If Redis is unavailable, fall through rather than blocking payouts
        if (e.message?.includes('limit reached')) throw e;
    }
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class PayoutService {
    // ─── Account management ───────────────────────────────────────────────────

    /**
     * Register or replace the organizer's payout bank account.
     * A pending/approved/processing payout blocks account changes to prevent
     * mid-flight payment redirection fraud.
     */
    static async registerAccount(organizerId: string, data: RegisterAccountInput) {
        // Block if a non-terminal payout is in flight
        const inflight = await prisma.payoutRequest.findFirst({
            where: {
                organizerId,
                status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] },
            },
        });
        if (inflight) {
            throw new Error(
                'Cannot update payout account while a payout request is pending or being processed.'
            );
        }

        const account = await prisma.payoutAccount.upsert({
            where: { organizerId },
            create: {
                organizerId,
                bankName: data.bankName,
                bankCode: data.bankCode,
                accountNumber: data.accountNumber,
                accountName: data.accountName,
                isVerified: false, // must go through verifyAccount() after saving
            },
            update: {
                bankName: data.bankName,
                bankCode: data.bankCode,
                accountNumber: data.accountNumber,
                accountName: data.accountName,
                isVerified: false, // reset verification on any change
                verifiedAt: null,
            },
        });

        return account;
    }

    /**
     * Mark the account as verified (called after a successful bank name-enquiry
     * from the frontend — typically using Paystack's Resolve Account API).
     * The caller is responsible for confirming the verifiedName matches what the
     * organizer provided; this method just records the outcome.
     */
    static async verifyAccount(organizerId: string, verifiedName: string) {
        const account = await prisma.payoutAccount.findUnique({ where: { organizerId } });
        if (!account) throw new Error('No payout account found. Register one first.');

        // Loose name match: both sides lowercased, extra spaces collapsed
        const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
        if (normalize(verifiedName) !== normalize(account.accountName)) {
            throw new Error(
                'Verified account name does not match the name you provided. ' +
                'Please register the account again with the correct account name.'
            );
        }

        return prisma.payoutAccount.update({
            where: { organizerId },
            data: { isVerified: true, verifiedAt: new Date() },
        });
    }

    /** Return the organizer's saved payout account (without exposing full account number). */
    static async getAccount(organizerId: string) {
        const account = await prisma.payoutAccount.findUnique({ where: { organizerId } });
        if (!account) return null;
        return {
            ...account,
            // Mask middle digits: "0123456789" → "01******89"
            accountNumber: account.accountNumber.replace(
                /^(.{2})(.+)(.{2})$/,
                (_: string, a: string, m: string, z: string) => a + '*'.repeat(m.length) + z
            ),
        };
    }

    // ─── Balance enquiry ──────────────────────────────────────────────────────

    /**
     * Returns the available payout balance for one event or all events.
     * Does NOT require a verified account — organizers can check their balance
     * before setting up a payout account.
     */
    static async getBalance(organizerId: string, eventId?: string) {
        if (eventId) {
            // Confirm organizer owns the event
            const event = await prisma.event.findUnique({
                where: { id: eventId },
                select: { organizerId: true, title: true, endDate: true, status: true },
            });
            if (!event) throw new Error('Event not found');
            if (event.organizerId !== organizerId) throw new Error('Unauthorized');
            return { event: { id: eventId, title: event.title }, ...(await computeBalance(organizerId, eventId)) };
        }
        return computeBalance(organizerId);
    }

    // ─── Request payout ───────────────────────────────────────────────────────

    /**
     * Submit a payout request. Runs every anti-fraud check before creating the record.
     */
    static async requestPayout(
        organizerId: string,
        eventId: string,
        requestIp?: string
    ) {
        // ── 1. Organizer must have a verified payout account ─────────────────
        const account = await prisma.payoutAccount.findUnique({ where: { organizerId } });
        if (!account) throw new Error('You need to add a payout account before requesting a payout.');
        if (!account.isVerified) {
            throw new Error(
                'Your payout account is not verified. Please complete bank verification first.'
            );
        }

        // ── 2. Event must exist and belong to this organizer ─────────────────
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            select: {
                organizerId: true,
                title: true,
                endDate: true,
                status: true,
                tickets: { select: { currency: true }, take: 1 },
            },
        });
        if (!event) throw new Error('Event not found');
        if (event.organizerId !== organizerId) throw new Error('Unauthorized');

        // ── 3. Event must have ended (holdoff period) ─────────────────────────
        const holdoffCutoff = new Date(Date.now() - PAYOUT_HOLDOFF_HOURS * 60 * 60 * 1000);
        const eventHasEnded = event.endDate <= holdoffCutoff || event.status === 'COMPLETED';
        if (!eventHasEnded) {
            const hoursLeft = Math.ceil(
                (event.endDate.getTime() + PAYOUT_HOLDOFF_HOURS * 3_600_000 - Date.now()) / 3_600_000
            );
            throw new Error(
                `Payouts for this event are available ${PAYOUT_HOLDOFF_HOURS} hours after it ends. ` +
                `Available in approximately ${hoursLeft} hour(s).`
            );
        }

        // ── 4. No other active payout for this event ──────────────────────────
        const existingPayout = await prisma.payoutRequest.findFirst({
            where: {
                organizerId,
                eventId,
                status: { in: ACTIVE_PAYOUT_STATUSES as any },
            },
        });
        if (existingPayout) {
            throw new Error(
                `A payout request for this event already exists (status: ${existingPayout.status.toLowerCase()}).`
            );
        }

        // ── 5. Compute balance and enforce minimum ────────────────────────────
        const balance = await computeBalance(organizerId, eventId);
        if (balance.netAmount < MIN_PAYOUT_AMOUNT) {
            throw new Error(
                `Minimum payout is ${MIN_PAYOUT_AMOUNT} NGN. ` +
                `Available balance is ${balance.netAmount.toFixed(2)} NGN.`
            );
        }

        // ── 6. Rate limit ─────────────────────────────────────────────────────
        await checkRateLimit(organizerId);

        // ── 7. Create the request ─────────────────────────────────────────────
        const payout = await prisma.payoutRequest.create({
            data: {
                organizerId,
                accountId: account.id,
                eventId,
                grossRevenue: balance.grossRevenue,
                platformFee: balance.platformFee,
                refundsTotal: balance.refundsTotal,
                previousPayouts: balance.previousPayouts,
                netAmount: balance.netAmount,
                currency: event.tickets[0]?.currency ?? 'NGN',
                requestIp: requestIp ?? null,
            },
            include: {
                event: { select: { title: true } },
                account: { select: { bankName: true, accountName: true } },
            },
        });

        // Notify organizer
        const organizer = await prisma.user.findUnique({
            where: { id: organizerId },
            select: { email: true, displayName: true },
        });
        if (organizer?.email) {
            emailQueue.add('payout-requested', {
                type: 'payout-requested',
                to: organizer.email,
                name: organizer.displayName || organizer.email.split('@')[0],
                eventTitle: event.title,
                netAmount: balance.netAmount,
                currency: event.tickets[0]?.currency ?? 'NGN',
            }).catch(() => {});
        }

        return payout;
    }

    /**
     * Cancel a PENDING payout request (organizer action only).
     * Once APPROVED or beyond, the organizer cannot cancel.
     */
    static async cancelPayout(payoutId: string, organizerId: string) {
        const payout = await prisma.payoutRequest.findUnique({ where: { id: payoutId } });
        if (!payout) throw new Error('Payout request not found');
        if (payout.organizerId !== organizerId) throw new Error('Unauthorized');
        if (payout.status !== 'PENDING') {
            throw new Error(
                `Cannot cancel a payout that is already ${payout.status.toLowerCase()}.`
            );
        }

        return prisma.payoutRequest.update({
            where: { id: payoutId },
            data: { status: 'CANCELLED' },
        });
    }

    /** List an organizer's own payout history. */
    static async getMyPayouts(organizerId: string, page = 1, limit = 10) {
        const skip = (page - 1) * limit;
        const [total, payouts] = await prisma.$transaction([
            prisma.payoutRequest.count({ where: { organizerId } }),
            prisma.payoutRequest.findMany({
                where: { organizerId },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    event: { select: { id: true, title: true, coverImage: true } },
                    account: { select: { bankName: true, accountName: true } },
                },
            }),
        ]);
        return {
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
            data: payouts,
        };
    }

    // ─── Admin actions ────────────────────────────────────────────────────────

    /** Admin: list all payout requests with optional status filter. */
    static async adminListPayouts(status?: string, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        const where: any = status ? { status } : {};
        const [total, payouts] = await prisma.$transaction([
            prisma.payoutRequest.count({ where }),
            prisma.payoutRequest.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    organizer: { select: { id: true, email: true, displayName: true } },
                    event: { select: { id: true, title: true } },
                    account: true,
                },
            }),
        ]);
        return {
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
            data: payouts,
        };
    }

    /**
     * Admin: approve a payout request.
     * Approving re-validates the balance to catch any refunds issued after the
     * original request — prevents paying out money that has since been refunded.
     */
    static async adminApprovePayout(payoutId: string, reviewerId: string, note?: string) {
        const payout = await prisma.payoutRequest.findUnique({
            where: { id: payoutId },
            include: { organizer: { select: { email: true, displayName: true } } },
        });
        if (!payout) throw new Error('Payout request not found');
        if (payout.status !== 'PENDING') {
            throw new Error(`Cannot approve a payout with status: ${payout.status}`);
        }

        // Re-validate balance at approval time (refunds may have come in since request)
        const currentBalance = await computeBalance(
            payout.organizerId,
            payout.eventId ?? undefined
        );

        // If available balance shrank below the requested amount, cap it
        const approvedAmount = Math.min(payout.netAmount, currentBalance.netAmount);
        if (approvedAmount <= 0) {
            throw new Error(
                'Available balance is now zero (likely due to refunds issued after the request). ' +
                'Reject this request instead.'
            );
        }

        const updated = await prisma.payoutRequest.update({
            where: { id: payoutId },
            data: {
                status: 'APPROVED',
                reviewerId,
                reviewNote: note ?? null,
                netAmount: approvedAmount, // may be lower than originally requested
                // refresh the financial snapshot
                grossRevenue: currentBalance.grossRevenue,
                refundsTotal: currentBalance.refundsTotal,
                previousPayouts: currentBalance.previousPayouts,
            },
        });

        // Notify organizer
        if (payout.organizer?.email) {
            emailQueue.add('payout-approved', {
                type: 'payout-approved',
                to: payout.organizer.email,
                name: payout.organizer.displayName ?? payout.organizer.email.split('@')[0],
                netAmount: approvedAmount,
                currency: payout.currency,
            }).catch(() => {});
        }

        return updated;
    }

    /** Admin: reject a payout request with a mandatory reason. */
    static async adminRejectPayout(payoutId: string, reviewerId: string, reason: string) {
        if (!reason?.trim()) throw new Error('A rejection reason is required.');

        const payout = await prisma.payoutRequest.findUnique({
            where: { id: payoutId },
            include: { organizer: { select: { email: true, displayName: true } } },
        });
        if (!payout) throw new Error('Payout request not found');
        if (!['PENDING', 'APPROVED'].includes(payout.status)) {
            throw new Error(`Cannot reject a payout with status: ${payout.status}`);
        }

        const updated = await prisma.payoutRequest.update({
            where: { id: payoutId },
            data: { status: 'REJECTED', reviewerId, rejectionReason: reason },
        });

        if (payout.organizer?.email) {
            emailQueue.add('payout-rejected', {
                type: 'payout-rejected',
                to: payout.organizer.email,
                name: payout.organizer.displayName ?? payout.organizer.email.split('@')[0],
                reason,
                currency: payout.currency,
            }).catch(() => {});
        }

        return updated;
    }

    /**
     * Admin: mark a payout as completed after the bank transfer is confirmed.
     * The payment reference (bank transaction ID) is required and recorded for
     * auditing purposes.
     */
    static async adminCompletePayout(
        payoutId: string,
        reviewerId: string,
        paymentReference: string
    ) {
        if (!paymentReference?.trim()) {
            throw new Error('A payment reference is required to mark a payout as completed.');
        }

        const payout = await prisma.payoutRequest.findUnique({
            where: { id: payoutId },
            include: { organizer: { select: { email: true, displayName: true } } },
        });
        if (!payout) throw new Error('Payout request not found');
        if (payout.status !== 'APPROVED' && payout.status !== 'PROCESSING') {
            throw new Error(`Cannot complete a payout with status: ${payout.status}`);
        }

        // Guard against duplicate completion with the same reference
        const duplicate = await prisma.payoutRequest.findFirst({
            where: { paymentReference, id: { not: payoutId } },
        });
        if (duplicate) {
            throw new Error(
                `Payment reference "${paymentReference}" is already used by another payout. ` +
                'Double-check the reference before completing.'
            );
        }

        const updated = await prisma.payoutRequest.update({
            where: { id: payoutId },
            data: {
                status: 'COMPLETED',
                paymentReference,
                reviewerId,
                completedAt: new Date(),
            },
        });

        if (payout.organizer?.email) {
            emailQueue.add('payout-completed', {
                type: 'payout-completed',
                to: payout.organizer.email,
                name: payout.organizer.displayName ?? payout.organizer.email.split('@')[0],
                netAmount: payout.netAmount,
                currency: payout.currency,
                paymentReference,
            }).catch(() => {});
        }

        return updated;
    }
}
