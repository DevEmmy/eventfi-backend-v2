import { Router } from 'express';
import { CommunityPostController } from '../controllers/communityPost.controller';
import { authenticate, optionalAuth } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { createPostSchema, createCommentSchema } from '../validations/communityPost.schema';

const router = Router();

// Posts
router.get('/:id/posts', optionalAuth, CommunityPostController.listPosts);
router.post('/:id/posts', authenticate, validate(createPostSchema), CommunityPostController.createPost);
router.delete('/:id/posts/:postId', authenticate, CommunityPostController.deletePost);

// Likes
router.post('/:id/posts/:postId/like', authenticate, CommunityPostController.likePost);
router.delete('/:id/posts/:postId/like', authenticate, CommunityPostController.unlikePost);

// Comments
router.get('/:id/posts/:postId/comments', optionalAuth, CommunityPostController.listComments);
router.post('/:id/posts/:postId/comments', authenticate, validate(createCommentSchema), CommunityPostController.addComment);
router.delete('/:id/posts/:postId/comments/:commentId', authenticate, CommunityPostController.deleteComment);

export default router;
