import cron from 'node-cron';
import { prisma } from '../config/database';
import { NotificationService } from '../services/notification.service';

/**
 * Returns a time window [from, to] for "target duration from now".
 * Window is ±10 min to handle scheduling drift.
 */
function timeWindow(targetMs: number): { from: Date; to: Date } {
    const WINDOW_MS = 10 * 60 * 1000; // ±10 minutes
    const now = Date.now();
    return {
        from: new Date(now + targetMs - WINDOW_MS),
        to: new Date(now + targetMs + WINDOW_MS),
    };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

type ReminderType = '7d' | '1d' | '1h';

/**
 * For a given event and set of user IDs, find which users have NOT yet
 * received a reminder of the given type (deduplication check).
 */
async function filterAlreadyNotified(
    eventId: string,
    userIds: string[],
    reminderType: ReminderType
): Promise<string[]> {
    // Find notifications already sent for this event+reminderType combo
    const existing = await prisma.notification.findMany({
        where: {
            userId: { in: userIds },
            type: 'EVENT_REMINDER',
            metadata: {
                path: ['eventId'],
                equals: eventId,
            },
        },
        select: { userId: true, metadata: true },
    });

    const alreadySent = new Set(
        existing
            .filter((n: any) => n.metadata?.reminderType === reminderType)
            .map((n: any) => n.userId)
    );

    return userIds.filter((id) => !alreadySent.has(id));
}

/**
 * Find events in the given time window and send reminder notifications
 * to all users with confirmed bookings.
 */
async function sendReminders(reminderType: ReminderType, targetMs: number) {
    const { from, to } = timeWindow(targetMs);

    // Find PUBLIC events starting in this window
    const events = await prisma.event.findMany({
        where: {
            startDate: { gte: from, lte: to },
        },
        select: {
            id: true,
            title: true,
            startDate: true,
            startTime: true,
            venueName: true,
            city: true,
        },
    });

    if (events.length === 0) return;

    for (const event of events) {
        // Get all users with confirmed bookings for this event
        const orders = await prisma.bookingOrder.findMany({
            where: { eventId: event.id, status: 'CONFIRMED' },
            select: { userId: true },
            distinct: ['userId'],
        });

        if (orders.length === 0) continue;

        const allUserIds = orders.map((o: any) => o.userId);
        const userIds = await filterAlreadyNotified(event.id, allUserIds, reminderType);

        if (userIds.length === 0) continue;

        const eventDate = new Date(event.startDate).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric',
        });
        const timeStr = event.startTime || '';
        const venue = event.venueName || event.city || 'the venue';

        const labelMap: Record<ReminderType, string> = {
            '7d': 'in 7 days',
            '1d': 'tomorrow',
            '1h': 'in 1 hour',
        };

        await NotificationService.createBulk(userIds, {
            type: 'EVENT_REMINDER',
            title: `Reminder: ${event.title} is ${labelMap[reminderType]}!`,
            message: `Your event starts ${labelMap[reminderType]} on ${eventDate}${timeStr ? ` at ${timeStr}` : ''} at ${venue}. Get ready!`,
            actionUrl: `/events/${event.id}`,
            metadata: { eventId: event.id, reminderType },
        });

        console.log(
            `[Reminder] Sent ${reminderType} reminders for "${event.title}" to ${userIds.length} user(s)`
        );
    }
}

/**
 * Start all reminder cron jobs.
 * Call this once from index.ts after the server starts.
 */
export function startReminderScheduler() {
    // 7-day reminders — run every hour
    cron.schedule('0 * * * *', async () => {
        try {
            await sendReminders('7d', SEVEN_DAYS_MS);
        } catch (err) {
            console.error('[Reminder] 7-day job error:', err);
        }
    });

    // 1-day reminders — run every hour
    cron.schedule('0 * * * *', async () => {
        try {
            await sendReminders('1d', ONE_DAY_MS);
        } catch (err) {
            console.error('[Reminder] 1-day job error:', err);
        }
    });

    // 1-hour reminders — run every 15 minutes for better precision
    cron.schedule('*/15 * * * *', async () => {
        try {
            await sendReminders('1h', ONE_HOUR_MS);
        } catch (err) {
            console.error('[Reminder] 1-hour job error:', err);
        }
    });

    console.log('⏰ Event reminder scheduler started (7d/1d reminders: hourly | 1h reminders: every 15 min)');
}
