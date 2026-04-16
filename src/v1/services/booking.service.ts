import { prisma } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { ChatService } from './chat.service';
import { PaymentService, CustomerObject } from './payment.service';
import { NotificationService } from './notification.service';
import { emailQueue } from '../jobs/email.queue';

const SERVICE_FEE_PERCENT = 0.05; // 5% service fee
const ORDER_EXPIRY_MINUTES = 30;

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
    static async initiateOrder(userId: string | undefined, eventId: string, items: OrderItemInput[], guestEmail?: string) {
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

        const serviceFee = Math.round(subtotal * SERVICE_FEE_PERCENT);
        const total = subtotal + serviceFee;
        // Currency comes from the already-fetched ticket map — no extra DB round-trip
        const currency = ticketMap.get(items[0].ticketTypeId)?.currency || 'NGN';

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

        return this.formatOrder(order);
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
            include: { items: true }
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

        return { message: 'Order cancelled successfully' };
    }

    /**
     * Initialize payment via ZendFi (for paid tickets)
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

        // Create ZendFi payment
        const payment = await PaymentService.initializeTransaction(
            order.total,
            order.currency,
            `${eventTitle} — Order #${orderId.substring(0, 8).toUpperCase()}`,
            customer,
            { orderId, eventTitle }
        );

        // Store the ZendFi payment ID as our reference
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
                select: { title: true, startDate: true, venueName: true, address: true, city: true }
            });
            if (event) {
                const eventDate = new Date(event.startDate).toLocaleDateString('en-US', {
                    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
                });
                const venue = event.venueName || event.address || event.city || 'TBA';

                for (const ticket of tickets) {
                    if (ticket.email) {
                        emailQueue.add('ticket-confirmation', {
                            type: 'ticket-confirmation',
                            to: ticket.email,
                            eventTitle: event.title,
                            userTitle: ticket.name || 'Attendee',
                            startDate: eventDate,
                            venue,
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
     * Handle ZendFi payment webhook.
     *
     * Relevant events:
     *   PaymentConfirmed — payment settled; confirm the order
     *   PaymentFailed    — payment failed; mark as failed
     *   PaymentExpired   — payment timed out; mark as failed
     *
     * Signature is already verified by the controller before this is called.
     */
    static async handlePaymentWebhook(event: string, payment: any) {
        const paymentId = payment?.id;
        if (!paymentId) throw new Error('Missing payment ID in webhook payload');

        const order = await prisma.bookingOrder.findFirst({
            where: { paymentReference: paymentId }
        });

        if (!order) {
            // Could be a payment not initiated through this system — ignore silently
            return { received: true };
        }

        if (event === 'PaymentConfirmed') {
            await prisma.bookingOrder.update({
                where: { id: order.id },
                data: {
                    paymentStatus: 'COMPLETED',
                    paidAt: new Date()
                }
            });
        } else if (event === 'PaymentFailed' || event === 'PaymentExpired') {
            await prisma.bookingOrder.update({
                where: { id: order.id },
                data: { paymentStatus: 'FAILED' }
            });
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
            confirmedAt: order.confirmedAt?.toISOString()
        };
    }
}
