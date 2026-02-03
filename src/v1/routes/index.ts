import { Router } from 'express';
import authRoutes from './auth.routes';
import eventRoutes from './event.routes';
import userRoutes from './user.routes';
import bookingRoutes from './booking.routes';
import ticketRoutes from './ticket.routes';
import manageRoutes from './manage.routes';
import chatRoutes from './chat.routes';
import { BookingController } from '../controllers/booking.controller';
import { ManageController } from '../controllers/manage.controller';
import { ChatController } from '../controllers/chat.controller';
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

// User search (for team member addition)
router.get('/users/search', ManageController.searchUsers);

// User event chats
router.get('/user/event-chats', authenticate, ChatController.getUserEventChats);

// Webhook (no auth required)
router.post('/webhooks/payment', BookingController.paymentWebhook);

export default router;
