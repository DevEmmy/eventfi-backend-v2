import { Router } from 'express';
import { EventController } from '../controllers/event.controller';
import { ReviewController } from '../controllers/review.controller';
import { authenticate } from '../middlewares/auth.middleware';

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

// Reviews
router.get('/:id/reviews', ReviewController.getReviews);
router.get('/:id/reviews/stats', ReviewController.getStats);
router.post('/:id/reviews', authenticate, ReviewController.createReview);

export default router;
