import { prisma } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { ChatService } from './chat.service';
import { PaymentService, CustomerObject } from './payment.service';
import { NotificationService } from './notification.service';
import { emailQueue } from '../jobs/email.queue';

const SERVICE_FEE_PERCENT = 0.04; // 4% platform fee
const SERVICE_FEE_FLAT = 200;    // ₦200 flat fee (covers Paystack's transaction charge)
const ORDER_EXPIRY_MINUTES = 30;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MIN_DOWN_PAYMENT_PERCENT = 0.2;
const DEFAULT_DOWN_PAYMENT_PERCENT = 0.3;
const MAX_DOWN_PAYMENT_PERCENT = 0.8;
const INSTALLMENT_INTERVAL_DAYS = 14; // default biweekly spacing between installments
const INSTALLMENT_CUTOFF_DAYS = 3; // final installment must clear at least this many days before the event
const MIN_LEAD_DAYS_FOR_INSTALLMENTS = 7; // event must be at least this far out to offer a plan
const INSTALLMENT_GRACE_DAYS = 4; // grace period after a due date before the plan is defaulted

/**
 * Resolve a userId for the booking.
 * - If the user is logged in, use their id.
 * - If guest: find an existing user by email, or create a minimal guest account.
 *   Guest accounts have no password and can be claimed later via a password-reset flow.
 */
async function resolveUserId(loggedInUserId: string | undefined, guestEmail: string): Promise<string> {
    if (loggedInUserId) return loggedInUserId;

    const email = guestEmail.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return existing.id;

    // Auto-create a guest account — username derived from email prefix + random suffix
    const base = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase().substring(0, 16);
    const suffix = Math.random().toString(36).substring(2, 7);
    const username = `${base}_${suffix}`;

    // passwordHash is intentionally empty — account is locked until user sets a password
    const guest = await prisma.user.create({
        data: {
            email,
            username,
            displayName: email.split('@')[0],
            passwordHash: '',
        },
        select: { id: true },
    });
    return guest.id;
}

interface OrderItemInput {
    ticketTypeId: string;
    quantity: number;
}

interface AttendeeInput {
    ticketTypeId: string;
    name: string;
    email: string;
    phone?: string;
    city?: string;
    location?: string;
}

interface InstallmentPlanInput {
    installmentCount: number;
    downPaymentPercent?: number;
}

export class BookingService {
    /**
     * Get available ticket types for an event
     */
    static async getEventTickets(eventId: string) {
        const tickets = await prisma.ticket.findMany({
            where: { eventId },
            select: {
                id: true,
                name: true,
                description: true,
                type: true,
                price: true,
                currency: true,
                quantity: true,
                remaining: true,
                maxPerUser: true,
                salesStart: true,
                salesEnd: true,
                allowInstallments: true,
                maxInstallments: true,
            },
            orderBy: { price: 'asc' }
        });

        return tickets.map(t => ({
            ...t,
            sold: t.quantity - t.remaining,
            maxPerOrder: t.maxPerUser || 10,
            salesStartDate: t.salesStart?.toISOString(),
            salesEndDate: t.salesEnd?.toISOString(),
        }));
    }

    /**
     * Check ticket availability
     */
    static async checkAvailability(eventId: string) {
        const tickets = await prisma.ticket.findMany({
            where: { eventId },
            select: {
                id: true,
                name: true,
                remaining: true,
                quantity: true,
            }
        });

        return tickets.map(t => ({
            ticketTypeId: t.id,
            name: t.name,
            available: t.remaining,
            total: t.quantity,
        }));
    }

