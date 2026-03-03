import { Router } from 'express';
import { BookingController } from '../controllers/booking.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
    initiateBookingSchema,
    updateAttendeesSchema,
    applyPromoSchema,
    initializePaymentSchema,
    confirmOrderSchema,
} from '../validations/booking.schema';

const router = Router();

// Booking order endpoints
router.post('/initiate', authenticate, validate(initiateBookingSchema), BookingController.initiateOrder);
router.get('/:orderId', authenticate, BookingController.getOrder);
router.patch('/:orderId/attendees', authenticate, validate(updateAttendeesSchema), BookingController.updateAttendees);
router.post('/:orderId/promo', authenticate, validate(applyPromoSchema), BookingController.applyPromoCode);
router.delete('/:orderId', authenticate, BookingController.cancelOrder);

// Payment endpoints
router.post('/:orderId/pay', authenticate, validate(initializePaymentSchema), BookingController.initializePayment);
router.post('/:orderId/confirm', authenticate, validate(confirmOrderSchema), BookingController.confirmOrder);

export default router;
