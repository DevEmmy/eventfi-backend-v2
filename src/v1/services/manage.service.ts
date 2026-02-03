import { prisma } from '../config/database';

interface TeamPermissions {
    canEdit: boolean;
    canManageAttendees: boolean;
    canViewAnalytics: boolean;
    canManageTeam: boolean;
}

const ROLE_PERMISSIONS: Record<string, TeamPermissions> = {
    ORGANIZER: { canEdit: true, canManageAttendees: true, canViewAnalytics: true, canManageTeam: true },
    CO_HOST: { canEdit: true, canManageAttendees: true, canViewAnalytics: true, canManageTeam: false },
    MANAGER: { canEdit: false, canManageAttendees: true, canViewAnalytics: true, canManageTeam: false },
    ASSISTANT: { canEdit: false, canManageAttendees: false, canViewAnalytics: false, canManageTeam: false },
};

export class ManageService {
    /**
     * Check if user has access to manage event
     */
    static async checkEventAccess(userId: string, eventId: string, requiredPermission?: keyof TeamPermissions) {
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            select: { organizerId: true }
        });

        if (!event) throw new Error('Event not found');

        // Check if user is organizer
        if (event.organizerId === userId) {
            return { role: 'ORGANIZER', permissions: ROLE_PERMISSIONS.ORGANIZER };
        }

        // Check if user is team member
        const teamMember = await prisma.eventTeamMember.findFirst({
            where: { eventId, userId, status: 'ACTIVE' }
        });

        if (!teamMember) throw new Error('Unauthorized');

        const permissions = ROLE_PERMISSIONS[teamMember.role] || ROLE_PERMISSIONS.ASSISTANT;

        if (requiredPermission && !permissions[requiredPermission]) {
            throw new Error('Insufficient permissions');
        }

        return { role: teamMember.role, permissions };
    }

    /**
     * Get event management data
     */
    static async getManageData(eventId: string, userId: string) {
        const { role, permissions } = await this.checkEventAccess(userId, eventId);

        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: {
                tickets: true,
                organizer: { select: { id: true, displayName: true, avatar: true } }
            }
        });

        if (!event) throw new Error('Event not found');

        const stats = await this.getEventStats(eventId);
        const ticketBreakdown = await this.getTicketBreakdown(eventId);

        return {
            event,
            stats,
            ticketBreakdown,
            userRole: role.toLowerCase()
        };
    }

    /**
     * Get event statistics
     */
    static async getEventStats(eventId: string) {
        const tickets = await prisma.ticket.findMany({
            where: { eventId }
        });

        const attendees = await prisma.attendee.findMany({
            where: { order: { eventId, status: 'CONFIRMED' } }
        });

        const orders = await prisma.bookingOrder.findMany({
            where: { eventId, status: 'CONFIRMED' }
        });

        const totalTickets = tickets.reduce((sum, t) => sum + t.quantity, 0);
        const ticketsSold = tickets.reduce((sum, t) => sum + (t.quantity - t.remaining), 0);
        const ticketsRemaining = tickets.reduce((sum, t) => sum + t.remaining, 0);
        const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
        const averageTicketPrice = ticketsSold > 0 ? totalRevenue / ticketsSold : 0;
        const checkIns = attendees.filter(a => a.checkedIn).length;
        const noShows = attendees.filter(a => !a.checkedIn).length;
        const refunds = orders.filter(o => o.status === 'REFUNDED').length;

        return {
            totalTickets,
            ticketsSold,
            ticketsRemaining,
            totalRevenue,
            averageTicketPrice: Math.round(averageTicketPrice * 100) / 100,
            attendanceRate: ticketsSold > 0 ? Math.round((checkIns / ticketsSold) * 100) : 0,
            checkIns,
            noShows,
            refunds,
            revenueChange: 0, // TODO: Compare with previous event
            salesChange: 0,   // TODO: Compare with previous event
        };
    }

    /**
     * Get ticket sales breakdown
     */
    static async getTicketBreakdown(eventId: string) {
        const tickets = await prisma.ticket.findMany({
            where: { eventId },
            include: {
                orderItems: {
                    where: { order: { status: 'CONFIRMED' } }
                }
            }
        });

        return tickets.map(t => {
            const sold = t.quantity - t.remaining;
            return {
                ticketTypeId: t.id,
                name: t.name,
                price: t.price,
                total: t.quantity,
                sold,
                remaining: t.remaining,
                revenue: sold * t.price
            };
        });
    }

    /**
     * Get event analytics
     */
    static async getAnalytics(eventId: string, userId: string, period: string = '30d') {
        await this.checkEventAccess(userId, eventId, 'canViewAnalytics');

        const stats = await this.getEventStats(eventId);
        const ticketBreakdown = await this.getTicketBreakdown(eventId);

        // Calculate period start date
        const now = new Date();
        let startDate: Date;
        switch (period) {
            case '7d': startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
            case '30d': startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
            case '90d': startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
            default: startDate = new Date(0); // all time
        }

        // Get sales over time
        const orders = await prisma.bookingOrder.findMany({
            where: { eventId, status: 'CONFIRMED', createdAt: { gte: startDate } },
            include: { items: true },
            orderBy: { createdAt: 'asc' }
        });

        // Group by date
        const salesByDate = new Map<string, { ticketsSold: number; revenue: number }>();
        for (const order of orders) {
            const date = order.createdAt.toISOString().split('T')[0];
            const existing = salesByDate.get(date) || { ticketsSold: 0, revenue: 0 };
            const ticketsSold = order.items.reduce((sum, i) => sum + i.quantity, 0);
            salesByDate.set(date, {
                ticketsSold: existing.ticketsSold + ticketsSold,
                revenue: existing.revenue + order.total
            });
        }

        const salesOverTime = Array.from(salesByDate.entries()).map(([date, data]) => ({
            date,
            ...data
        }));

        return {
            stats,
            ticketBreakdown,
            salesOverTime,
            topReferrers: [] // TODO: Implement referrer tracking
        };
    }

    /**
     * Get event attendees
     */
    static async getAttendees(
        eventId: string,
        userId: string,
        page: number = 1,
        limit: number = 20,
        search?: string,
        status?: string,
        ticketType?: string
    ) {
        await this.checkEventAccess(userId, eventId, 'canManageAttendees');

        const skip = (page - 1) * limit;

        const where: any = {
            order: { eventId, status: 'CONFIRMED' }
        };

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (status === 'checked_in') where.checkedIn = true;
        if (status === 'not_checked_in') where.checkedIn = false;
        if (ticketType && ticketType !== 'all') where.ticketId = ticketType;

        const [total, attendees] = await prisma.$transaction([
            prisma.attendee.count({ where }),
            prisma.attendee.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    ticket: { select: { name: true, price: true } },
                    order: { select: { id: true } }
                }
            })
        ]);

        return {
            attendees: attendees.map(a => ({
                id: a.id,
                name: a.name,
                email: a.email,
                phone: a.phone || '',
                ticketTypeId: a.ticketId,
                ticketTypeName: a.ticket.name,
                ticketPrice: a.ticket.price,
                purchaseDate: a.createdAt.toISOString(),
                status: a.checkedIn ? 'checked_in' : 'not_checked_in',
                checkInTime: a.checkedInAt?.toISOString() || null,
                orderId: a.order.id,
                ticketCode: a.ticketCode
            })),
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit)
        };
    }

    /**
     * Check-in attendee
     */
    static async checkInAttendee(
        eventId: string,
        attendeeId: string,
        userId: string,
        method: 'manual' | 'qr_scan',
        ticketCode?: string
    ) {
        await this.checkEventAccess(userId, eventId, 'canManageAttendees');

        const attendee = await prisma.attendee.findUnique({
            where: { id: attendeeId },
            include: { order: { select: { eventId: true } } }
        });

        if (!attendee) throw new Error('Attendee not found');
        if (attendee.order.eventId !== eventId) throw new Error('Attendee does not belong to this event');
        if (attendee.checkedIn) throw new Error('Attendee already checked in');

        // Validate ticket code if provided
        if (ticketCode && attendee.ticketCode !== ticketCode) {
            throw new Error('Invalid ticket code');
        }

        const updated = await prisma.attendee.update({
            where: { id: attendeeId },
            data: {
                checkedIn: true,
                checkedInAt: new Date(),
                checkInMethod: method
            }
        });

        return {
            attendeeId: updated.id,
            checkInTime: updated.checkedInAt?.toISOString(),
            message: `${updated.name} checked in successfully`
        };
    }

    /**
     * Duplicate event
     */
    static async duplicateEvent(eventId: string, userId: string, title?: string, resetDates?: boolean) {
        await this.checkEventAccess(userId, eventId, 'canEdit');

        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: { tickets: true, scheduleItems: true }
        });

        if (!event) throw new Error('Event not found');

        const newEvent = await prisma.event.create({
            data: {
                title: title || `${event.title} (Copy)`,
                description: event.description,
                shortDescription: event.shortDescription,
                category: event.category,
                tags: event.tags,
                locationType: event.locationType,
                address: event.address,
                venueName: event.venueName,
                city: event.city,
                state: event.state,
                country: event.country,
                postalCode: event.postalCode,
                lat: event.lat,
                lng: event.lng,
                onlineUrl: event.onlineUrl,
                onlinePassword: event.onlinePassword,
                startDate: resetDates ? new Date() : event.startDate,
                endDate: resetDates ? new Date() : event.endDate,
                startTime: resetDates ? '' : event.startTime,
                endTime: resetDates ? '' : event.endTime,
                timezone: event.timezone,
                coverImage: event.coverImage,
                gallery: event.gallery,
                videoUrl: event.videoUrl,
                organizerId: userId,
                status: 'DRAFT',
                privacy: event.privacy,
                tickets: {
                    create: event.tickets.map(t => ({
                        name: t.name,
                        description: t.description,
                        type: t.type,
                        price: t.price,
                        currency: t.currency,
                        quantity: t.quantity,
                        remaining: t.quantity,
                        maxPerUser: t.maxPerUser,
                        salesStart: t.salesStart,
                        salesEnd: t.salesEnd
                    }))
                },
                scheduleItems: {
                    create: event.scheduleItems.map(s => ({
                        time: s.time,
                        activity: s.activity,
                        description: s.description,
                        order: s.order
                    }))
                }
            }
        });

        return {
            id: newEvent.id,
            title: newEvent.title,
            status: newEvent.status
        };
    }

    /**
     * Cancel event
     */
    static async cancelEvent(
        eventId: string,
        userId: string,
        reason: string,
        notifyAttendees: boolean,
        refundPolicy: 'full' | 'partial' | 'none'
    ) {
        await this.checkEventAccess(userId, eventId, 'canEdit');

        const event = await prisma.event.findUnique({
            where: { id: eventId }
        });

        if (!event) throw new Error('Event not found');
        if (event.status === 'CANCELLED') throw new Error('Event already cancelled');

        // Get orders separately
        const orders = await prisma.bookingOrder.findMany({
            where: { eventId, status: 'CONFIRMED' },
            include: { attendees: true }
        });

        // Update event status
        await prisma.event.update({
            where: { id: eventId },
            data: { status: 'CANCELLED' }
        });

        let refundsInitiated = 0;
        if (refundPolicy !== 'none') {
            // Mark orders for refund
            for (const order of orders) {
                await prisma.bookingOrder.update({
                    where: { id: order.id },
                    data: { status: 'REFUNDED', paymentStatus: 'REFUNDED' }
                });
                refundsInitiated++;
            }
        }

        // TODO: Send notification emails to attendees
        const attendeesNotified = notifyAttendees
            ? orders.reduce((sum: number, o) => sum + o.attendees.length, 0)
            : 0;

        return {
            status: 'CANCELLED',
            attendeesNotified,
            refundsInitiated
        };
    }

    /**
     * Send bulk email to attendees
     */
    static async sendBulkEmail(
        eventId: string,
        userId: string,
        recipients: 'all' | 'checked_in' | 'not_checked_in' | 'custom',
        attendeeIds: string[] | undefined,
        subject: string,
        body: string
    ) {
        await this.checkEventAccess(userId, eventId, 'canManageAttendees');

        let where: any = { order: { eventId, status: 'CONFIRMED' } };

        if (recipients === 'checked_in') where.checkedIn = true;
        if (recipients === 'not_checked_in') where.checkedIn = false;
        if (recipients === 'custom' && attendeeIds) {
            where.id = { in: attendeeIds };
        }

        const attendees = await prisma.attendee.findMany({
            where,
            select: { id: true, name: true, email: true, ticket: { select: { name: true } } }
        });

        // TODO: Implement actual email sending via queue
        // For now, just return count
        console.log(`[Bulk Email] Event ${eventId}: Queued ${attendees.length} emails`);

        return {
            emailsSent: attendees.length,
            message: 'Bulk email queued for delivery'
        };
    }
}
