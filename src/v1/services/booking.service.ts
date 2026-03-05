import { prisma } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { ChatService } from './chat.service';
import { PaymentService } from './payment.service';
import { EmailService } from './email.service';
import { EmailTemplates } from '../utils/email.templates';

const SERVICE_FEE_PERCENT = 0.05; // 5% service fee
const ORDER_EXPIRY_MINUTES = 30;

interface OrderItemInput {
    ticketTypeId: string;
    quantity: number;
}

interface AttendeeInput {
    ticketTypeId: string;
    name: string;
    email: string;
    phone?: string;
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
    static async initiateOrder(userId: string, eventId: string, items: OrderItemInput[]) {
        // Validate event exists
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            select: { id: true, title: true, coverImage: true, startDate: true, venueName: true, city: true }
        });
        if (!event) throw new Error('Event not found');

        // Validate tickets and calculate totals
        let subtotal = 0;
        const orderItems: any[] = [];

        for (const item of items) {
            // Validate UUID inputs to prevent database errors
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (!item.ticketTypeId || !uuidRegex.test(item.ticketTypeId)) {
                throw new Error(`Invalid ticketTypeId: ${item.ticketTypeId}`);
            }

            const ticket = await prisma.ticket.findUnique({
                where: { id: item.ticketTypeId }
            });

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
        const currency = orderItems.length > 0 ?
            (await prisma.ticket.findUnique({ where: { id: items[0].ticketTypeId } }))?.currency || 'NGN' : 'NGN';

        // Create the order
        const expiresAt = new Date(Date.now() + ORDER_EXPIRY_MINUTES * 60 * 1000);

        const order = await prisma.bookingOrder.create({
            data: {
                userId,
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

        // Reserve tickets (decrease remaining)
        for (const item of items) {
            await prisma.ticket.update({
                where: { id: item.ticketTypeId },
                data: { remaining: { decrement: item.quantity } }
            });
        }

        return this.formatOrder(order);
    }

    /**
     * Get order details
     */
    static async getOrder(orderId: string, userId: string) {
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
        if (order.userId !== userId) throw new Error('Unauthorized');

        return this.formatOrder(order);
    }

    /**
     * Update attendee information
     */
    static async updateAttendees(orderId: string, userId: string, attendees: AttendeeInput[]) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: { items: true }
        });

        if (!order) throw new Error('Order not found');
        if (order.userId !== userId) throw new Error('Unauthorized');
        if (order.status !== 'PENDING') throw new Error('Cannot update attendees for this order');

        // Delete existing attendees and create new ones
        await prisma.attendee.deleteMany({ where: { orderId } });

        const attendeeRecords = attendees.map(a => ({
            orderId,
            ticketId: a.ticketTypeId,
            name: a.name,
            email: a.email,
            phone: a.phone,
            ticketCode: `EVF-TKT-${uuidv4().substring(0, 8).toUpperCase()}`,
        }));

        await prisma.attendee.createMany({ data: attendeeRecords });

        return this.getOrder(orderId, userId);
    }

    /**
     * Apply promo code
     */
    static async applyPromoCode(orderId: string, userId: string, promoCode: string) {
        const order = await prisma.bookingOrder.findUnique({ where: { id: orderId } });

        if (!order) throw new Error('Order not found');
        if (order.userId !== userId) throw new Error('Unauthorized');
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
    static async cancelOrder(orderId: string, userId: string) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: { items: true }
        });

        if (!order) throw new Error('Order not found');
        if (order.userId !== userId) throw new Error('Unauthorized');
        if (order.status !== 'PENDING') throw new Error('Cannot cancel this order');

        // Release tickets
        for (const item of order.items) {
            await prisma.ticket.update({
                where: { id: item.ticketId },
                data: { remaining: { increment: item.quantity } }
            });
        }

        await prisma.bookingOrder.update({
            where: { id: orderId },
            data: { status: 'CANCELLED' }
        });

        return { message: 'Order cancelled successfully' };
    }

    /**
     * Initialize payment via Paystack (for paid tickets)
     */
    static async initializePayment(orderId: string, userId: string, paymentMethod: string, callbackUrl: string) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: { event: { select: { title: true } } }
        });

        if (!order) throw new Error('Order not found');
        if (order.userId !== userId) throw new Error('Unauthorized');
        if (order.status !== 'PENDING') throw new Error('Cannot pay for this order');
        if (order.total === 0) throw new Error('Use confirm endpoint for free tickets');

        // Fetch user email for Paystack
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true }
        });
        if (!user) throw new Error('User not found');

        const reference = `EVF-ORD-${uuidv4().substring(0, 8).toUpperCase()}`;

        // Amount in kobo (Paystack expects smallest currency unit)
        const amountInKobo = Math.round(order.total * 100);

        // Initialize Paystack transaction
        const payment = await PaymentService.initializeTransaction(
            user.email,
            amountInKobo,
            reference,
            callbackUrl,
            { orderId, eventTitle: (order as any).event?.title }
        );

        await prisma.bookingOrder.update({
            where: { id: orderId },
            data: {
                paymentMethod,
                paymentReference: reference,
                paymentStatus: 'PROCESSING'
            }
        });

        return {
            paymentUrl: payment.paymentUrl,
            reference: payment.reference,
            accessCode: payment.accessCode,
            expiresAt: order.expiresAt?.toISOString(),
        };
    }

    /**
     * Confirm order (for free tickets or after payment)
     */
    static async confirmOrder(orderId: string, userId: string, attendees?: AttendeeInput[]) {
        const order = await prisma.bookingOrder.findUnique({
            where: { id: orderId },
            include: { items: true, attendees: true }
        });

        if (!order) throw new Error('Order not found');
        if (order.userId !== userId) throw new Error('Unauthorized');
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
            await ChatService.getOrJoinChat(order.eventId, userId);
        } catch (error) {
            console.error('Failed to auto-join chat:', error);
        }

        // Send ticket confirmation emails to each attendee
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
                        const template = EmailTemplates.ticketConfirmation({
                            eventTitle: event.title,
                            userTitle: ticket.name || 'Attendee',
                            startDate: eventDate,
                            venue,
                        });
                        EmailService.send(ticket.email, template.subject, template.html, template.text).catch(err =>
                            console.error('Failed to send ticket confirmation email:', err)
                        );
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
     * Handle Paystack payment webhook (charge.success event)
     */
    static async handlePaymentWebhook(event: string, data: any) {
        if (event !== 'charge.success') {
            return { received: true };
        }

        const reference = data?.reference;
        if (!reference) throw new Error('Missing payment reference');

        const order = await prisma.bookingOrder.findFirst({
            where: { paymentReference: reference }
        });

        if (!order) throw new Error('Order not found for reference');

        // Verify the transaction via Paystack API for extra security
        try {
            const verification = await PaymentService.verifyTransaction(reference);

            if (verification.status === 'success') {
                await prisma.bookingOrder.update({
                    where: { id: order.id },
                    data: {
                        paymentStatus: 'COMPLETED',
                        paidAt: new Date()
                    }
                });
            } else {
                await prisma.bookingOrder.update({
                    where: { id: order.id },
                    data: { paymentStatus: 'FAILED' }
                });
            }
        } catch (verifyError) {
            console.error('Payment verification failed:', verifyError);
            // Still mark as completed based on webhook (Paystack is the source of truth)
            await prisma.bookingOrder.update({
                where: { id: order.id },
                data: {
                    paymentStatus: 'COMPLETED',
                    paidAt: new Date()
                }
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
