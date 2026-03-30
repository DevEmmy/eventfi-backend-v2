import { prisma } from '../config/database';
import { ActivityType, ActivityStatus, OrderStatus } from '@prisma/client';

export class ActivityService {
    // Create a new activity for an event (organizer only)
    static async create(eventId: string, userId: string, type: ActivityType, config: Record<string, any> = {}) {
        // Verify user is organizer of this event
        const event = await prisma.event.findUnique({ where: { id: eventId } });
        if (!event) throw new Error('Event not found');
        if (event.organizerId !== userId) throw new Error('Unauthorized');

        // Only one active activity per event at a time
        const existing = await prisma.eventActivity.findFirst({
            where: { eventId, status: ActivityStatus.ACTIVE }
        });
        if (existing) throw new Error('Another activity is already active');

        return prisma.eventActivity.create({
            data: { eventId, type, config, createdBy: userId, status: ActivityStatus.IDLE },
            include: { entries: true }
        });
    }

    // Start an activity (set to ACTIVE)
    static async start(activityId: string, userId: string) {
        const activity = await prisma.eventActivity.findUnique({
            where: { id: activityId },
            include: { event: true }
        });
        if (!activity) throw new Error('Activity not found');
        if (activity.event.organizerId !== userId) throw new Error('Unauthorized');
        if (activity.status === ActivityStatus.ENDED) throw new Error('Activity already ended');

        return prisma.eventActivity.update({
            where: { id: activityId },
            data: { status: ActivityStatus.ACTIVE },
            include: { entries: true }
        });
    }

    // End an activity and compute results
    static async end(activityId: string, userId: string) {
        const activity = await prisma.eventActivity.findUnique({
            where: { id: activityId },
            include: { event: true, entries: { include: { activity: false } } }
        });
        if (!activity) throw new Error('Activity not found');
        if (activity.event.organizerId !== userId) throw new Error('Unauthorized');

        let results: Record<string, any> = {};

        if (activity.type === ActivityType.LUCKY_DRAW) {
            results = activity.results as Record<string, any> || {};
        } else if (activity.type === ActivityType.APPLAUSE_METER) {
            // Sum all taps
            const totalTaps = activity.entries.reduce((sum, e) => {
                const resp = e.response as any;
                return sum + (resp?.taps || 1);
            }, 0);
            results = { totalTaps, participantCount: activity.entries.length };
        }

        return prisma.eventActivity.update({
            where: { id: activityId },
            data: { status: ActivityStatus.ENDED, results },
            include: { entries: true }
        });
    }

    // Perform a lucky draw - pick random winner(s) from registered attendees
    static async draw(activityId: string, userId: string) {
        const activity = await prisma.eventActivity.findUnique({
            where: { id: activityId },
            include: { event: true }
        });
        if (!activity) throw new Error('Activity not found');
        if (activity.event.organizerId !== userId) throw new Error('Unauthorized');
        if (activity.type !== ActivityType.LUCKY_DRAW) throw new Error('Not a lucky draw');
        if (activity.status !== ActivityStatus.ACTIVE) throw new Error('Activity not active');

        const config = activity.config as any;
        const winnersCount = config?.winnersCount || 1;

        // Get all registered attendees via confirmed booking orders
        const orders = await prisma.bookingOrder.findMany({
            where: { eventId: activity.eventId, status: OrderStatus.CONFIRMED },
            include: {
                user: { select: { id: true, displayName: true, username: true, avatar: true, email: true } }
            },
            distinct: ['userId']
        });

        if (orders.length === 0) throw new Error('No registered attendees');

        // Shuffle and pick winners
        const shuffled = orders.sort(() => Math.random() - 0.5);
        const winners = shuffled.slice(0, Math.min(winnersCount, shuffled.length)).map(o => ({
            userId: o.user.id,
            name: o.user.displayName || o.user.username || o.user.email,
            avatar: o.user.avatar,
            username: o.user.username,
        }));

        // Store results
        const updated = await prisma.eventActivity.update({
            where: { id: activityId },
            data: { results: { winners, drawnAt: new Date().toISOString(), totalPool: orders.length } }
        });

        return { winners, totalPool: orders.length, activity: updated };
    }

    // Record an applause tap from an attendee — returns totals + top-5 leaderboard
    static async tap(activityId: string, userId: string) {
        const activity = await prisma.eventActivity.findUnique({
            where: { id: activityId },
            include: { event: false }
        });
        if (!activity) throw new Error('Activity not found');
        if (activity.type !== ActivityType.APPLAUSE_METER) throw new Error('Not an applause meter');
        if (activity.status !== ActivityStatus.ACTIVE) throw new Error('Activity not active');

        // Upsert entry — increment tap count for this user
        const existing = await prisma.activityEntry.findUnique({
            where: { activityId_userId: { activityId, userId } }
        });

        let myTaps: number;
        if (existing) {
            const resp = existing.response as any;
            myTaps = (resp?.taps || 1) + 1;
            await prisma.activityEntry.update({
                where: { id: existing.id },
                data: { response: { taps: myTaps } }
            });
        } else {
            myTaps = 1;
            await prisma.activityEntry.create({
                data: { activityId, userId, response: { taps: 1 } }
            });
        }

        // Fetch all entries with user info for leaderboard
        const entries = await prisma.activityEntry.findMany({
            where: { activityId },
            include: {
                user: { select: { id: true, displayName: true, username: true, avatar: true } }
            }
        });

        const totalTaps = entries.reduce((sum, e) => {
            const r = e.response as any;
            return sum + (r?.taps || 1);
        }, 0);

        // Top-5 sorted by taps descending
        const leaderboard = entries
            .map(e => ({
                userId: e.userId,
                name: e.user.displayName || e.user.username || 'User',
                avatar: e.user.avatar,
                taps: (e.response as any)?.taps || 1,
            }))
            .sort((a, b) => b.taps - a.taps)
            .slice(0, 5);

        return { totalTaps, participantCount: entries.length, myTaps, leaderboard };
    }

    // Get activity by id
    static async getById(activityId: string) {
        return prisma.eventActivity.findUnique({
            where: { id: activityId },
            include: { entries: { include: { activity: false } } }
        });
    }

    // Get all activities for an event
    static async getByEvent(eventId: string) {
        return prisma.eventActivity.findMany({
            where: { eventId },
            orderBy: { createdAt: 'desc' }
        });
    }

    // Get active activity for an event
    static async getActive(eventId: string) {
        return prisma.eventActivity.findFirst({
            where: { eventId, status: ActivityStatus.ACTIVE }
        });
    }
}
