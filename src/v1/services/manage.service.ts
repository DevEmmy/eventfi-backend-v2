import { prisma } from '../config/database';
import { emailQueue } from '../jobs/email.queue';
import redis from '../config/redis';

const ACCESS_CACHE_TTL = 120; // 2 min — team membership rarely changes mid-session

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
        const cacheKey = `event_access:${eventId}:${userId}`;

        // Try cache (no requiredPermission check yet — we always store full access object)
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const access = JSON.parse(cached) as { role: string; permissions: TeamPermissions };
                if (requiredPermission && !access.permissions[requiredPermission]) {
                    throw new Error('Insufficient permissions');
                }
                return access;
            }
        } catch (e: any) {
            if (e.message === 'Insufficient permissions') throw e;
            // Redis unavailable — fall through to DB
        }

        const event = await prisma.event.findUnique({
            where: { id: eventId },
            select: { organizerId: true }
        });

        if (!event) throw new Error('Event not found');

        let access: { role: string; permissions: TeamPermissions };

        if (event.organizerId === userId) {
            access = { role: 'ORGANIZER', permissions: ROLE_PERMISSIONS.ORGANIZER };
        } else {
            const teamMember = await prisma.eventTeamMember.findFirst({
                where: { eventId, userId, status: 'ACTIVE' }
            });

            if (!teamMember) throw new Error('Unauthorized');

            const permissions = ROLE_PERMISSIONS[teamMember.role] || ROLE_PERMISSIONS.ASSISTANT;
            access = { role: teamMember.role, permissions };
        }

        // Cache the result (non-blocking)
        redis.set(cacheKey, JSON.stringify(access), 'EX', ACCESS_CACHE_TTL).catch(() => {});

        if (requiredPermission && !access.permissions[requiredPermission]) {
            throw new Error('Insufficient permissions');
        }

        return access;
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
     * Get event statistics.
     * When startDate is provided, ticketsSold and totalRevenue are scoped to that period;
     * capacity, check-in, and change metrics always use all-time data.
     */
    static async getEventStats(eventId: string, startDate?: Date) {
        const periodFilter = startDate ? { createdAt: { gte: startDate } } : {};

        // Run all independent aggregations concurrently — no more loading full rows into memory
        const [
            ticketAgg,
            allTimeRevenueAgg,
            periodRevenueAgg,
            periodTicketsSoldAgg,
            checkIns,
            noShows,
            refunds,
            event,
        ] = await Promise.all([
            // Capacity from ticket table (small, fast)
            prisma.ticket.aggregate({
                where: { eventId },
                _sum: { quantity: true, remaining: true },
            }),
            // All-time revenue (needed for change % calc)
            prisma.bookingOrder.aggregate({
                where: { eventId, status: 'CONFIRMED' },
                _sum: { total: true },
            }),
            // Period-scoped revenue
            prisma.bookingOrder.aggregate({
                where: { eventId, status: 'CONFIRMED', ...periodFilter },
                _sum: { total: true },
            }),
            // Period-scoped tickets sold via OrderItem aggregation
            prisma.orderItem.aggregate({
                where: { order: { eventId, status: 'CONFIRMED', ...periodFilter } },
                _sum: { quantity: true },
            }),
            // Check-in counts via DB — no JS filtering
            prisma.attendee.count({
                where: { order: { eventId, status: 'CONFIRMED' }, checkedIn: true },
            }),
            prisma.attendee.count({
                where: { order: { eventId, status: 'CONFIRMED' }, checkedIn: false },
            }),
            prisma.bookingOrder.count({ where: { eventId, status: 'REFUNDED' } }),
            prisma.event.findUnique({
                where: { id: eventId },
                select: { organizerId: true, createdAt: true },
            }),
        ]);

        const totalTickets      = ticketAgg._sum.quantity  ?? 0;
        const ticketsRemaining  = ticketAgg._sum.remaining ?? 0;
        const allTimeTicketsSold = totalTickets - ticketsRemaining;
        const allTimeRevenue    = allTimeRevenueAgg._sum.total ?? 0;
        const totalRevenue      = periodRevenueAgg._sum.total  ?? 0;
        const ticketsSold       = periodTicketsSoldAgg._sum.quantity ?? allTimeTicketsSold;
        const averageTicketPrice = ticketsSold > 0 ? totalRevenue / ticketsSold : 0;

        // Compare all-time stats against the organiser's previous event
        let revenueChange = 0;
        let salesChange   = 0;

        if (event) {
            const prevEvent = await prisma.event.findFirst({
                where: {
                    organizerId: event.organizerId,
                    id: { not: eventId },
                    createdAt: { lt: event.createdAt },
                },
                orderBy: { createdAt: 'desc' },
                select: { id: true },
            });

            if (prevEvent) {
                const [prevRevenueAgg, prevSoldAgg] = await Promise.all([
                    prisma.bookingOrder.aggregate({
                        where: { eventId: prevEvent.id, status: 'CONFIRMED' },
                        _sum: { total: true },
                    }),
                    prisma.orderItem.aggregate({
                        where: { order: { eventId: prevEvent.id, status: 'CONFIRMED' } },
                        _sum: { quantity: true },
                    }),
                ]);

                const prevRevenue = prevRevenueAgg._sum.total    ?? 0;
                const prevSold    = prevSoldAgg._sum.quantity    ?? 0;

                if (prevRevenue > 0)
                    revenueChange = Math.round(((allTimeRevenue - prevRevenue) / prevRevenue) * 100);
                if (prevSold > 0)
                    salesChange = Math.round(((allTimeTicketsSold - prevSold) / prevSold) * 100);
            }
        }

        return {
            totalTickets,
            ticketsSold,
            ticketsRemaining,
            totalRevenue,
            averageTicketPrice: Math.round(averageTicketPrice * 100) / 100,
            attendanceRate: allTimeTicketsSold > 0 ? Math.round((checkIns / allTimeTicketsSold) * 100) : 0,
            checkIns,
            noShows,
            refunds,
            revenueChange,
            salesChange,
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
            const sold = t.orderItems.reduce((sum, i) => sum + i.quantity, 0);
            const revenue = t.orderItems.reduce((sum, i) => sum + i.totalPrice, 0);
            return {
                ticketTypeId: t.id,
                name: t.name,
                price: t.price,
                total: t.quantity,
                sold,
                remaining: t.remaining,
                revenue
            };
        });
    }

    /**
     * Get event analytics
     */
    static async getAnalytics(eventId: string, userId: string, period: string = '30d') {
        await this.checkEventAccess(userId, eventId, 'canViewAnalytics');

        // Calculate period start date
        const now = new Date();
        let startDate: Date | undefined;
        switch (period) {
            case '7d':  startDate = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000); break;
            case '30d': startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
            case '90d': startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); break;
            default:    startDate = undefined; // all time
        }

        const stats = await this.getEventStats(eventId, startDate);
        const ticketBreakdown = await this.getTicketBreakdown(eventId);

        // Fetch event to get organizer (for repeat-attendee calc below)
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            select: { organizerId: true }
        });

        // Sales over time — group by date using only scalar fields (no items included)
        const periodOrders = await prisma.bookingOrder.findMany({
            where: {
                eventId,
                status: 'CONFIRMED',
                ...(startDate ? { createdAt: { gte: startDate } } : {}),
            },
            select: { createdAt: true, total: true },
            orderBy: { createdAt: 'asc' },
        });

        // Ticket counts per order via a single aggregation grouped by order
        const periodItemsByOrder = await prisma.orderItem.groupBy({
            by: ['orderId'],
            where: { order: { eventId, status: 'CONFIRMED', ...(startDate ? { createdAt: { gte: startDate } } : {}) } },
            _sum: { quantity: true },
        });
        const itemQtyByOrder = new Map(periodItemsByOrder.map(r => [r.orderId, r._sum.quantity ?? 0]));

        // Group by date in memory (only scalars, much lighter than full rows + items)
        const salesByDate = new Map<string, { ticketsSold: number; revenue: number }>();
        for (const order of periodOrders) {
            const date = order.createdAt.toISOString().split('T')[0];
            const existing = salesByDate.get(date) ?? { ticketsSold: 0, revenue: 0 };
            salesByDate.set(date, {
                ticketsSold: existing.ticketsSold + (itemQtyByOrder.get((order as any).id) ?? 0),
                revenue: existing.revenue + order.total,
            });
        }

        const salesOverTime = Array.from(salesByDate.entries()).map(([date, data]) => ({ date, ...data }));

        let peakSalesDay: { date: string; ticketsSold: number } | null = null;
        for (const [date, data] of salesByDate.entries()) {
            if (!peakSalesDay || data.ticketsSold > peakSalesDay.ticketsSold)
                peakSalesDay = { date, ticketsSold: data.ticketsSold };
        }

        const avgOrderAgg = await prisma.bookingOrder.aggregate({
            where: { eventId, status: 'CONFIRMED', ...(startDate ? { createdAt: { gte: startDate } } : {}) },
            _avg: { total: true },
        });
        const avgOrderValue = Math.round(avgOrderAgg._avg.total ?? 0);

        // Repeat attendees — parallelise the two lookup queries
        let repeatAttendeesRate = 0;
        if (event && stats.ticketsSold > 0) {
            const attendeeEmails = await prisma.attendee.findMany({
                where: { order: { eventId, status: 'CONFIRMED' } },
                select: { email: true },
            });

            const emails = attendeeEmails.map(a => a.email);

            if (emails.length > 0) {
                const [otherEventIds, ] = await Promise.all([
                    prisma.event.findMany({
                        where: { organizerId: event.organizerId, id: { not: eventId } },
                        select: { id: true },
                    }),
                ]);

                const otherIds = otherEventIds.map(e => e.id);

                if (otherIds.length > 0) {
                    const repeatCount = await prisma.attendee.count({
                        where: {
                            email: { in: emails },
                            order: { eventId: { in: otherIds }, status: 'CONFIRMED' },
                        },
                    });
                    repeatAttendeesRate = Math.round((repeatCount / emails.length) * 100);
                }
            }
        }

        return {
            stats,
            ticketBreakdown,
            salesOverTime,
            peakSalesDay,
            avgOrderValue,
            repeatAttendeesRate,
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
     * Export attendees as CSV
     */
    static async exportAttendees(
        eventId: string,
        userId: string,
        status?: string
    ): Promise<string> {
        await this.checkEventAccess(userId, eventId, 'canManageAttendees');

        const where: any = {
            order: { eventId, status: 'CONFIRMED' }
        };
        if (status === 'checked_in') where.checkedIn = true;
        if (status === 'not_checked_in') where.checkedIn = false;

        const attendees = await prisma.attendee.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 10_000, // hard cap — stream for larger datasets
            include: {
                ticket: { select: { name: true, price: true } },
                order: { select: { id: true } },
            },
        });

        const escape = (val: any) => {
            const str = val == null ? '' : String(val);
            return str.includes(',') || str.includes('"') || str.includes('\n')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
        };

        const headers = [
            'Name', 'Email', 'Phone', 'City', 'Location', 'Ticket Type', 'Ticket Price',
            'Ticket Code', 'Order ID', 'Check-in Status', 'Check-in Time', 'Purchase Date'
        ];

        const rows = attendees.map(a => [
            escape(a.name),
            escape(a.email),
            escape(a.phone || ''),
            escape((a as any).city || ''),
            escape((a as any).location || ''),
            escape(a.ticket.name),
            escape(a.ticket.price),
            escape(a.ticketCode),
            escape(a.order.id),
            escape(a.checkedIn ? 'Checked In' : 'Not Checked In'),
            escape(a.checkedInAt ? a.checkedInAt.toISOString() : ''),
            escape(a.createdAt.toISOString()),
        ].join(','));

        return [headers.join(','), ...rows].join('\n');
    }

    /**
     * Export confirmed orders as CSV (financial report)
     */
    static async exportRevenue(eventId: string, userId: string): Promise<string> {
        await this.checkEventAccess(userId, eventId, 'canViewAnalytics');

        const orders = await prisma.bookingOrder.findMany({
            where: { eventId, status: 'CONFIRMED' },
            take: 10_000, // hard cap — stream for larger datasets
            include: {
                items: true,
                user: { select: { displayName: true, email: true } },
            },
            orderBy: { createdAt: 'asc' },
        });

        const escape = (val: any) => {
            const str = val == null ? '' : String(val);
            return str.includes(',') || str.includes('"') || str.includes('\n')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
        };

        const headers = [
            'Order ID', 'Customer Name', 'Customer Email',
            'Tickets', 'Subtotal', 'Service Fee', 'Discount', 'Total',
            'Currency', 'Payment Method', 'Promo Code', 'Order Date'
        ];

        const rows = orders.map(o => {
            const ticketCount = o.items.reduce((sum, i) => sum + i.quantity, 0);
            return [
                escape(o.id),
                escape(o.user?.displayName || ''),
                escape(o.user?.email || ''),
                escape(ticketCount),
                escape(o.subtotal),
                escape(o.serviceFee),
                escape(o.discount),
                escape(o.total),
                escape(o.currency),
                escape(o.paymentMethod || ''),
                escape(o.promoCode || ''),
                escape(o.createdAt.toISOString()),
            ].join(',');
        });

        return [headers.join(','), ...rows].join('\n');
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

        // Fetch only the fields needed for refund + notification (no full row load)
        const orders = await prisma.bookingOrder.findMany({
            where: { eventId, status: 'CONFIRMED' },
            select: {
                id: true,
                attendees: { select: { email: true } },
            },
        });

        // Update event status
        await prisma.event.update({
            where: { id: eventId },
            data: { status: 'CANCELLED' }
        });

        let refundsInitiated = 0;
        if (refundPolicy !== 'none' && orders.length > 0) {
            // Mark all orders for refund in a single transaction
            await prisma.$transaction(
                orders.map(order =>
                    prisma.bookingOrder.update({
                        where: { id: order.id },
                        data: { status: 'REFUNDED', paymentStatus: 'REFUNDED' },
                    })
                )
            );
            refundsInitiated = orders.length;
        }

        // Send notification emails to attendees via queue
        let attendeesNotified = 0;
        if (notifyAttendees) {
            const eventDate = event.startDate
                ? new Date(event.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                : 'TBA';

            const attendeeEmails = new Set<string>();
            for (const order of orders) {
                for (const attendee of order.attendees) {
                    if (attendee.email) {
                        attendeeEmails.add(attendee.email);
                    }
                }
            }

            for (const email of attendeeEmails) {
                emailQueue.add('event-cancellation', {
                    type: 'event-cancellation',
                    to: email,
                    eventTitle: event.title,
                    eventDate,
                    reason,
                    refundPolicy,
                }).catch(err => console.error('Failed to queue cancellation email:', err));
            }
            attendeesNotified = attendeeEmails.size;
        }

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
        // 1. Check access
        await this.checkEventAccess(userId, eventId, 'canManageAttendees');

        // 2. Fetch event and organizer details for the template
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: {
                organizer: { select: { displayName: true, email: true } }
            }
        });

        if (!event) throw new Error('Event not found');

        // 3. Define recipient filter
        let where: any = { order: { eventId, status: 'CONFIRMED' } };

        if (recipients === 'checked_in') where.checkedIn = true;
        if (recipients === 'not_checked_in') where.checkedIn = false;
        if (recipients === 'custom' && attendeeIds) {
            where.id = { in: attendeeIds };
        }

        // 4. Fetch attendees with their emails
        const attendees = await prisma.attendee.findMany({
            where,
            select: { id: true, name: true, email: true }
        });

        if (attendees.length === 0) {
            return {
                emailsSent: 0,
                message: 'No attendees found for the selected filter'
            };
        }

        // 5. Enqueue announcement jobs in batches of 10 to stay within BullMQ rate limit
        const CHUNK_SIZE = 10;
        for (let i = 0; i < attendees.length; i += CHUNK_SIZE) {
            const chunk = attendees.slice(i, i + CHUNK_SIZE);
            await Promise.all(
                chunk.map(attendee =>
                    emailQueue.add('announcement', {
                        type: 'announcement',
                        to: attendee.email,
                        eventTitle: event.title,
                        subject,
                        content: body,
                        organizerName: event.organizer.displayName || 'Event Organizer',
                    }).catch(err => console.error(`[BulkEmail] Failed to queue for ${attendee.email}:`, err))
                )
            );
        }

        console.log(`[Bulk Email] Event ${eventId}: Sent ${attendees.length} emails`);

        return {
            emailsSent: attendees.length,
            message: `Successfully sent ${attendees.length} emails`
        };
    }
}
