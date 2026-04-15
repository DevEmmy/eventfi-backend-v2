import { Router } from 'express';
import authRoutes from './auth.routes';
import eventRoutes from './event.routes';
import userRoutes from './user.routes';
import bookingRoutes from './booking.routes';
import ticketRoutes from './ticket.routes';
import manageRoutes from './manage.routes';
import chatRoutes from './chat.routes';
import activityRoutes from './activity.routes';
import notificationRoutes from './notification.routes';
import vendorRoutes from './vendor.routes';
import adminRoutes from './admin.routes';
import { BookingController } from '../controllers/booking.controller';
import { ManageController } from '../controllers/manage.controller';
import { ChatController } from '../controllers/chat.controller';
import { AIController, aiUploadMiddleware } from '../controllers/ai.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

router.use('/auth', authRoutes);
router.use('/events', eventRoutes);
router.use('/users', userRoutes);
router.use('/bookings', bookingRoutes);
router.use('/tickets', ticketRoutes);

// Manage routes (under /events for REST compliance)
router.use('/events', manageRoutes);

// Chat routes (under /events for REST compliance)
router.use('/events', chatRoutes);

// Activity / Game routes (under /events for REST compliance)
router.use('/events', activityRoutes);

// Notification routes
router.use('/notifications', notificationRoutes);

// Vendor/Marketplace routes
router.use('/vendors', vendorRoutes);

// Team invitation acceptance
router.post('/team/accept', authenticate, ManageController.acceptTeamInvitation);

// AI event generation (accepts text, image, PDF, DOCX)
router.post('/ai/generate-event', authenticate, aiUploadMiddleware, AIController.generateEvent);

// User event chats
router.get('/user/event-chats', authenticate, ChatController.getUserEventChats);

// Webhook (no auth required)
router.post('/webhooks/payment', BookingController.paymentWebhook);

// Admin routes
router.use('/admin', adminRoutes);

export default router;
