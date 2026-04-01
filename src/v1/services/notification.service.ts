import { prisma } from '../config/database';
import { NotificationType } from '@prisma/client';
import { getIO } from '../websocket/socket.instance';

export class NotificationService {
    /**
     * Create a notification for a user
     */
    private static pushToSocket(userId: string, notification: any) {
        try {
            const io = getIO();
            if (io) {
                io.to(`notification:${userId}`).emit('notification:new', {
                    id: notification.id,
                    type: notification.type.toLowerCase(),
                    title: notification.title,
                    message: notification.message,
                    read: notification.read,
                    actionUrl: notification.actionUrl,
                    metadata: notification.metadata,
                    createdAt: notification.createdAt.toISOString(),
                });
            }
        } catch {
            // Non-critical — DB write already succeeded
        }
    }

    static async create(data: {
        userId: string;
        type: NotificationType;
        title: string;
        message: string;
        actionUrl?: string;
        metadata?: Record<string, any>;
    }) {
        const notification = await prisma.notification.create({
            data: {
                userId: data.userId,
                type: data.type,
                title: data.title,
                message: data.message,
                actionUrl: data.actionUrl,
                metadata: data.metadata || undefined,
            },
        });

        this.pushToSocket(data.userId, notification);
        return notification;
    }

    /**
     * Create notifications for multiple users and push real-time socket events
     */
    static async createBulk(
        userIds: string[],
        data: {
            type: NotificationType;
            title: string;
            message: string;
            actionUrl?: string;
            metadata?: Record<string, any>;
        }
    ) {
        const result = await prisma.notification.createMany({
            data: userIds.map((userId) => ({
                userId,
                type: data.type,
                title: data.title,
                message: data.message,
                actionUrl: data.actionUrl,
                metadata: data.metadata || undefined,
            })),
        });

        // Push real-time socket events to each user
        try {
            const io = getIO();
            if (io) {
                const payload = {
                    type: data.type.toLowerCase(),
                    title: data.title,
                    message: data.message,
                    read: false,
                    actionUrl: data.actionUrl,
                    metadata: data.metadata,
                    createdAt: new Date().toISOString(),
                };
                for (const userId of userIds) {
                    io.to(`notification:${userId}`).emit('notification:new', payload);
                }
            }
        } catch {
            // Non-critical — DB writes already succeeded
        }

        return result;
    }

    /**
     * Get notifications for a user (paginated)
     */
    static async getUserNotifications(
        userId: string,
        options: { limit?: number; before?: string; unreadOnly?: boolean; type?: string }
    ) {
        const { limit = 20, before, unreadOnly, type } = options;

        const where: any = { userId };
        if (unreadOnly) where.read = false;
        if (type) where.type = type;
        if (before) where.createdAt = { lt: new Date(before) };

        const notifications = await prisma.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit + 1,
        });

        const hasMore = notifications.length > limit;
        if (hasMore) notifications.pop();

        return {
            notifications: notifications.map((n) => ({
                id: n.id,
                type: n.type.toLowerCase(),
                title: n.title,
                message: n.message,
                read: n.read,
                actionUrl: n.actionUrl,
                metadata: n.metadata,
                createdAt: n.createdAt.toISOString(),
            })),
            hasMore,
        };
    }

    /**
     * Get unread notification count
     */
    static async getUnreadCount(userId: string) {
        return prisma.notification.count({
            where: { userId, read: false },
        });
    }

    /**
     * Mark a notification as read
     */
    static async markAsRead(notificationId: string, userId: string) {
        const notification = await prisma.notification.findUnique({
            where: { id: notificationId },
        });

        if (!notification) throw new Error('Notification not found');
        if (notification.userId !== userId) throw new Error('Unauthorized');

        return prisma.notification.update({
            where: { id: notificationId },
            data: { read: true },
        });
    }

    /**
     * Mark all notifications as read
     */
    static async markAllAsRead(userId: string) {
        const result = await prisma.notification.updateMany({
            where: { userId, read: false },
            data: { read: true },
        });
        return { count: result.count };
    }

    /**
     * Delete a notification
     */
    static async delete(notificationId: string, userId: string) {
        const notification = await prisma.notification.findUnique({
            where: { id: notificationId },
        });

        if (!notification) throw new Error('Notification not found');
        if (notification.userId !== userId) throw new Error('Unauthorized');

        return prisma.notification.delete({
            where: { id: notificationId },
        });
    }
}
