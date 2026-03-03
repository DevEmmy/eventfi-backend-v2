import { Router } from 'express';
import { VendorController } from '../controllers/vendor.controller';
import { authenticate, optionalAuth } from '../middlewares/auth.middleware';

const router = Router();

// Public routes
router.get('/', VendorController.list);

// Authenticated routes (must come before /:id to avoid conflicts)
router.get('/me', authenticate, VendorController.getMyProfile);
router.get('/me/bookings', authenticate, VendorController.getMyBookings);
router.post('/', authenticate, VendorController.create);

// Booking status management
router.patch('/bookings/:bookingId/status', authenticate, VendorController.updateBookingStatus);

// Vendor-specific routes
router.get('/:id', VendorController.getById);
router.patch('/:id', authenticate, VendorController.update);
router.delete('/:id', authenticate, VendorController.delete);

// Reviews
router.get('/:id/reviews', VendorController.getReviews);
router.post('/:id/reviews', authenticate, VendorController.createReview);

// Bookings
router.post('/:id/bookings', authenticate, VendorController.createBooking);
router.get('/:id/bookings', authenticate, VendorController.getVendorBookings);

export default router;
