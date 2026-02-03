import { Router } from 'express';
import { ManageController } from '../controllers/manage.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Event management dashboard
router.get('/:eventId/manage', authenticate, ManageController.getManageData);
router.get('/:eventId/analytics', authenticate, ManageController.getAnalytics);

// Attendee management
router.get('/:eventId/attendees', authenticate, ManageController.getAttendees);
router.post('/:eventId/attendees/:attendeeId/check-in', authenticate, ManageController.checkInAttendee);
router.post('/:eventId/attendees/email', authenticate, ManageController.sendBulkEmail);
// TODO: router.get('/:eventId/attendees/export', authenticate, ManageController.exportAttendees);

// Team management
router.get('/:eventId/team', authenticate, ManageController.getTeamMembers);
router.post('/:eventId/team', authenticate, ManageController.addTeamMember);
router.patch('/:eventId/team/:memberId', authenticate, ManageController.updateTeamMember);
router.delete('/:eventId/team/:memberId', authenticate, ManageController.removeTeamMember);

// Event actions
router.post('/:eventId/duplicate', authenticate, ManageController.duplicateEvent);
router.post('/:eventId/cancel', authenticate, ManageController.cancelEvent);

export default router;
