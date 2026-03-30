import { Router } from 'express';
import { ActivityController } from '../controllers/activity.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router({ mergeParams: true });

// Public - get active activity for an event
router.get('/:id/activities/active', ActivityController.getActive);

// Organizer only
router.post('/:id/activities', authenticate, ActivityController.create);
router.get('/:id/activities', authenticate, ActivityController.list);
router.get('/:id/activities/:activityId', authenticate, ActivityController.getDetail);
router.patch('/:id/activities/:activityId/start', authenticate, ActivityController.start);
router.patch('/:id/activities/:activityId/end', authenticate, ActivityController.end);
router.post('/:id/activities/:activityId/draw', authenticate, ActivityController.draw);

// Attendee
router.post('/:id/activities/:activityId/tap', authenticate, ActivityController.tap);

export default router;
