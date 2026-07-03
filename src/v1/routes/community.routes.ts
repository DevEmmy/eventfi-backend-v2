import { Router } from 'express';
import { CommunityController } from '../controllers/community.controller';
import { authenticate, optionalAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import {
    createCommunitySchema,
    updateCommunitySchema,
    createChapterSchema,
    updateChapterSchema,
    inviteMemberSchema,
    updateMemberSchema,
} from '../validations/community.schema';

const router = Router();

// Public directory (must come before /:id)
router.get('/', CommunityController.listPublic);

// Authenticated, non-parameterized routes (must come before /:id)
router.get('/mine', authenticate, CommunityController.listMine);
router.post('/', authenticate, validate(createCommunitySchema), CommunityController.create);

// Public community page (must come before /:id)
router.get('/slug/:slug', optionalAuth, CommunityController.getBySlug);

// Community detail
router.get('/:id', optionalAuth, CommunityController.getOne);
router.patch('/:id', authenticate, validate(updateCommunitySchema), CommunityController.update);
router.delete('/:id', authenticate, CommunityController.remove);

// Follow / Unfollow
router.post('/:id/follow', authenticate, CommunityController.follow);
router.delete('/:id/follow', authenticate, CommunityController.unfollow);

// Overview
router.get('/:id/overview', authenticate, CommunityController.getOverview);

// Chapters
router.post('/:id/chapters', authenticate, validate(createChapterSchema), CommunityController.createChapter);
router.patch('/:id/chapters/:chapterId', authenticate, validate(updateChapterSchema), CommunityController.updateChapter);
router.delete('/:id/chapters/:chapterId', authenticate, CommunityController.deleteChapter);
router.get('/:id/chapters/:chapterId/events', authenticate, CommunityController.getChapterEvents);

// Members
router.get('/:id/members', authenticate, CommunityController.listMembers);
router.post('/:id/members', authenticate, validate(inviteMemberSchema), CommunityController.inviteMember);
router.patch('/:id/members/:memberId', authenticate, validate(updateMemberSchema), CommunityController.updateMember);
router.delete('/:id/members/:memberId', authenticate, CommunityController.removeMember);

export default router;
