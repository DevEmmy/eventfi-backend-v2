import { Router } from 'express';
import { ChatController } from '../controllers/chat.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Chat info & join
router.get('/:eventId/chat', authenticate, ChatController.getOrJoinChat);

// Messages
router.get('/:eventId/chat/messages', authenticate, ChatController.getMessages);
router.get('/:eventId/chat/messages/pinned', authenticate, ChatController.getPinnedMessages);
router.post('/:eventId/chat/messages', authenticate, ChatController.sendMessage);
router.patch('/:eventId/chat/messages/:messageId', authenticate, ChatController.moderateMessage);

// Members
router.get('/:eventId/chat/members', authenticate, ChatController.getMembers);
router.post('/:eventId/chat/members/:userId/mute', authenticate, ChatController.muteUser);

// Settings
router.patch('/:eventId/chat/settings', authenticate, ChatController.updateSettings);

export default router;