    /**
     * Initiate a booking order
     */
    static async initiateOrder(userId: string | undefined, eventId: string, items: OrderItemInput[], guestEmail?: string, installmentPlan?: InstallmentPlanInput) {
        if (!userId && !guestEmail) throw new Error('Sign in or provide your email to book');
        const resolvedUserId = await resolveUserId(userId, guestEmail!);
        // Validate event exists
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            select: { id: true, title: true, coverImage: true, startDate: true, venueName: true, city: true }
        });
        if (!event) throw new Error('Event not found');

        // Validate tickets and calculate totals
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        for (const item of items) {
            if (!item.ticketTypeId || !uuidRegex.test(item.ticketTypeId)) {
                throw new Error(`Invalid ticketTypeId: ${item.ticketTypeId}`);
            }
        }

        // Batch-fetch all requested tickets in one query
        const ticketTypeIds = items.map(i => i.ticketTypeId);
        const fetchedTickets = await prisma.ticket.findMany({ where: { id: { in: ticketTypeIds } } });
        const ticketMap = new Map(fetchedTickets.map(t => [t.id, t]));

        let subtotal = 0;
        const orderItems: any[] = [];

        for (const item of items) {
            const ticket = ticketMap.get(item.ticketTypeId);

            if (!ticket) throw new Error(`Ticket type ${item.ticketTypeId} not found`);
            if (ticket.eventId !== eventId) throw new Error('Ticket does not belong to this event');
            if (ticket.remaining < item.quantity) throw new Error(`Not enough tickets available for ${ticket.name}`);
            if (ticket.maxPerUser && item.quantity > ticket.maxPerUser) {
                throw new Error(`Maximum ${ticket.maxPerUser} tickets per order for ${ticket.name}`);
            }

            const totalPrice = ticket.price * item.quantity;
            subtotal += totalPrice;

            orderItems.push({
                ticketId: ticket.id,
                ticketName: ticket.name,
                quantity: item.quantity,
                unitPrice: ticket.price,
                totalPrice,
            });
        }

        const serviceFee = subtotal > 0 ? Math.round(subtotal * SERVICE_FEE_PERCENT) + SERVICE_FEE_FLAT : 0;
        const total = subtotal + serviceFee;
        // Currency comes from the already-fetched ticket map — no extra DB round-trip
        const currency = ticketMap.get(items[0].ticketTypeId)?.currency || 'NGN';

        // Validate + compute the installment schedule up front (before any writes) so a
        // rejected plan never leaves behind a reserved order or decremented inventory.
        let installmentSchedule: ReturnType<typeof BookingService.computeInstallmentSchedule> | undefined;
        if (installmentPlan) {
            for (const item of items) {
                const ticket = ticketMap.get(item.ticketTypeId)!;
                if (!ticket.allowInstallments) {
                    throw new Error(`"${ticket.name}" does not support installment payments`);
                }
            }
            const caps = items
                .map(item => ticketMap.get(item.ticketTypeId)!.maxInstallments)
                .filter((n): n is number => !!n);
            const maxAllowed = caps.length > 0 ? Math.min(...caps) : 12;
            if (installmentPlan.installmentCount < 2 || installmentPlan.installmentCount > maxAllowed) {
                throw new Error(`Installment count must be between 2 and ${maxAllowed} for the selected tickets`);
            }
            installmentSchedule = this.computeInstallmentSchedule(
                total,
                event.startDate,
                installmentPlan.installmentCount,
                installmentPlan.downPaymentPercent
            );
        }

        // Create the order
        const expiresAt = new Date(Date.now() + ORDER_EXPIRY_MINUTES * 60 * 1000);

        const order = await prisma.bookingOrder.create({
            data: {
                userId: resolvedUserId,
                eventId,
                subtotal,
                serviceFee,
                total,
                currency,
                expiresAt,
                items: {
                    create: orderItems
                }
            },
            include: {
                items: true,
                event: {
                    select: { id: true, title: true, coverImage: true, startDate: true, venueName: true, city: true }
                }
            }
        });

        // Reserve tickets atomically in a single transaction (parallel updates)
        await prisma.$transaction(
            items.map(item =>
                prisma.ticket.update({
                    where: { id: item.ticketTypeId },
                    data: { remaining: { decrement: item.quantity } },
                })
            )
        );

        if (installmentSchedule) {
            await prisma.installmentPlan.create({
                data: {
                    bookingOrderId: order.id,
                    installmentCount: installmentSchedule.payments.length,
                    downPaymentAmount: installmentSchedule.downPaymentAmount,
                    finalDueDate: installmentSchedule.finalDueDate,
                    payments: { create: installmentSchedule.payments },
                },
            });
        }

        return this.getOrder(order.id, userId);
    }

    /**
     * Compute a down-payment + evenly-spaced installment schedule for an order total.
     * The final installment is always clamped to (event start - INSTALLMENT_CUTOFF_DAYS)
     * so a fully-paid plan always finishes before the event, since tickets are only
     * issued once the plan completes.
     */
    private static computeInstallmentSchedule(
        total: number,
        eventStartDate: Date,
        installmentCount: number,
        downPaymentPercent?: number
    ): { downPaymentAmount: number; finalDueDate: Date; payments: { sequence: number; amount: number; dueDate: Date }[] } {
        const now = new Date();

        if (eventStartDate.getTime() - now.getTime() < MIN_LEAD_DAYS_FOR_INSTALLMENTS * ONE_DAY_MS) {
            throw new Error(`This event starts too soon to offer an installment plan (needs at least ${MIN_LEAD_DAYS_FOR_INSTALLMENTS} days' notice)`);
        }

        const finalDueDate = new Date(eventStartDate.getTime() - INSTALLMENT_CUTOFF_DAYS * ONE_DAY_MS);
        if (finalDueDate.getTime() <= now.getTime()) {
            throw new Error('Not enough time before the event to complete an installment plan');
        }

        const downPercent = Math.min(
            MAX_DOWN_PAYMENT_PERCENT,
            Math.max(MIN_DOWN_PAYMENT_PERCENT, downPaymentPercent ?? DEFAULT_DOWN_PAYMENT_PERCENT)
        );
        const downPaymentAmount = Math.round(total * downPercent);
        const remaining = total - downPaymentAmount;
        const remainingCount = installmentCount - 1;
        const baseShare = Math.floor(remaining / remainingCount);

        const tentativeSpanMs = INSTALLMENT_INTERVAL_DAYS * ONE_DAY_MS * remainingCount;
        const availableSpanMs = finalDueDate.getTime() - now.getTime();
        const spanMs = Math.min(tentativeSpanMs, availableSpanMs);

        const payments: { sequence: number; amount: number; dueDate: Date }[] = [
            { sequence: 1, amount: downPaymentAmount, dueDate: now },
        ];

        let allocated = 0;
        for (let i = 1; i <= remainingCount; i++) {
            const isLast = i === remainingCount;
            const amount = isLast ? remaining - allocated : baseShare;
            allocated += amount;
            const dueDate = isLast ? finalDueDate : new Date(now.getTime() + Math.round((spanMs / remainingCount) * i));
            payments.push({ sequence: i + 1, amount, dueDate });
        }

        return { downPaymentAmount, finalDueDate, payments };
    }

    /**
     * Get order details
     */
    static async getOrder(orderId: string, userId?: string) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: {
                items: true,
                attendees: true,
                event: {
                    select: { id: true, title: true, coverImage: true, startDate: true, venueName: true, city: true }
                },
                installmentPlan: {
                    include: { payments: { orderBy: { sequence: 'asc' } } }
                }
            }
        });

        if (!order) throw new Error('Order not found');
        // Only enforce ownership check when a logged-in userId is provided
        if (userId && order.userId !== userId) throw new Error('Unauthorized');

        return this.formatOrder(order);
    }

    /**
     * Update attendee information
     */
    static async updateAttendees(orderId: string, userId: string | undefined, attendees: AttendeeInput[]) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: { items: true }
        });

        if (!order) throw new Error('Order not found');
        if (userId && order.userId !== userId) throw new Error('Unauthorized');
        if (order.status !== 'PENDING') throw new Error('Cannot update attendees for this order');

        // Delete existing attendees and create new ones
        await prisma.attendee.deleteMany({ where: { orderId } });

        const attendeeRecords = attendees.map(a => ({
            orderId,
            ticketId: a.ticketTypeId,
            name: a.name,
            email: a.email,
            phone: a.phone,
            city: a.city || null,
            location: a.location || null,
            ticketCode: `EVF-TKT-${uuidv4().substring(0, 8).toUpperCase()}`,
        }));

        await prisma.attendee.createMany({ data: attendeeRecords });

        return this.getOrder(orderId, userId);
    }

    /**
     * Apply promo code
     */
    static async applyPromoCode(orderId: string, userId: string | undefined, promoCode: string) {
        const order = await prisma.bookingOrder.findUnique({ where: { id: orderId } });

        if (!order) throw new Error('Order not found');
        if (userId && order.userId !== userId) throw new Error('Unauthorized');
        if (order.status !== 'PENDING') throw new Error('Cannot apply promo to this order');

        // TODO: Implement promo code validation
        // For now, just store the code
        await prisma.bookingOrder.update({
            where: { id: orderId },
            data: { promoCode }
        });

        return this.getOrder(orderId, userId);
    }

    /**
     * Cancel pending order
     */
    static async cancelOrder(orderId: string, userId: string | undefined) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: { items: true, installmentPlan: true }
        });

        if (!order) throw new Error('Order not found');
        if (userId && order.userId !== userId) throw new Error('Unauthorized');
        if (order.status !== 'PENDING') throw new Error('Cannot cancel this order');

        // Release tickets atomically in a single transaction (parallel updates)
        await prisma.$transaction(
            order.items.map(item =>
                prisma.ticket.update({
                    where: { id: item.ticketId },
                    data: { remaining: { increment: item.quantity } },
                })
            )
        );

        await prisma.bookingOrder.update({
            where: { id: orderId },
            data: { status: 'CANCELLED' }
        });

        if (order.installmentPlan && order.installmentPlan.status === 'ACTIVE') {
            await prisma.installmentPlan.update({
                where: { id: order.installmentPlan.id },
                data: { status: 'CANCELLED' }
            });
        }

        return { message: 'Order cancelled successfully' };
    }

    /**
     * Default an installment plan after its grace period has expired: release
     * reserved ticket inventory, cancel the order, and mark the plan DEFAULTED.
     * Called by the installment scheduler — not attendee-facing.
     */
    static async defaultInstallmentPlan(orderId: string) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: { items: true, installmentPlan: true, event: { select: { title: true, organizerId: true } } }
        });

        if (!order || !order.installmentPlan) return;
        if (order.status !== 'PENDING' || order.installmentPlan.status !== 'ACTIVE') return;

        await prisma.$transaction(
            order.items.map(item =>
                prisma.ticket.update({
                    where: { id: item.ticketId },
                    data: { remaining: { increment: item.quantity } },
                })
            )
        );

        await prisma.bookingOrder.update({
            where: { id: orderId },
            data: { status: 'CANCELLED' }
        });

        await prisma.installmentPlan.update({
            where: { id: order.installmentPlan.id },
            data: { status: 'DEFAULTED' }
        });

        NotificationService.create({
            userId: order.userId,
            type: 'INSTALLMENT_DEFAULTED',
            title: 'Installment plan cancelled',
            message: `Your installment plan for "${order.event.title}" was cancelled after a missed payment. Your tickets have been released.`,
            actionUrl: `/profile?tab=payments`,
            metadata: { eventId: order.eventId, orderId: order.id },
        }).catch(() => {});

        NotificationService.create({
            userId: order.event.organizerId,
            type: 'INSTALLMENT_DEFAULTED',
            title: 'Installment plan defaulted',
            message: `An attendee's installment plan for "${order.event.title}" was cancelled after a missed payment.`,
            actionUrl: `/events/${order.eventId}/manage`,
            metadata: { eventId: order.eventId, orderId: order.id },
        }).catch(() => {});

        const primaryAttendee = await prisma.attendee.findFirst({
            where: { orderId: order.id },
            orderBy: { createdAt: 'asc' },
            select: { email: true }
        });
        const buyer = await prisma.user.findUnique({ where: { id: order.userId }, select: { email: true } });
        const recipientEmail = primaryAttendee?.email ?? buyer?.email;
        if (recipientEmail) {
            emailQueue.add('installment-defaulted', {
                type: 'installment-defaulted',
                to: recipientEmail,
                eventTitle: order.event.title,
            }).catch(err => console.error('Failed to queue installment-defaulted email:', err));
        }
    }

    /**
     * Get an order's installment schedule
     */
    static async getInstallments(orderId: string, userId: string | undefined) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: { installmentPlan: { include: { payments: { orderBy: { sequence: 'asc' } } } } }
        });

        if (!order) throw new Error('Order not found');
        if (userId && order.userId !== userId) throw new Error('Unauthorized');
        if (!order.installmentPlan) throw new Error('This order has no installment plan');

        return {
            id: order.installmentPlan.id,
            installmentCount: order.installmentPlan.installmentCount,
            downPaymentAmount: order.installmentPlan.downPaymentAmount,
            finalDueDate: order.installmentPlan.finalDueDate.toISOString(),
            status: order.installmentPlan.status.toLowerCase(),
            payments: order.installmentPlan.payments.map(p => ({
                id: p.id,
                sequence: p.sequence,
                amount: p.amount,
                dueDate: p.dueDate.toISOString(),
                status: p.status.toLowerCase(),
                paymentReference: p.paymentReference,
                paidAt: p.paidAt?.toISOString(),
            })),
        };
    }

    /**
     * Initialize payment for a single installment via Paystack.
     */
    static async initializeInstallmentPayment(
        orderId: string,
        installmentPaymentId: string,
        userId: string | undefined,
        callbackUrl: string
    ) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: { event: { select: { title: true } }, installmentPlan: true }
        });

        if (!order) throw new Error('Order not found');
        if (userId && order.userId !== userId) throw new Error('Unauthorized');
        if (order.status !== 'PENDING') throw new Error('Cannot pay for this order');
        if (!order.installmentPlan) throw new Error('This order has no installment plan');
        if (order.installmentPlan.status !== 'ACTIVE') throw new Error('This installment plan is no longer active');

        const installment = await prisma.installmentPayment.findUnique({ where: { id: installmentPaymentId } });
        if (!installment || installment.installmentPlanId !== order.installmentPlan.id) {
            throw new Error('Installment not found');
        }
        if (installment.status === 'PAID') throw new Error('This installment has already been paid');

        const eventTitle = (order as any).event?.title ?? 'Event Ticket';

        const primaryAttendee = await prisma.attendee.findFirst({
            where: { orderId },
            orderBy: { createdAt: 'asc' },
            select: { name: true, email: true, phone: true }
        });
        const user = await prisma.user.findUnique({
            where: { id: order.userId },
            select: { email: true, displayName: true }
        });
        const customer: CustomerObject = {
            email: primaryAttendee?.email ?? user?.email ?? '',
            name: primaryAttendee?.name ?? user?.displayName ?? undefined,
            phone: primaryAttendee?.phone ?? undefined,
        };

        const payment = await PaymentService.initializeTransaction(
            installment.amount,
            order.currency,
            `${eventTitle} — Installment ${installment.sequence}/${order.installmentPlan.installmentCount} — Order #${orderId.substring(0, 8).toUpperCase()}`,
            customer,
            { orderId, installmentPaymentId, eventTitle },
            callbackUrl
        );

        await prisma.installmentPayment.update({
            where: { id: installmentPaymentId },
            data: { paymentReference: payment.reference, status: 'PENDING' }
        });

        return {
            paymentUrl: payment.paymentUrl,
            reference: payment.reference,
            sequence: installment.sequence,
            amount: installment.amount,
        };
    }

    /**
     * Initialize payment via Paystack (for paid tickets)
     */
    static async initializePayment(orderId: string, userId: string | undefined, paymentMethod: string, callbackUrl: string) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: { event: { select: { title: true } } }
        });

        if (!order) throw new Error('Order not found');
        if (userId && order.userId !== userId) throw new Error('Unauthorized');
        if (order.status !== 'PENDING') throw new Error('Cannot pay for this order');
        if (order.total === 0) throw new Error('Use confirm endpoint for free tickets');

        const eventTitle = (order as any).event?.title ?? 'Event Ticket';

        // Build customer object from primary attendee (or fall back to the user's account email)
        const primaryAttendee = await prisma.attendee.findFirst({
            where: { orderId },
            orderBy: { createdAt: 'asc' },
            select: { name: true, email: true, phone: true }
        });
        const user = await prisma.user.findUnique({
            where: { id: order.userId },
            select: { email: true, displayName: true }
        });
        const customer: CustomerObject = {
            email: primaryAttendee?.email ?? user?.email ?? '',
            name: primaryAttendee?.name ?? user?.displayName ?? undefined,
            phone: primaryAttendee?.phone ?? undefined,
        };

        // Create Paystack payment
        const payment = await PaymentService.initializeTransaction(
            order.total,
            order.currency,
            `${eventTitle} — Order #${orderId.substring(0, 8).toUpperCase()}`,
            customer,
            { orderId, eventTitle },
            callbackUrl
        );

        // Store the Paystack reference
        await prisma.bookingOrder.update({
            where: { id: orderId },
            data: {
                paymentMethod,
                paymentReference: payment.reference,
                paymentStatus: 'PROCESSING'
            }
        });

        return {
            paymentUrl: payment.paymentUrl,
            reference: payment.reference,
            expiresAt: order.expiresAt?.toISOString(),
        };
    }

    /**
     * Confirm order (for free tickets or after payment)
     */
    static async confirmOrder(orderId: string, userId: string | undefined, attendees?: AttendeeInput[]) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: { items: true, attendees: true }
        });

        if (!order) throw new Error('Order not found');
        if (userId && order.userId !== userId) throw new Error('Unauthorized');
        if (order.status === 'CONFIRMED') throw new Error('Order already confirmed');
        if (order.status !== 'PENDING') throw new Error('Cannot confirm this order');

        // For paid tickets, payment must be completed
        if (order.total > 0 && order.paymentStatus !== 'COMPLETED') {
            throw new Error('Payment not completed');
        }

        // Create attendees if provided
        let tickets: any[] = order.attendees;
        if (attendees && attendees.length > 0) {
            await prisma.attendee.deleteMany({ where: { orderId } });

            const attendeeRecords = attendees.map(a => ({
                orderId,
                ticketId: a.ticketTypeId,
                name: a.name,
                email: a.email,
                phone: a.phone,
                city: a.city || null,
                location: a.location || null,
                ticketCode: `EVF-TKT-${uuidv4().substring(0, 8).toUpperCase()}`,
            }));

            await prisma.attendee.createMany({ data: attendeeRecords });
            tickets = await prisma.attendee.findMany({ where: { orderId } });
        }

        // Update order status
        await prisma.bookingOrder.update({
            where: { id: orderId },
            data: {
                status: 'CONFIRMED',
                paymentStatus: order.total === 0 ? 'COMPLETED' : order.paymentStatus,
                paymentMethod: order.total === 0 ? 'free' : order.paymentMethod,
                confirmedAt: new Date()
            }
        });

        // Update event attendee count
        const totalTickets = order.items.reduce((sum, item) => sum + item.quantity, 0);
        await prisma.event.update({
            where: { id: order.eventId },
            data: { attendeesCount: { increment: totalTickets } }
        });

        // Auto-add user to event chat
        try {
            await ChatService.getOrJoinChat(order.eventId, order.userId);
        } catch (error) {
            console.error('Failed to auto-join chat:', error);
        }

        // In-app notifications: buyer confirmation + organizer ticket sale alert
        try {
            const eventForNotif = await prisma.event.findUnique({
                where: { id: order.eventId },
                select: { title: true, organizerId: true }
            });
            if (eventForNotif) {
                const ticketCount = order.items.reduce((sum, item) => sum + item.quantity, 0);

                // Notify the buyer
                NotificationService.create({
                    userId: order.userId,
                    type: 'TICKET_SALE',
                    title: 'Booking Confirmed!',
                    message: `Your ${ticketCount} ticket${ticketCount > 1 ? 's' : ''} for "${eventForNotif.title}" are confirmed. See you there!`,
                    actionUrl: `/profile?tab=tickets`,
                    metadata: { eventId: order.eventId, orderId: order.id, ticketCount },
                }).catch(() => {});

                // Notify the organizer
                NotificationService.create({
                    userId: eventForNotif.organizerId,
                    type: 'TICKET_SALE',
                    title: 'New Ticket Sale',
                    message: `${ticketCount} ticket${ticketCount > 1 ? 's' : ''} sold for "${eventForNotif.title}".`,
                    actionUrl: `/events/${order.eventId}/manage`,
                    metadata: { eventId: order.eventId, orderId: order.id, ticketCount },
                }).catch(() => {});
            }
        } catch (error) {
            console.error('Failed to create booking notifications:', error);
        }

        // Queue ticket confirmation emails for each attendee via BullMQ
        try {
            const event = await prisma.event.findUnique({
                where: { id: order.eventId },
                select: {
                    title: true, slug: true, startDate: true, venueName: true, address: true, city: true, coverImage: true,
                    organizer: { select: { displayName: true, username: true, avatar: true } },
                }
            });
            if (event) {
                const eventDate = new Date(event.startDate).toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
                });
                const venue = event.venueName || event.address || event.city || 'TBA';
                const eventUrl = event.slug ? `https://eventfi.live/${event.slug}` : undefined;

                for (const ticket of tickets) {
                    if (ticket.email) {
                        emailQueue.add('ticket-confirmation', {
                            type: 'ticket-confirmation',
                            to: ticket.email,
                            eventTitle: event.title,
                            userTitle: ticket.name || 'Attendee',
                            startDate: eventDate,
                            venue,
                            eventImageUrl: event.coverImage,
                            eventUrl,
                            organizerName: event.organizer?.displayName,
                            organizerAvatarUrl: event.organizer?.avatar,
                            organizerProfileUrl: event.organizer?.username ? `https://eventfi.live/profile/${event.organizer.username}` : undefined,
                        }).catch(err => console.error('Failed to queue ticket confirmation email:', err));
                    }
                }
            }
        } catch (error) {
            console.error('Failed to queue ticket confirmation emails:', error);
        }

        return {
            orderId: order.id,
            status: 'confirmed',
            tickets: tickets.map((t: any) => ({
                id: t.id,
                ticketCode: t.ticketCode,
                attendee: { name: t.name, email: t.email }
            })),
            message: 'Tickets have been sent to the attendee emails'
        };
    }

    /**
     * Handle Paystack payment webhook.
     *
     * Relevant events:
     *   charge.success — payment settled; confirm the order
     *   charge.failed  — payment failed; release tickets
     *
     * Signature is already verified by the controller before this is called.
     */
    static async handlePaymentWebhook(event: string, data: any) {
        const reference = data?.reference;
        if (!reference) throw new Error('Missing reference in webhook payload');

        // Installment payments carry their own reference distinct from the order's —
        // check there first before falling back to the full-payment order lookup.
        const installmentPayment = await prisma.installmentPayment.findFirst({
            where: { paymentReference: reference },
            include: { installmentPlan: { include: { bookingOrder: true } } }
        });

        if (installmentPayment) {
            return this.handleInstallmentWebhook(event, installmentPayment);
        }

        const order = await prisma.bookingOrder.findFirst({
            where: { paymentReference: reference },
            include: { items: true }
        });

        if (!order) {
            // Payment not initiated through this system — ignore silently
            return { received: true };
        }

        if (event === 'charge.success') {
            // Mark payment complete then run full confirmation flow
            await prisma.bookingOrder.update({
                where: { id: order.id },
                data: {
                    paymentStatus: 'COMPLETED',
                    paidAt: new Date()
                }
            });

            // Confirm the order (sends notifications, emails, increments attendee count, etc.)
            if (order.status === 'PENDING') {
                await this.confirmOrder(order.id, undefined);
            }
        } else if (event === 'charge.failed') {
            if (order.status !== 'PENDING') return { received: true };

            // Release reserved tickets back to inventory
            await prisma.$transaction(
                order.items.map(item =>
                    prisma.ticket.update({
                        where: { id: item.ticketId },
                        data: { remaining: { increment: item.quantity } },
                    })
                )
            );

            await prisma.bookingOrder.update({
                where: { id: order.id },
                data: {
                    status: 'CANCELLED',
                    paymentStatus: 'FAILED'
                }
            });
        }

        return { received: true };
    }

    /**
     * Handle a Paystack webhook event for a single installment payment.
     *
     *   charge.success — mark this installment PAID; if it was the last one
     *                     pending, complete the plan and confirm the order
     *                     (tickets are only issued once the plan is fully paid).
     *   charge.failed   — mark this installment FAILED; the order/plan are left
     *                     alone so the attendee can retry via the pay endpoint.
     */
    private static async handleInstallmentWebhook(event: string, installmentPayment: any) {
        const plan = installmentPayment.installmentPlan;
        const order = plan.bookingOrder;

        if (plan.status !== 'ACTIVE' || order.status !== 'PENDING') {
            return { received: true };
        }

        if (event === 'charge.success') {
            if (installmentPayment.status === 'PAID') return { received: true };

            await prisma.installmentPayment.update({
                where: { id: installmentPayment.id },
                data: { status: 'PAID', paidAt: new Date() }
            });

            const remaining = await prisma.installmentPayment.count({
                where: { installmentPlanId: plan.id, status: { not: 'PAID' } }
            });

            if (remaining === 0) {
                await prisma.installmentPlan.update({
                    where: { id: plan.id },
                    data: { status: 'COMPLETED' }
                });
                await prisma.bookingOrder.update({
                    where: { id: order.id },
                    data: { paymentStatus: 'COMPLETED', paymentMethod: 'installment', paidAt: new Date() }
                });
                await this.confirmOrder(order.id, undefined);
            } else {
                NotificationService.create({
                    userId: order.userId,
                    type: 'INSTALLMENT_PAID',
                    title: 'Installment payment received',
                    message: `Installment ${installmentPayment.sequence}/${plan.installmentCount} received. ${remaining} payment${remaining > 1 ? 's' : ''} left.`,
                    actionUrl: `/profile?tab=payments`,
                    metadata: { eventId: order.eventId, orderId: order.id, installmentPlanId: plan.id },
                }).catch(() => {});
            }
        } else if (event === 'charge.failed') {
            if (installmentPayment.status !== 'PAID') {
                await prisma.installmentPayment.update({
                    where: { id: installmentPayment.id },
                    data: { status: 'FAILED' }
                });
            }
        }

        return { received: true };
    }

    /**
     * Get user's orders
     */
    static async getUserOrders(userId: string, page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;

        const [total, orders] = await prisma.$transaction([
            prisma.bookingOrder.count({ where: { userId } }),
            prisma.bookingOrder.findMany({
                where: { userId },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    items: true,
                    event: {
                        select: { id: true, title: true, coverImage: true, startDate: true, venueName: true, city: true }
                    },
                    installmentPlan: {
                        include: { payments: { orderBy: { sequence: 'asc' } } }
                    }
                }
            })
        ]);

        return {
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
            data: orders.map(o => this.formatOrder(o))
        };
    }

    /**
     * Get user's tickets (attendee view)
     */
    static async getUserTickets(userId: string, status?: string, upcoming?: boolean, page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;

        const where: any = {
            order: { userId, status: 'CONFIRMED' }
        };

        if (status) where.status = status;
        if (upcoming) {
            where.order.event = { startDate: { gte: new Date().toISOString() } };
        }

        const [total, attendees] = await prisma.$transaction([
            prisma.attendee.count({ where }),
            prisma.attendee.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    ticket: { select: { name: true, type: true } },
                    order: {
                        include: {
                            event: {
                                select: {
                                    id: true, title: true, coverImage: true, startDate: true, endDate: true,
                                    venueName: true, city: true,
                                    organizer: { select: { displayName: true, avatar: true } }
                                }
                            }
                        }
                    }
                }
            })
        ]);

        return {
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
            data: attendees.map(a => ({
                id: a.id,
                ticketCode: a.ticketCode,
                ticketType: { name: a.ticket.name, type: a.ticket.type },
                event: a.order.event,
                attendee: { name: a.name, email: a.email },
                status: a.status,
                checkedIn: a.checkedIn,
                checkedInAt: a.checkedInAt?.toISOString(),
                purchasedAt: a.createdAt.toISOString()
            }))
        };
    }

    /**
     * Get single ticket details
     */
    static async getTicketDetails(ticketId: string, userId: string) {
        const attendee = await prisma.attendee.findUnique({
            where: { id: ticketId },
            include: {
                ticket: { select: { name: true, type: true } },
                order: {
                    include: {
                        event: {
                            select: {
                                id: true, title: true, coverImage: true, startDate: true, endDate: true,
                                venueName: true, city: true,
                                organizer: { select: { displayName: true, avatar: true } }
                            }
                        }
                    }
                }
            }
        });

        if (!attendee) throw new Error('Ticket not found');
        if (attendee.order.userId !== userId) throw new Error('Unauthorized');

        return {
            id: attendee.id,
            ticketCode: attendee.ticketCode,
            ticketType: { name: attendee.ticket.name, type: attendee.ticket.type },
            event: attendee.order.event,
            attendee: { name: attendee.name, email: attendee.email },
            status: attendee.status,
            checkedIn: attendee.checkedIn,
            checkedInAt: attendee.checkedInAt?.toISOString(),
            purchasedAt: attendee.createdAt.toISOString()
        };
    }

    private static formatOrder(order: any) {
        return {
            id: order.id,
            userId: order.userId,
            eventId: order.eventId,
            event: order.event,
            items: order.items?.map((i: any) => ({
                ticketTypeId: i.ticketId,
                ticketTypeName: i.ticketName,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                totalPrice: i.totalPrice
            })),
            attendees: order.attendees,
            subtotal: order.subtotal,
            serviceFee: order.serviceFee,
            discount: order.discount,
            total: order.total,
            currency: order.currency,
            status: order.status.toLowerCase(),
            paymentStatus: order.paymentStatus.toLowerCase(),
            paymentMethod: order.paymentMethod,
            paymentReference: order.paymentReference,
            promoCode: order.promoCode,
            createdAt: order.createdAt.toISOString(),
            updatedAt: order.updatedAt.toISOString(),
            expiresAt: order.expiresAt?.toISOString(),
            paidAt: order.paidAt?.toISOString(),
            confirmedAt: order.confirmedAt?.toISOString(),
            installmentPlan: order.installmentPlan ? {
                id: order.installmentPlan.id,
                installmentCount: order.installmentPlan.installmentCount,
                downPaymentAmount: order.installmentPlan.downPaymentAmount,
                finalDueDate: order.installmentPlan.finalDueDate.toISOString(),
                status: order.installmentPlan.status.toLowerCase(),
                payments: order.installmentPlan.payments?.map((p: any) => ({
                    id: p.id,
                    sequence: p.sequence,
                    amount: p.amount,
                    dueDate: p.dueDate.toISOString(),
                    status: p.status.toLowerCase(),
                    paymentReference: p.paymentReference,
                    paidAt: p.paidAt?.toISOString(),
                })),
            } : null
        };
    }
}
