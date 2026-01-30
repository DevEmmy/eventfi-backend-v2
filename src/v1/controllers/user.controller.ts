import { Request, Response } from 'express';
import { UserService } from '../services/user.service';

export class UserController {
    /**
     * GET /users/me/events - Get current user's hosted events
     */
    static async getMyEvents(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const status = req.query.status as string;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await UserService.getUserEvents(userId, status, page, limit);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch events',
            });
        }
    }

    /**
     * GET /users/me/tickets - Get current user's tickets
     */
    static async getMyTickets(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const status = req.query.status as string;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await UserService.getUserTickets(userId, status, page, limit);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch tickets',
            });
        }
    }

    /**
     * GET /users/me/favorites - Get current user's favorites
     */
    static async getMyFavorites(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await UserService.getUserFavorites(userId, page, limit);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch favorites',
            });
        }
    }

    /**
     * GET /users/:username - Get public user profile
     */
    static async getPublicProfile(req: Request, res: Response) {
        try {
            const { username } = req.params;
            const viewerId = (req as any).user?.id;

            const profile = await UserService.getPublicProfile(username, viewerId);

            return res.status(200).json({
                status: 'success',
                data: profile,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to fetch profile',
            });
        }
    }

    /**
     * POST /users/:userId/follow - Follow a user
     */
    static async followUser(req: Request, res: Response) {
        try {
            const followerId = (req as any).user.id;
            const { userId: followingId } = req.params;

            const result = await UserService.followUser(followerId, followingId);

            return res.status(201).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('Already') ? 409 : error.message.includes('yourself') ? 400 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to follow user',
            });
        }
    }

    /**
     * DELETE /users/:userId/follow - Unfollow a user
     */
    static async unfollowUser(req: Request, res: Response) {
        try {
            const followerId = (req as any).user.id;
            const { userId: followingId } = req.params;

            const result = await UserService.unfollowUser(followerId, followingId);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('Not following') ? 404 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to unfollow user',
            });
        }
    }

    /**
     * POST /events/:eventId/save - Save an event
     */
    static async saveEvent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;

            const result = await UserService.saveEvent(userId, eventId);

            return res.status(201).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('already saved') ? 409 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to save event',
            });
        }
    }

    /**
     * DELETE /events/:eventId/save - Unsave an event
     */
    static async unsaveEvent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;

            const result = await UserService.unsaveEvent(userId, eventId);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not saved') ? 404 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to unsave event',
            });
        }
    }
}
