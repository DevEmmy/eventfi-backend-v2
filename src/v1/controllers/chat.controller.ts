import { Request, Response } from 'express';
import { ChatService } from '../services/chat.service';

export class ChatController {
    /**
     * GET /events/:eventId/chat - Get/Join event chat
     */
    static async getOrJoinChat(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;

            const data = await ChatService.getOrJoinChat(eventId, userId);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to get chat'
            });
        }
    }

    /**
     * GET /events/:eventId/chat/messages - Get chat messages
     */
    static async getMessages(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;
            const before = req.query.before as string;
            const limit = parseInt(req.query.limit as string) || 50;

            const data = await ChatService.getMessages(eventId, userId, before, limit);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('cannot') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to get messages'
            });
        }
    }

    /**
     * GET /events/:eventId/chat/messages/pinned - Get pinned messages
     */
    static async getPinnedMessages(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;

            const data = await ChatService.getPinnedMessages(eventId, userId);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to get pinned messages'
            });
        }
    }

    /**
     * GET /events/:eventId/chat/members - Get chat members
     */
    static async getMembers(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;
            const onlineOnly = req.query.online === 'true';
            const limit = parseInt(req.query.limit as string) || 20;

            const data = await ChatService.getMembers(eventId, userId, onlineOnly, limit);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to get members'
            });
        }
    }

    /**
     * POST /events/:eventId/chat/messages - Send message
     */
    static async sendMessage(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;
            const { content, type, replyToId } = req.body;

            if (!content || !content.trim()) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Message content is required'
                });
            }

            const data = await ChatService.sendMessage(eventId, userId, content, type, replyToId);

            return res.status(201).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('muted') || error.message.includes('wait') ? 429 :
                    error.message.includes('cannot') || error.message.includes('Max') ? 400 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to send message'
            });
        }
    }

    /**
     * PATCH /events/:eventId/chat/messages/:messageId - Moderate message
     */
    static async moderateMessage(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId, messageId } = req.params;
            const { action } = req.body;

            if (!['delete', 'pin', 'unpin'].includes(action)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Invalid action. Use: delete, pin, or unpin'
                });
            }

            const data = await ChatService.moderateMessage(eventId, messageId, userId, action);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('cannot') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to moderate message'
            });
        }
    }

    /**
     * POST /events/:eventId/chat/members/:userId/mute - Mute/Unmute user
     */
    static async muteUser(req: Request, res: Response) {
        try {
            const actorUserId = (req as any).user.id;
            const { eventId, userId: targetUserId } = req.params;
            const { duration } = req.body;

            if (typeof duration !== 'number') {
                return res.status(400).json({
                    status: 'error',
                    message: 'Duration (minutes) is required'
                });
            }

            const data = await ChatService.muteUser(eventId, targetUserId, actorUserId, duration);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('cannot') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to mute user'
            });
        }
    }

    /**
     * PATCH /events/:eventId/chat/settings - Update chat settings
     */
    static async updateSettings(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId } = req.params;
            const { slowMode, isActive } = req.body;

            const data = await ChatService.updateSettings(eventId, userId, slowMode, isActive);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('cannot') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to update settings'
            });
        }
    }

    /**
     * GET /users/event-chats - Get all event chats for logged-in user
     */
    static async getUserEventChats(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;

            const data = await ChatService.getUserEventChats(userId);

            return res.status(200).json({
                status: 'success',
                data
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to get event chats'
            });
        }
    }
}

