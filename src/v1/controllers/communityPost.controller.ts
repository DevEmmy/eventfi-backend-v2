import { Request, Response } from 'express';
import { CommunityPostService } from '../services/communityPost.service';
import { statusFromError } from './community.controller';

export class CommunityPostController {
    /**
     * GET /communities/:id/posts - Paginated discussion feed
     */
    static async listPosts(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const params = {
                page: parseInt(req.query.page as string) || 1,
                limit: parseInt(req.query.limit as string) || 10,
            };
            const result = await CommunityPostService.listPosts(req.params.id, userId, params);

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to fetch posts',
            });
        }
    }

    /**
     * POST /communities/:id/posts - Create a discussion post
     */
    static async createPost(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const post = await CommunityPostService.createPost(userId, req.params.id, req.body);

            return res.status(201).json({ status: 'success', data: post });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to create post',
            });
        }
    }

    /**
     * DELETE /communities/:id/posts/:postId - Delete a post
     */
    static async deletePost(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const result = await CommunityPostService.deletePost(userId, req.params.id, req.params.postId);

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to delete post',
            });
        }
    }

    /**
     * POST /communities/:id/posts/:postId/like - Like a post
     */
    static async likePost(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const result = await CommunityPostService.likePost(userId, req.params.id, req.params.postId);

            return res.status(201).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to like post',
            });
        }
    }

    /**
     * DELETE /communities/:id/posts/:postId/like - Unlike a post
     */
    static async unlikePost(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const result = await CommunityPostService.unlikePost(userId, req.params.id, req.params.postId);

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to unlike post',
            });
        }
    }

    /**
     * GET /communities/:id/posts/:postId/comments - List a post's comments
     */
    static async listComments(req: Request, res: Response) {
        try {
            const params = {
                page: parseInt(req.query.page as string) || 1,
                limit: parseInt(req.query.limit as string) || 20,
            };
            const result = await CommunityPostService.listComments(req.params.id, req.params.postId, params);

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to fetch comments',
            });
        }
    }

    /**
     * POST /communities/:id/posts/:postId/comments - Add a comment
     */
    static async addComment(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const comment = await CommunityPostService.addComment(userId, req.params.id, req.params.postId, req.body);

            return res.status(201).json({ status: 'success', data: comment });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to add comment',
            });
        }
    }

    /**
     * DELETE /communities/:id/posts/:postId/comments/:commentId - Delete a comment
     */
    static async deleteComment(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const result = await CommunityPostService.deleteComment(
                userId,
                req.params.id,
                req.params.postId,
                req.params.commentId
            );

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to delete comment',
            });
        }
    }
}
