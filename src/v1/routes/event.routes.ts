import { Router } from 'express';
import { EventController } from '../controllers/event.controller';
import { ReviewController } from '../controllers/review.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { BookingService } from '../services/booking.service';

const router = Router();

router.post('/', authenticate, EventController.create);
router.get('/', EventController.findAll);

// Specific routes before parameterized routes
router.get('/recommendations', authenticate, EventController.getRecommendations);
router.get('/trending', EventController.getTrending);

// Event detail routes
router.get('/:id', EventController.findOne);
router.patch('/:id', authenticate, EventController.update);
router.delete('/:id', authenticate, EventController.delete);

// Related events
router.get('/:id/related', EventController.getRelated);

// Tickets - availability endpoints (no auth required)
router.get('/:id/tickets', async (req, res) => {
    try {
        const tickets = await BookingService.getEventTickets(req.params.id);
        res.json({ status: 'success', data: tickets });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});
router.get('/:id/tickets/availability', async (req, res) => {
    try {
        const availability = await BookingService.checkAvailability(req.params.id);
        res.json({ status: 'success', data: availability });
    } catch (error: any) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Reviews
router.get('/:id/reviews', ReviewController.getReviews);
router.get('/:id/reviews/stats', ReviewController.getStats);
router.post('/:id/reviews', authenticate, ReviewController.createReview);

export default router;
