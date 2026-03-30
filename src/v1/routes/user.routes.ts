import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { SettingsController } from '../controllers/settings.controller';
import { BookingController } from '../controllers/booking.controller';
import { ManageController } from '../controllers/manage.controller';
import { authenticate, optionalAuth } from '../middlewares/auth.middleware';

const router = Router();

// Current user routes (require auth)
router.get('/me/events', authenticate, UserController.getMyEvents);
router.get('/me/tickets', authenticate, BookingController.getUserTickets);
router.get('/me/orders', authenticate, BookingController.getUserOrders);
router.get('/me/favorites', authenticate, UserController.getMyFavorites);
router.get('/me/dashboard', authenticate, UserController.getOrganizerDashboard);

// Settings routes
router.get('/me/settings', authenticate, SettingsController.getSettings);
router.patch('/me/settings', authenticate, SettingsController.updateSettings);
router.patch('/me/settings/notifications', authenticate, SettingsController.updateNotifications);
router.patch('/me/settings/privacy', authenticate, SettingsController.updatePrivacy);

// Follow/Unfollow (require auth)
router.post('/:userId/follow', authenticate, UserController.followUser);
router.delete('/:userId/follow', authenticate, UserController.unfollowUser);

// User search — must be before /:username to avoid being swallowed by the param route
router.get('/search', authenticate, ManageController.searchUsers);

// Public profile (optional auth for isFollowing)
router.get('/:username', optionalAuth, UserController.getPublicProfile);

// Save/Unsave events (require auth)
router.post('/events/:eventId/save', authenticate, UserController.saveEvent);
router.delete('/events/:eventId/save', authenticate, UserController.unsaveEvent);

export default router;
