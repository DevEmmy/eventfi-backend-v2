import { Request, Response } from 'express';
import { NotificationService } from '../services/notification.service';

export class NotificationController {
    /**
     * GET /notifications - Get user's notifications
     */
    static async getNotifications(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const limit = parseInt(req.query.limit as string) || 20;
            const before = req.query.before as string;
            const unreadOnly = req.query.unread === 'true';
            const type = req.query.type as string;

            const data = await NotificationService.getUserNotifications(userId, {
                limit,
                before,
                unreadOnly,
                type,
            });

            return res.status(200).json({
                status: 'success',
                data,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to get notifications',
            });
        }
    }

    /**
     * GET /notifications/unread-count - Get unread count
     */
    static async getUnreadCount(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const count = await NotificationService.getUnreadCount(userId);

            return res.status(200).json({
                status: 'success',
                data: { count },
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to get unread count',
            });
        }
    }

    /**
     * PATCH /notifications/:id/read - Mark as read
     */
    static async markAsRead(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { id } = req.params;

            await NotificationService.markAsRead(id, userId);

            return res.status(200).json({
                status: 'success',
                message: 'Notification marked as read',
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to mark notification',
            });
        }
    }

    /**
     * PATCH /notifications/read-all - Mark all as read
     */
    static async markAllAsRead(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const result = await NotificationService.markAllAsRead(userId);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to mark all as read',
            });
        }
    }

    /**
     * DELETE /notifications/:id - Delete notification
     */
    static async deleteNotification(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { id } = req.params;

            await NotificationService.delete(id, userId);

            return res.status(200).json({
                status: 'success',
                message: 'Notification deleted',
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to delete notification',
            });
        }
    }
}
