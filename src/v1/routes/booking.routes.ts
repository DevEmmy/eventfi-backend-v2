import { Router } from 'express';
import { BookingController } from '../controllers/booking.controller';
import { authenticate, optionalAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
    initiateBookingSchema,
    updateAttendeesSchema,
    applyPromoSchema,
    initializePaymentSchema,
    confirmOrderSchema,
} from '../validations/booking.schema';

const router = Router();

// Booking order endpoints — optionalAuth so guests can book without an account
router.post('/initiate', optionalAuth, validate(initiateBookingSchema), BookingController.initiateOrder);
router.get('/:orderId', optionalAuth, BookingController.getOrder);
router.patch('/:orderId/attendees', optionalAuth, validate(updateAttendeesSchema), BookingController.updateAttendees);
router.post('/:orderId/promo', optionalAuth, validate(applyPromoSchema), BookingController.applyPromoCode);
router.delete('/:orderId', optionalAuth, BookingController.cancelOrder);

// Payment endpoints
router.post('/:orderId/pay', optionalAuth, validate(initializePaymentSchema), BookingController.initializePayment);
router.post('/:orderId/confirm', optionalAuth, validate(confirmOrderSchema), BookingController.confirmOrder);

export default router;
