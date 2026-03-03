import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

router.get('/', authenticate, NotificationController.getNotifications);
router.get('/unread-count', authenticate, NotificationController.getUnreadCount);
router.patch('/read-all', authenticate, NotificationController.markAllAsRead);
router.patch('/:id/read', authenticate, NotificationController.markAsRead);
router.delete('/:id', authenticate, NotificationController.deleteNotification);

export default router;
