import { Router } from 'express';
import { BookingController } from '../controllers/booking.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Ticket routes
router.get('/:ticketId', authenticate, BookingController.getTicketDetails);

export default router;
