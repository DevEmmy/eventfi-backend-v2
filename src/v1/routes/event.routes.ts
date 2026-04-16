import { Router, Request, Response, NextFunction } from 'express';
import { EventController } from '../controllers/event.controller';
import { ReviewController } from '../controllers/review.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { createEventSchema, updateEventSchema, reviewSchema } from '../validations/event.schema';
import { BookingService } from '../services/booking.service';

/** Sets Cache-Control headers for public, unauthenticated responses. */
function setCache(maxAgeSeconds: number) {
    return (_req: Request, res: Response, next: NextFunction) => {
        res.set('Cache-Control', `public, max-age=${maxAgeSeconds}, s-maxage=${maxAgeSeconds}, stale-while-revalidate=30`);
        next();
    };
}

const router = Router();

router.post('/', authenticate, validate(createEventSchema), EventController.create);
router.get('/', setCache(30), EventController.findAll);

// Specific routes before parameterized routes
router.get('/recommendations', authenticate, EventController.getRecommendations); // personalized — no cache
router.get('/trending', setCache(60), EventController.getTrending);
router.get('/slug/:slug', setCache(300), EventController.findBySlug);

// Event detail routes
router.get('/:id', setCache(300), EventController.findOne);
router.patch('/:id', authenticate, validate(updateEventSchema), EventController.update);
router.delete('/:id', authenticate, EventController.delete);

// Related events
router.get('/:id/related', setCache(120), EventController.getRelated);

// Tickets — no HTTP caching: stock levels must always be fresh
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
router.get('/:id/reviews', setCache(120), ReviewController.getReviews);
router.get('/:id/reviews/stats', setCache(120), ReviewController.getStats);
router.post('/:id/reviews', authenticate, validate(reviewSchema), ReviewController.createReview);

// Speakers
router.get('/:id/speakers', setCache(300), EventController.getSpeakers);
router.post('/:id/speakers', authenticate, EventController.addSpeaker);
router.patch('/:id/speakers/:speakerId', authenticate, EventController.updateSpeaker);
router.delete('/:id/speakers/:speakerId', authenticate, EventController.deleteSpeaker);

export default router;
