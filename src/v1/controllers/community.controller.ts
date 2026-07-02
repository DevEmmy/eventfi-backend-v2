import { Request, Response } from 'express';
import { CommunityService } from '../services/community.service';

export function statusFromError(error: any): number {
    const message: string = error.message || '';
    if (message === 'Forbidden') return 403;
    if (message.includes('not found')) return 404;
    if (message.includes('already')) return 409;
    if (message.includes('Cannot')) return 400;
    if (message.includes('required') || message.includes('must not')) return 400;
    return 500;
}

export class CommunityController {
    /**
     * POST /communities - Create a community
     */
    static async create(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const community = await CommunityService.createCommunity(userId, req.body);

            return res.status(201).json({ status: 'success', data: community });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to create community',
            });
        }
    }

    /**
     * GET /communities/mine - List communities the current user belongs to
     */
    static async listMine(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const communities = await CommunityService.listMyCommunities(userId);

            return res.status(200).json({ status: 'success', data: communities });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch communities',
            });
        }
    }

    /**
     * GET /communities/slug/:slug - Public community page lookup
     */
    static async getBySlug(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const community = await CommunityService.getCommunityBySlug(req.params.slug, userId);

            return res.status(200).json({ status: 'success', data: community });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to fetch community',
            });
        }
    }

    /**
     * GET /communities/:id - Get community details
     */
    static async getOne(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const community = await CommunityService.getCommunity(req.params.id, userId);

            return res.status(200).json({ status: 'success', data: community });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to fetch community',
            });
        }
    }

    /**
     * PATCH /communities/:id - Update community details
     */
    static async update(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const community = await CommunityService.updateCommunity(userId, req.params.id, req.body);

            return res.status(200).json({ status: 'success', data: community });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to update community',
            });
        }
    }

    /**
     * DELETE /communities/:id - Delete a community
     */
    static async remove(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const result = await CommunityService.deleteCommunity(userId, req.params.id);

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to delete community',
            });
        }
    }

    // ==================== CHAPTERS ====================

    /**
     * POST /communities/:id/chapters - Create a chapter
     */
    static async createChapter(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const chapter = await CommunityService.createChapter(userId, req.params.id, req.body);

            return res.status(201).json({ status: 'success', data: chapter });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to create chapter',
            });
        }
    }

    /**
     * PATCH /communities/:id/chapters/:chapterId - Update a chapter
     */
    static async updateChapter(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const chapter = await CommunityService.updateChapter(userId, req.params.id, req.params.chapterId, req.body);

            return res.status(200).json({ status: 'success', data: chapter });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to update chapter',
            });
        }
    }

    /**
     * DELETE /communities/:id/chapters/:chapterId - Delete a chapter
     */
    static async deleteChapter(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const result = await CommunityService.deleteChapter(userId, req.params.id, req.params.chapterId);

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to delete chapter',
            });
        }
    }

    /**
     * GET /communities/:id/chapters/:chapterId/events - List events for a chapter
     */
    static async getChapterEvents(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const params = {
                page: parseInt(req.query.page as string) || 1,
                limit: parseInt(req.query.limit as string) || 12,
            };
            const result = await CommunityService.getChapterEvents(userId, req.params.id, req.params.chapterId, params);

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to fetch chapter events',
            });
        }
    }

    // ==================== MEMBERS ====================

    /**
     * GET /communities/:id/members - List community members
     */
    static async listMembers(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const members = await CommunityService.listMembers(userId, req.params.id);

            return res.status(200).json({ status: 'success', data: members });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to fetch members',
            });
        }
    }

    /**
     * POST /communities/:id/members - Invite a member
     */
    static async inviteMember(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const member = await CommunityService.inviteMember(userId, req.params.id, req.body);

            return res.status(201).json({ status: 'success', data: member });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to invite member',
            });
        }
    }

    /**
     * PATCH /communities/:id/members/:memberId - Update a member's role/chapter
     */
    static async updateMember(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const member = await CommunityService.updateMemberRole(userId, req.params.id, req.params.memberId, req.body);

            return res.status(200).json({ status: 'success', data: member });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to update member',
            });
        }
    }

    /**
     * DELETE /communities/:id/members/:memberId - Remove a member
     */
    static async removeMember(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const result = await CommunityService.removeMember(userId, req.params.id, req.params.memberId);

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to remove member',
            });
        }
    }

    /**
     * POST /communities/accept - Accept a community invitation
     */
    static async acceptInvite(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { token } = req.body;

            if (!token) {
                return res.status(400).json({ status: 'error', message: 'Invitation token is required' });
            }

            const result = await CommunityService.acceptInvite(token, userId);

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(400).json({
                status: 'error',
                message: error.message || 'Failed to accept invitation',
            });
        }
    }

    // ==================== FOLLOW ====================

    /**
     * POST /communities/:id/follow - Follow a community
     */
    static async follow(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const result = await CommunityService.followCommunity(userId, req.params.id);

            return res.status(201).json({ status: 'success', data: result });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to follow community',
            });
        }
    }

    /**
     * DELETE /communities/:id/follow - Unfollow a community
     */
    static async unfollow(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const result = await CommunityService.unfollowCommunity(userId, req.params.id);

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            const statusCode = error.message.includes('Not following') ? 404 : statusFromError(error);
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to unfollow community',
            });
        }
    }

    // ==================== OVERVIEW ====================

    /**
     * GET /communities/:id/overview - Cross-chapter dashboard
     */
    static async getOverview(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const overview = await CommunityService.getOverview(userId, req.params.id);

            return res.status(200).json({ status: 'success', data: overview });
        } catch (error: any) {
            return res.status(statusFromError(error)).json({
                status: 'error',
                message: error.message || 'Failed to fetch overview',
            });
        }
    }
}
