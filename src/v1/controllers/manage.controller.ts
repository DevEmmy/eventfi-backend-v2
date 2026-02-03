import { Request, Response } from 'express';
import { ManageService } from '../services/manage.service';
import { TeamService } from '../services/team.service';

export class ManageController {
    /**
     * GET /events/:eventId/manage - Get event management data
     */
    static async getManageData(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;

            const data = await ManageService.getManageData(eventId, userId);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') || error.message.includes('permissions') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to fetch management data'
            });
        }
    }

    /**
     * GET /events/:eventId/analytics - Get event analytics
     */
    static async getAnalytics(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;
            const period = (req.query.period as string) || '30d';

            const data = await ManageService.getAnalytics(eventId, userId, period);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') || error.message.includes('permissions') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to fetch analytics'
            });
        }
    }

    /**
     * GET /events/:eventId/attendees - Get event attendees
     */
    static async getAttendees(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const search = req.query.search as string;
            const status = req.query.status as string;
            const ticketType = req.query.ticketType as string;

            const data = await ManageService.getAttendees(eventId, userId, page, limit, search, status, ticketType);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') || error.message.includes('permissions') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to fetch attendees'
            });
        }
    }

    /**
     * POST /events/:eventId/attendees/:attendeeId/check-in - Check-in attendee
     */
    static async checkInAttendee(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId, attendeeId } = req.params;
            const { method, ticketCode } = req.body;

            const data = await ManageService.checkInAttendee(eventId, attendeeId, userId, method || 'manual', ticketCode);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('already') ? 400 :
                    error.message.includes('Invalid') ? 400 :
                        error.message.includes('Unauthorized') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to check-in attendee'
            });
        }
    }

    /**
     * POST /events/:eventId/attendees/email - Send bulk email
     */
    static async sendBulkEmail(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;
            const { recipients, attendeeIds, subject, body } = req.body;

            if (!subject || !body) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Subject and body are required'
                });
            }

            const data = await ManageService.sendBulkEmail(eventId, userId, recipients, attendeeIds, subject, body);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to send bulk email'
            });
        }
    }

    /**
     * GET /events/:eventId/team - Get team members
     */
    static async getTeamMembers(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;

            const data = await TeamService.getTeamMembers(eventId, userId);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to fetch team members'
            });
        }
    }

    /**
     * POST /events/:eventId/team - Add team member
     */
    static async addTeamMember(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;
            const { userIdOrEmail, role } = req.body;

            if (!userIdOrEmail || !role) {
                return res.status(400).json({
                    status: 'error',
                    message: 'userIdOrEmail and role are required'
                });
            }

            const roleMap: Record<string, string> = {
                'co-host': 'CO_HOST',
                'manager': 'MANAGER',
                'assistant': 'ASSISTANT'
            };

            const data = await TeamService.addTeamMember(eventId, userId, userIdOrEmail, (roleMap[role] || role.toUpperCase()) as any);

            return res.status(201).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('already') ? 400 :
                    error.message.includes('Cannot add') ? 400 :
                        error.message.includes('Unauthorized') || error.message.includes('permissions') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to add team member'
            });
        }
    }

    /**
     * PATCH /events/:eventId/team/:memberId - Update team member role
     */
    static async updateTeamMember(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId, memberId } = req.params;
            const { role } = req.body;

            if (!role) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Role is required'
                });
            }

            const data = await TeamService.updateTeamMember(eventId, memberId, userId, role);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') || error.message.includes('permissions') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to update team member'
            });
        }
    }

    /**
     * DELETE /events/:eventId/team/:memberId - Remove team member
     */
    static async removeTeamMember(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId, memberId } = req.params;

            const data = await TeamService.removeTeamMember(eventId, memberId, userId);

            return res.status(200).json({
                status: 'success',
                ...data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') || error.message.includes('permissions') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to remove team member'
            });
        }
    }

    /**
     * POST /events/:eventId/duplicate - Duplicate event
     */
    static async duplicateEvent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;
            const { title, resetDates } = req.body;

            const data = await ManageService.duplicateEvent(eventId, userId, title, resetDates);

            return res.status(201).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') || error.message.includes('permissions') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to duplicate event'
            });
        }
    }

    /**
     * POST /events/:eventId/cancel - Cancel event
     */
    static async cancelEvent(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;
            const { reason, notifyAttendees, refundPolicy } = req.body;

            if (!reason) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Cancellation reason is required'
                });
            }

            const data = await ManageService.cancelEvent(
                eventId,
                userId,
                reason,
                notifyAttendees !== false,
                refundPolicy || 'full'
            );

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('already') ? 400 :
                    error.message.includes('Unauthorized') || error.message.includes('permissions') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to cancel event'
            });
        }
    }

    /**
     * GET /users/search - Search users for team addition
     */
    static async searchUsers(req: Request, res: Response) {
        try {
            const q = req.query.q as string;
            const excludeEventTeam = req.query.excludeEventTeam as string;

            if (!q || q.length < 3) {
                return res.status(200).json({
                    status: 'success',
                    data: []
                });
            }

            const data = await TeamService.searchUsers(q, excludeEventTeam);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to search users'
            });
        }
    }
}
