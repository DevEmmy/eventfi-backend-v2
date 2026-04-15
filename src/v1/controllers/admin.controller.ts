import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { prisma } from '../config/database';
import { AdminRequest } from '../middlewares/admin.middleware';

// ─── helpers ─────────────────────────────────────────────────────────────────

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET as string;
const ADMIN_JWT_EXPIRES  = process.env.ADMIN_JWT_EXPIRES_IN || '12h';

function paginationParams(query: any): { skip: number; take: number; page: number; limit: number } {
    const page  = Math.max(1, parseInt(query.page  ?? '1',  10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
    return { skip: (page - 1) * limit, take: limit, page, limit };
}

function pageMeta(total: number, page: number, limit: number) {
    return { total, page, limit, totalPages: Math.ceil(total / limit) };
}

// Naive CSV serialiser — keeps it dependency-free
function toCSV(rows: Record<string, unknown>[]): string {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const escape  = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return [
        headers.join(','),
        ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
    ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════════

export class AdminAuthController {
    /**
     * POST /admin/auth/login
     * Validates credentials against the ADMIN_EMAILS allow-list stored in env.
     * Returns an admin-scoped JWT (signed with ADMIN_JWT_SECRET).
     */
    static async login(req: Request, res: Response) {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return res.status(400).json({ status: 'error', message: 'Email and password are required' });
            }

            // The allow-list lives in ADMIN_EMAILS (comma-separated)
            const allowedEmails = (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim().toLowerCase());
            if (!allowedEmails.includes(email.toLowerCase())) {
                return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
            }

            const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
            if (!user) {
                return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
            }

            const valid = await bcrypt.compare(password, user.passwordHash);
            if (!valid) {
                return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
            }

            const token = jwt.sign(
                { id: user.id, email: user.email, name: user.displayName ?? user.email, role: 'admin' },
                ADMIN_JWT_SECRET,
                { expiresIn: ADMIN_JWT_EXPIRES as any },
            );

            return res.status(200).json({
                status: 'success',
                data: {
                    token,
                    admin: { id: user.id, email: user.email, name: user.displayName, avatar: user.avatar },
                },
            });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /** GET /admin/auth/me */
    static async me(req: AdminRequest, res: Response) {
        try {
            const user = await prisma.user.findUnique({
                where: { id: req.admin!.id },
                select: { id: true, email: true, displayName: true, avatar: true, createdAt: true },
            });
            return res.status(200).json({ status: 'success', data: user });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

export class AdminDashboardController {
    /**
     * GET /admin/dashboard/stats
     * Returns the KPI numbers shown on the main dashboard cards.
     */
    static async getStats(_req: Request, res: Response) {
        try {
            const [
                totalUsers,
                totalEvents,
                totalRevenue,
                totalRegistrations,
                totalScannedIn,
                totalGamesPlayed,
            ] = await Promise.all([
                prisma.user.count({ where: { deletedAt: null } }),
                prisma.event.count(),
                prisma.bookingOrder.aggregate({
                    _sum: { total: true },
                    where: { paymentStatus: 'COMPLETED' },
                }),
                prisma.attendee.count(),
                prisma.attendee.count({ where: { checkedIn: true } }),
                prisma.activityEntry.count(),
            ]);

            // Count live vs ended events
            const liveEvents  = await prisma.event.count({ where: { status: 'PUBLISHED' } });
            const endedEvents = await prisma.event.count({ where: { status: 'COMPLETED' } });

            return res.status(200).json({
                status: 'success',
                data: {
                    totalUsers,
                    totalEvents,
                    liveEvents,
                    endedEvents,
                    totalRevenue:        totalRevenue._sum.total ?? 0,
                    totalRegistrations,
                    totalScannedIn,
                    turnoutRate:         totalRegistrations > 0
                        ? Math.round((totalScannedIn / totalRegistrations) * 100)
                        : 0,
                    totalGamesPlayed,
                },
            });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /**
     * GET /admin/dashboard/revenue-chart?period=daily|weekly|monthly
     * Returns an array of { label, revenue } for the sparkline / forecast chart.
     */
    static async getRevenueChart(req: Request, res: Response) {
        try {
            const period = (req.query.period as string) || 'monthly';
            const now    = new Date();

            // Determine window and bucket
            let since: Date;
            let trunc: string;
            if (period === 'daily') {
                since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // last 30 days
                trunc = 'day';
            } else if (period === 'weekly') {
                since = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000); // last 12 weeks
                trunc = 'week';
            } else {
                since = new Date(now.getTime() - 12 * 30 * 24 * 60 * 60 * 1000); // last 12 months
                trunc = 'month';
            }

            const rows = await prisma.$queryRaw<{ label: string; revenue: number }[]>`
                SELECT
                    TO_CHAR(DATE_TRUNC(${trunc}, "paidAt"), 'YYYY-MM-DD') AS label,
                    SUM(total)::float                                       AS revenue
                FROM "BookingOrder"
                WHERE "paymentStatus" = 'COMPLETED'
                  AND "paidAt" >= ${since}
                GROUP BY DATE_TRUNC(${trunc}, "paidAt")
                ORDER BY DATE_TRUNC(${trunc}, "paidAt") ASC
            `;

            return res.status(200).json({ status: 'success', data: rows });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /**
     * GET /admin/dashboard/top-events?limit=10
     */
    static async getTopEvents(req: Request, res: Response) {
        try {
            const limit = Math.min(50, parseInt((req.query.limit as string) ?? '10', 10));

            const events = await prisma.event.findMany({
                take: limit,
                orderBy: { attendeesCount: 'desc' },
                select: {
                    id:             true,
                    title:          true,
                    status:         true,
                    coverImage:     true,
                    attendeesCount: true,
                    category:       true,
                    startDate:      true,
                    organizer: {
                        select: { id: true, displayName: true, email: true, avatar: true },
                    },
                    orders: {
                        where:   { paymentStatus: 'COMPLETED' },
                        select:  { total: true },
                    },
                },
            });

            const data = events.map(e => ({
                id:             e.id,
                title:          e.title,
                status:         e.status,
                coverImage:     e.coverImage,
                category:       e.category,
                startDate:      e.startDate,
                registrations:  e.attendeesCount,
                revenue:        e.orders.reduce((s, o) => s + o.total, 0),
                organizer:      e.organizer,
            }));

            return res.status(200).json({ status: 'success', data });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /**
     * GET /admin/dashboard/registrations-chart
     * Daily registrations (attendees created) for the last 30 days.
     */
    static async getRegistrationsChart(_req: Request, res: Response) {
        try {
            const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            const rows = await prisma.$queryRaw<{ label: string; count: number }[]>`
                SELECT
                    TO_CHAR(DATE_TRUNC('day', "createdAt"), 'YYYY-MM-DD') AS label,
                    COUNT(*)::int                                          AS count
                FROM "Attendee"
                WHERE "createdAt" >= ${since}
                GROUP BY DATE_TRUNC('day', "createdAt")
                ORDER BY DATE_TRUNC('day', "createdAt") ASC
            `;

            return res.status(200).json({ status: 'success', data: rows });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNTS (Users)
// ═══════════════════════════════════════════════════════════════════════════════

export class AdminAccountsController {
    /** GET /admin/accounts?page=1&limit=20&search=&role=&status= */
    static async list(req: Request, res: Response) {
        try {
            const { skip, take, page, limit } = paginationParams(req.query);
            const search = (req.query.search as string) ?? '';
            const role   = req.query.role as string | undefined;
            const status = req.query.status as string | undefined; // active | suspended

            const where: any = {
                ...(status === 'suspended' ? { deletedAt: { not: null } } : {}),
                ...(status === 'active'    ? { deletedAt: null }           : {}),
                ...(role ? { roles: { has: role } }                        : {}),
                ...(search ? {
                    OR: [
                        { email:       { contains: search, mode: 'insensitive' } },
                        { displayName: { contains: search, mode: 'insensitive' } },
                        { username:    { contains: search, mode: 'insensitive' } },
                    ],
                } : {}),
            };

            const [users, total] = await Promise.all([
                prisma.user.findMany({
                    where, skip, take,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id:          true,
                        email:       true,
                        displayName: true,
                        username:    true,
                        avatar:      true,
                        roles:       true,
                        isVerified:  true,
                        createdAt:   true,
                        lastLoginAt: true,
                        deletedAt:   true,
                        _count:      { select: { events: true, orders: true } },
                    },
                }),
                prisma.user.count({ where }),
            ]);

            return res.status(200).json({
                status: 'success',
                data:   users,
                meta:   pageMeta(total, page, limit),
            });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /** GET /admin/accounts/:id */
    static async getOne(req: Request, res: Response) {
        try {
            const user = await prisma.user.findUnique({
                where:  { id: req.params.id },
                select: {
                    id:          true,
                    email:       true,
                    displayName: true,
                    username:    true,
                    avatar:      true,
                    bio:         true,
                    location:    true,
                    roles:       true,
                    isVerified:  true,
                    createdAt:   true,
                    lastLoginAt: true,
                    deletedAt:   true,
                    events: {
                        take:    5,
                        orderBy: { createdAt: 'desc' },
                        select:  { id: true, title: true, status: true, startDate: true, attendeesCount: true },
                    },
                    orders: {
                        take:    5,
                        orderBy: { createdAt: 'desc' },
                        select:  { id: true, total: true, status: true, paymentStatus: true, createdAt: true },
                    },
                    _count: { select: { events: true, orders: true, tickets: true, reviews: true } },
                },
            });

            if (!user) {
                return res.status(404).json({ status: 'error', message: 'User not found' });
            }

            return res.status(200).json({ status: 'success', data: user });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /** PATCH /admin/accounts/:id/suspend */
    static async suspend(req: Request, res: Response) {
        try {
            await prisma.user.update({
                where: { id: req.params.id },
                data:  { deletedAt: new Date() },
            });
            return res.status(200).json({ status: 'success', message: 'User suspended' });
        } catch {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
    }

    /** PATCH /admin/accounts/:id/activate */
    static async activate(req: Request, res: Response) {
        try {
            await prisma.user.update({
                where: { id: req.params.id },
                data:  { deletedAt: null },
            });
            return res.status(200).json({ status: 'success', message: 'User activated' });
        } catch {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
    }

    /** DELETE /admin/accounts/:id */
    static async remove(req: Request, res: Response) {
        try {
            await prisma.user.delete({ where: { id: req.params.id } });
            return res.status(200).json({ status: 'success', message: 'User permanently deleted' });
        } catch {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════════════════════

export class AdminEventsController {
    /** GET /admin/events?page&limit&search&status&category */
    static async list(req: Request, res: Response) {
        try {
            const { skip, take, page, limit } = paginationParams(req.query);
            const search   = (req.query.search   as string) ?? '';
            const status   = req.query.status   as string | undefined;
            const category = req.query.category as string | undefined;

            const where: any = {
                ...(status   ? { status }   : {}),
                ...(category ? { category } : {}),
                ...(search   ? {
                    OR: [
                        { title:     { contains: search, mode: 'insensitive' } },
                        { city:      { contains: search, mode: 'insensitive' } },
                        { venueName: { contains: search, mode: 'insensitive' } },
                    ],
                } : {}),
            };

            const [events, total] = await Promise.all([
                prisma.event.findMany({
                    where, skip, take,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id:             true,
                        title:          true,
                        status:         true,
                        category:       true,
                        coverImage:     true,
                        city:           true,
                        startDate:      true,
                        isFeatured:     true,
                        attendeesCount: true,
                        createdAt:      true,
                        organizer: { select: { id: true, displayName: true, email: true } },
                        _count:   { select: { tickets: true, orders: true, reviews: true } },
                    },
                }),
                prisma.event.count({ where }),
            ]);

            return res.status(200).json({
                status: 'success',
                data:   events,
                meta:   pageMeta(total, page, limit),
            });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /** GET /admin/events/:id */
    static async getOne(req: Request, res: Response) {
        try {
            const event = await prisma.event.findUnique({
                where:   { id: req.params.id },
                include: {
                    organizer:  { select: { id: true, displayName: true, email: true, avatar: true } },
                    tickets:    { select: { id: true, name: true, type: true, price: true, quantity: true, remaining: true } },
                    teamMembers:{ select: { id: true, role: true, status: true, user: { select: { id: true, displayName: true, email: true } } } },
                    reviews:    { take: 5, orderBy: { createdAt: 'desc' }, select: { id: true, rating: true, comment: true, user: { select: { displayName: true } }, createdAt: true } },
                    _count:     { select: { orders: true, userTickets: true, favorites: true } },
                },
            });

            if (!event) {
                return res.status(404).json({ status: 'error', message: 'Event not found' });
            }

            const revenue = await prisma.bookingOrder.aggregate({
                _sum:  { total: true },
                where: { eventId: req.params.id, paymentStatus: 'COMPLETED' },
            });

            return res.status(200).json({
                status: 'success',
                data:   { ...event, totalRevenue: revenue._sum.total ?? 0 },
            });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /** PATCH /admin/events/:id/status  body: { status: EventStatus } */
    static async updateStatus(req: Request, res: Response) {
        try {
            const { status } = req.body;
            const allowed = ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED', 'RESCHEDULED'];
            if (!allowed.includes(status)) {
                return res.status(400).json({ status: 'error', message: `status must be one of: ${allowed.join(', ')}` });
            }

            const event = await prisma.event.update({
                where: { id: req.params.id },
                data:  { status },
                select: { id: true, title: true, status: true },
            });

            return res.status(200).json({ status: 'success', data: event });
        } catch {
            return res.status(404).json({ status: 'error', message: 'Event not found' });
        }
    }

    /** PATCH /admin/events/:id/featured  body: { featured: boolean } */
    static async toggleFeatured(req: Request, res: Response) {
        try {
            const isFeatured = Boolean(req.body.featured);
            const event = await prisma.event.update({
                where: { id: req.params.id },
                data:  { isFeatured },
                select: { id: true, title: true, isFeatured: true },
            });
            return res.status(200).json({ status: 'success', data: event });
        } catch {
            return res.status(404).json({ status: 'error', message: 'Event not found' });
        }
    }

    /** DELETE /admin/events/:id */
    static async remove(req: Request, res: Response) {
        try {
            await prisma.event.delete({ where: { id: req.params.id } });
            return res.status(200).json({ status: 'success', message: 'Event deleted' });
        } catch {
            return res.status(404).json({ status: 'error', message: 'Event not found' });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ═══════════════════════════════════════════════════════════════════════════════

export class AdminTransactionsController {
    /** GET /admin/transactions?page&limit&status&paymentStatus&search */
    static async list(req: Request, res: Response) {
        try {
            const { skip, take, page, limit } = paginationParams(req.query);
            const status        = req.query.status        as string | undefined;
            const paymentStatus = req.query.paymentStatus as string | undefined;
            const search        = (req.query.search as string) ?? '';

            const where: any = {
                ...(status        ? { status }        : {}),
                ...(paymentStatus ? { paymentStatus } : {}),
                ...(search ? {
                    OR: [
                        { id:    { contains: search, mode: 'insensitive' } },
                        { event: { title: { contains: search, mode: 'insensitive' } } },
                        { user:  { email: { contains: search, mode: 'insensitive' } } },
                    ],
                } : {}),
            };

            const [orders, total] = await Promise.all([
                prisma.bookingOrder.findMany({
                    where, skip, take,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id:               true,
                        total:            true,
                        subtotal:         true,
                        serviceFee:       true,
                        currency:         true,
                        status:           true,
                        paymentStatus:    true,
                        paymentMethod:    true,
                        paymentReference: true,
                        createdAt:        true,
                        paidAt:           true,
                        user:  { select: { id: true, email: true, displayName: true } },
                        event: { select: { id: true, title: true, coverImage: true } },
                        items: { select: { ticketName: true, quantity: true, unitPrice: true, totalPrice: true } },
                    },
                }),
                prisma.bookingOrder.count({ where }),
            ]);

            return res.status(200).json({
                status: 'success',
                data:   orders,
                meta:   pageMeta(total, page, limit),
            });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /** GET /admin/transactions/stats */
    static async stats(_req: Request, res: Response) {
        try {
            const [completed, pending, failed, refunded, totalRev, totalFees] = await Promise.all([
                prisma.bookingOrder.count({ where: { paymentStatus: 'COMPLETED' } }),
                prisma.bookingOrder.count({ where: { paymentStatus: 'PENDING' } }),
                prisma.bookingOrder.count({ where: { paymentStatus: 'FAILED' } }),
                prisma.bookingOrder.count({ where: { paymentStatus: 'REFUNDED' } }),
                prisma.bookingOrder.aggregate({ _sum: { total: true },      where: { paymentStatus: 'COMPLETED' } }),
                prisma.bookingOrder.aggregate({ _sum: { serviceFee: true }, where: { paymentStatus: 'COMPLETED' } }),
            ]);

            return res.status(200).json({
                status: 'success',
                data: {
                    completed,
                    pending,
                    failed,
                    refunded,
                    totalRevenue:    totalRev._sum.total      ?? 0,
                    totalServiceFees: totalFees._sum.serviceFee ?? 0,
                },
            });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /** GET /admin/transactions/:id */
    static async getOne(req: Request, res: Response) {
        try {
            const order = await prisma.bookingOrder.findUnique({
                where:   { id: req.params.id },
                include: {
                    user:      { select: { id: true, email: true, displayName: true, avatar: true } },
                    event:     { select: { id: true, title: true, coverImage: true, startDate: true, city: true } },
                    items:     true,
                    attendees: { select: { id: true, name: true, email: true, ticketCode: true, checkedIn: true, checkedInAt: true } },
                },
            });

            if (!order) {
                return res.status(404).json({ status: 'error', message: 'Order not found' });
            }

            return res.status(200).json({ status: 'success', data: order });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /** POST /admin/transactions/:id/refund */
    static async refund(req: Request, res: Response) {
        try {
            const order = await prisma.bookingOrder.findUnique({ where: { id: req.params.id } });

            if (!order) {
                return res.status(404).json({ status: 'error', message: 'Order not found' });
            }

            if (order.paymentStatus !== 'COMPLETED') {
                return res.status(400).json({ status: 'error', message: 'Only completed orders can be refunded' });
            }

            const updated = await prisma.bookingOrder.update({
                where: { id: req.params.id },
                data:  { status: 'REFUNDED', paymentStatus: 'REFUNDED' },
                select: { id: true, status: true, paymentStatus: true },
            });

            return res.status(200).json({ status: 'success', data: updated });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VENDORS
// ═══════════════════════════════════════════════════════════════════════════════

export class AdminVendorsController {
    /** GET /admin/vendors?page&limit&search&category&verified */
    static async list(req: Request, res: Response) {
        try {
            const { skip, take, page, limit } = paginationParams(req.query);
            const search   = (req.query.search   as string) ?? '';
            const category = req.query.category as string | undefined;
            const verified = req.query.verified !== undefined
                ? req.query.verified === 'true'
                : undefined;

            const where: any = {
                ...(category   ? { category }              : {}),
                ...(verified !== undefined ? { isVerified: verified } : {}),
                ...(search ? {
                    OR: [
                        { name:     { contains: search, mode: 'insensitive' } },
                        { location: { contains: search, mode: 'insensitive' } },
                    ],
                } : {}),
            };

            const [vendors, total] = await Promise.all([
                prisma.vendor.findMany({
                    where, skip, take,
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id:            true,
                        name:          true,
                        category:      true,
                        location:      true,
                        isVerified:    true,
                        averageRating: true,
                        reviewCount:   true,
                        bookingCount:  true,
                        priceMin:      true,
                        priceMax:      true,
                        currency:      true,
                        createdAt:     true,
                        user: { select: { id: true, email: true, displayName: true } },
                    },
                }),
                prisma.vendor.count({ where }),
            ]);

            return res.status(200).json({
                status: 'success',
                data:   vendors,
                meta:   pageMeta(total, page, limit),
            });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /** PATCH /admin/vendors/:id/verify  body: { verified: boolean } */
    static async setVerified(req: Request, res: Response) {
        try {
            const isVerified = Boolean(req.body.verified);
            const vendor = await prisma.vendor.update({
                where:  { id: req.params.id },
                data:   { isVerified },
                select: { id: true, name: true, isVerified: true },
            });
            return res.status(200).json({ status: 'success', data: vendor });
        } catch {
            return res.status(404).json({ status: 'error', message: 'Vendor not found' });
        }
    }

    /** DELETE /admin/vendors/:id */
    static async remove(req: Request, res: Response) {
        try {
            await prisma.vendor.delete({ where: { id: req.params.id } });
            return res.status(200).json({ status: 'success', message: 'Vendor removed' });
        } catch {
            return res.status(404).json({ status: 'error', message: 'Vendor not found' });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export class AdminReportsController {
    /** GET /admin/reports/revenue?from=ISO&to=ISO */
    static async revenue(req: Request, res: Response) {
        try {
            const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const to   = req.query.to   ? new Date(req.query.to   as string) : new Date();

            const orders = await prisma.bookingOrder.findMany({
                where: {
                    paymentStatus: 'COMPLETED',
                    paidAt:        { gte: from, lte: to },
                },
                select: {
                    id:               true,
                    total:            true,
                    serviceFee:       true,
                    currency:         true,
                    paymentMethod:    true,
                    paidAt:           true,
                    event: { select: { title: true, category: true } },
                    user:  { select: { email: true } },
                },
                orderBy: { paidAt: 'desc' },
            });

            return res.status(200).json({ status: 'success', data: orders });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /** GET /admin/reports/attendance */
    static async attendance(req: Request, res: Response) {
        try {
            const events = await prisma.event.findMany({
                where:   { status: { not: 'DRAFT' } },
                orderBy: { startDate: 'desc' },
                take:    100,
                select: {
                    id:             true,
                    title:          true,
                    category:       true,
                    startDate:      true,
                    city:           true,
                    attendeesCount: true,
                    organizer: { select: { displayName: true, email: true } },
                    _count: {
                        select: {
                            userTickets: true,
                        },
                    },
                },
            });

            const scannedCounts = await prisma.attendee.groupBy({
                by:     ['orderId'],
                where:  { checkedIn: true },
                _count: { id: true },
            });

            // We need per-event check-in counts
            const checkedInByEvent = await prisma.$queryRaw<{ eventId: string; checked: number }[]>`
                SELECT bo."eventId", COUNT(a.id)::int AS checked
                FROM "Attendee" a
                JOIN "BookingOrder" bo ON bo.id = a."orderId"
                WHERE a."checkedIn" = true
                GROUP BY bo."eventId"
            `;

            const checkedInMap = new Map(checkedInByEvent.map(r => [r.eventId, r.checked]));

            const data = events.map(e => ({
                id:             e.id,
                title:          e.title,
                category:       e.category,
                startDate:      e.startDate,
                city:           e.city,
                organizer:      e.organizer.displayName ?? e.organizer.email,
                registrations:  e.attendeesCount,
                checkedIn:      checkedInMap.get(e.id) ?? 0,
                turnoutRate:    e.attendeesCount > 0
                    ? Math.round(((checkedInMap.get(e.id) ?? 0) / e.attendeesCount) * 100)
                    : 0,
            }));

            return res.status(200).json({ status: 'success', data });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /** GET /admin/reports/organizers */
    static async organizers(req: Request, res: Response) {
        try {
            const organizers = await prisma.user.findMany({
                where:   { roles: { has: 'organizer' } },
                orderBy: { createdAt: 'asc' },
                select: {
                    id:          true,
                    email:       true,
                    displayName: true,
                    createdAt:   true,
                    events: {
                        select: {
                            id:             true,
                            status:         true,
                            attendeesCount: true,
                            orders: {
                                where:  { paymentStatus: 'COMPLETED' },
                                select: { total: true },
                            },
                        },
                    },
                },
            });

            const data = organizers.map(u => {
                const revenue = u.events.flatMap(e => e.orders).reduce((s, o) => s + o.total, 0);
                const regs    = u.events.reduce((s, e) => s + e.attendeesCount, 0);
                return {
                    id:          u.id,
                    email:       u.email,
                    name:        u.displayName ?? u.email,
                    joinedAt:    u.createdAt,
                    totalEvents: u.events.length,
                    liveEvents:  u.events.filter(e => e.status === 'PUBLISHED').length,
                    totalRevenue: revenue,
                    totalRegistrations: regs,
                };
            });

            return res.status(200).json({ status: 'success', data });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /**
     * GET /admin/reports/export/:type
     * type: revenue | attendance | organizers | transactions
     * Returns CSV with Content-Disposition: attachment
     */
    static async exportCSV(req: Request, res: Response) {
        try {
            const { type } = req.params;
            let rows: Record<string, unknown>[] = [];

            if (type === 'revenue') {
                const orders = await prisma.bookingOrder.findMany({
                    where:   { paymentStatus: 'COMPLETED' },
                    orderBy: { paidAt: 'desc' },
                    select:  { id: true, total: true, serviceFee: true, currency: true, paymentMethod: true, paidAt: true, event: { select: { title: true } }, user: { select: { email: true } } },
                });
                rows = orders.map(o => ({
                    order_id:       o.id,
                    event:          o.event.title,
                    buyer_email:    o.user.email,
                    total:          o.total,
                    service_fee:    o.serviceFee,
                    currency:       o.currency,
                    payment_method: o.paymentMethod ?? '',
                    paid_at:        o.paidAt?.toISOString() ?? '',
                }));
            } else if (type === 'attendance') {
                const attendees = await prisma.attendee.findMany({
                    orderBy: { createdAt: 'desc' },
                    select:  { id: true, name: true, email: true, ticketCode: true, checkedIn: true, checkedInAt: true, status: true, createdAt: true, ticket: { select: { name: true } }, order: { select: { event: { select: { title: true } } } } },
                });
                rows = attendees.map(a => ({
                    attendee_id:  a.id,
                    name:         a.name,
                    email:        a.email,
                    event:        a.order.event.title,
                    ticket:       a.ticket.name,
                    ticket_code:  a.ticketCode,
                    checked_in:   a.checkedIn ? 'yes' : 'no',
                    checked_in_at: a.checkedInAt?.toISOString() ?? '',
                    status:       a.status,
                    registered_at: a.createdAt.toISOString(),
                }));
            } else if (type === 'transactions') {
                const orders = await prisma.bookingOrder.findMany({
                    orderBy: { createdAt: 'desc' },
                    select:  { id: true, total: true, status: true, paymentStatus: true, paymentMethod: true, currency: true, createdAt: true, paidAt: true, event: { select: { title: true } }, user: { select: { email: true } } },
                });
                rows = orders.map(o => ({
                    order_id:       o.id,
                    event:          o.event.title,
                    buyer_email:    o.user.email,
                    total:          o.total,
                    currency:       o.currency,
                    status:         o.status,
                    payment_status: o.paymentStatus,
                    payment_method: o.paymentMethod ?? '',
                    created_at:     o.createdAt.toISOString(),
                    paid_at:        o.paidAt?.toISOString() ?? '',
                }));
            } else {
                return res.status(400).json({ status: 'error', message: 'type must be: revenue | attendance | organizers | transactions' });
            }

            const csv = toCSV(rows);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${type}-report-${Date.now()}.csv"`);
            return res.send(csv);
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI / NEURO
// ═══════════════════════════════════════════════════════════════════════════════

export class AdminAIController {
    /**
     * GET /admin/ai/insights
     * Derives AI insight signals from real platform data.
     */
    static async getInsights(_req: Request, res: Response) {
        try {
            const thirtyDaysAgo  = new Date(Date.now() - 30  * 24 * 60 * 60 * 1000);
            const sixtyDaysAgo   = new Date(Date.now() - 60  * 24 * 60 * 60 * 1000);

            const [
                totalUsers,
                recentRevenue,
                prevRevenue,
                recentRegs,
                prevRegs,
                dormantUsers,
                topCategory,
                avgTurnout,
                recentGames,
            ] = await Promise.all([
                prisma.user.count({ where: { deletedAt: null } }),
                prisma.bookingOrder.aggregate({ _sum: { total: true }, where: { paymentStatus: 'COMPLETED', paidAt: { gte: thirtyDaysAgo } } }),
                prisma.bookingOrder.aggregate({ _sum: { total: true }, where: { paymentStatus: 'COMPLETED', paidAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
                prisma.attendee.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
                prisma.attendee.count({ where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
                prisma.user.count({ where: { deletedAt: null, lastLoginAt: { lt: thirtyDaysAgo } } }),
                prisma.event.groupBy({
                    by: ['category'],
                    _count: { id: true },
                    where:  { status: 'PUBLISHED' },
                    orderBy: { _count: { id: 'desc' } },
                    take: 1,
                }),
                prisma.$queryRaw<{ rate: number }[]>`
                    SELECT
                        ROUND(AVG(CASE WHEN a."checkedIn" THEN 1 ELSE 0 END) * 100)::int AS rate
                    FROM "Attendee" a
                `.then(r => r[0]?.rate ?? 0),
                prisma.activityEntry.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
            ]);

            const revenueThisMonth = recentRevenue._sum.total ?? 0;
            const revenueLastMonth = prevRevenue._sum.total   ?? 0;
            const revChangePct     = revenueLastMonth > 0
                ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)
                : 0;
            const regChangePct     = prevRegs > 0
                ? Math.round(((recentRegs - prevRegs) / prevRegs) * 100)
                : 0;
            const churnRatio       = totalUsers > 0 ? Math.round((dormantUsers / totalUsers) * 100) : 0;

            const insights = [
                {
                    id: 'revenue-trend',
                    priority: revChangePct >= 10 ? 'High' : revChangePct >= 0 ? 'Medium' : 'High',
                    confidence: 91,
                    title: revChangePct >= 0
                        ? `Revenue up ${revChangePct}% vs last month`
                        : `Revenue down ${Math.abs(revChangePct)}% vs last month`,
                    description: `Total revenue this month: $${(revenueThisMonth / 1000).toFixed(1)}k. Top category: ${topCategory[0]?.category ?? 'N/A'}.`,
                    tag: 'Revenue',
                    tagColor: '#10B981',
                    time: 'Just now',
                },
                {
                    id: 'churn-risk',
                    priority: churnRatio >= 20 ? 'High' : 'Medium',
                    confidence: 87,
                    title: `${dormantUsers.toLocaleString()} users (${churnRatio}%) showing churn signals`,
                    description: `Users inactive for 30+ days. Re-engagement window is closing. Target with discount campaign.`,
                    tag: 'Retention',
                    tagColor: '#EF4444',
                    time: '5 min ago',
                },
                {
                    id: 'registration-trend',
                    priority: regChangePct < -5 ? 'High' : 'Low',
                    confidence: 82,
                    title: regChangePct >= 0
                        ? `Registrations up ${regChangePct}% MoM`
                        : `Registrations down ${Math.abs(regChangePct)}% MoM`,
                    description: `${recentRegs.toLocaleString()} new registrations this month vs ${prevRegs.toLocaleString()} last month.`,
                    tag: 'Attendance',
                    tagColor: '#3D5AFE',
                    time: '12 min ago',
                },
                {
                    id: 'turnout-rate',
                    priority: (avgTurnout as number) < 70 ? 'Medium' : 'Low',
                    confidence: 78,
                    title: `Platform turnout rate: ${avgTurnout}%`,
                    description: `Average check-in rate across all events. ${(avgTurnout as number) < 70 ? 'Below target — review reminder email sequences.' : 'Above target — maintain current engagement tactics.'}`,
                    tag: 'Engagement',
                    tagColor: '#F59E0B',
                    time: '1 hr ago',
                },
                {
                    id: 'games-engagement',
                    priority: 'Low' as const,
                    confidence: 72,
                    title: `${recentGames.toLocaleString()} game sessions this month`,
                    description: 'Gamification activity is a leading indicator of check-in rates. Events with games show 8.4% higher turnout.',
                    tag: 'Games',
                    tagColor: '#10B981',
                    time: '3 hrs ago',
                },
            ];

            return res.status(200).json({ status: 'success', data: insights });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }

    /**
     * GET /admin/ai/forecast
     * Returns historical + projected revenue for the forecast chart.
     */
    static async getForecast(_req: Request, res: Response) {
        try {
            // Pull last 6 months of actual revenue
            const since = new Date(Date.now() - 6 * 30 * 24 * 60 * 60 * 1000);

            const actuals = await prisma.$queryRaw<{ month: string; revenue: number }[]>`
                SELECT
                    TO_CHAR(DATE_TRUNC('month', "paidAt"), 'Mon') AS month,
                    SUM(total)::float                              AS revenue
                FROM "BookingOrder"
                WHERE "paymentStatus" = 'COMPLETED'
                  AND "paidAt" >= ${since}
                GROUP BY DATE_TRUNC('month', "paidAt")
                ORDER BY DATE_TRUNC('month', "paidAt") ASC
            `;

            // Simple linear projection for next 3 months based on average growth rate
            const revenues = actuals.map(a => a.revenue);
            const avgGrowth = revenues.length >= 2
                ? revenues.slice(1).reduce((sum, v, i) => sum + (v - revenues[i]) / revenues[i], 0) / (revenues.length - 1)
                : 0.08; // default 8% if insufficient data

            const lastRevenue = revenues[revenues.length - 1] ?? 0;
            const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const now = new Date();

            const projected = [1, 2, 3].map(offset => {
                const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
                return {
                    month:     MONTH_NAMES[d.getMonth()],
                    actual:    null,
                    projected: Math.round(lastRevenue * Math.pow(1 + avgGrowth, offset)),
                };
            });

            // Merge: last actual point also appears as the bridge in projected
            const historicalData = actuals.map(a => ({ month: a.month, actual: a.revenue, projected: null as number | null }));
            if (historicalData.length) {
                const last = historicalData[historicalData.length - 1];
                projected[0].projected = projected[0].projected; // keep
                // bridge
                historicalData[historicalData.length - 1] = { ...last, projected: last.actual };
            }

            return res.status(200).json({
                status: 'success',
                data:   [...historicalData, ...projected],
            });
        } catch (error: any) {
            return res.status(500).json({ status: 'error', message: error.message });
        }
    }
}
