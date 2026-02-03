import { Router } from 'express';
import { BookingController } from '../controllers/booking.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Booking order endpoints
router.post('/initiate', authenticate, BookingController.initiateOrder);
router.get('/:orderId', authenticate, BookingController.getOrder);
router.patch('/:orderId/attendees', authenticate, BookingController.updateAttendees);
router.post('/:orderId/promo', authenticate, BookingController.applyPromoCode);
router.delete('/:orderId', authenticate, BookingController.cancelOrder);

// Payment endpoints
router.post('/:orderId/pay', authenticate, BookingController.initializePayment);
router.post('/:orderId/confirm', authenticate, BookingController.confirmOrder);

export default router;
