import { Request, Response } from 'express';
import { EventService } from '../services/event.service';

export class EventController {
    static async create(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const eventData = req.body;

            // TODO: Add Zod validation here

            const event = await EventService.create(userId, eventData);

            return res.status(201).json({
                status: 'success',
                data: event,
            });
        } catch (error: any) {
            return res.status(400).json({
                status: 'error',
                message: error.message || 'Failed to create event',
            });
        }
    }

    static async findAll(req: Request, res: Response) {
        try {
            const events = await EventService.findAll(req.query);
            return res.status(200).json({
                status: 'success',
                data: events,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch events',
            });
        }
    }

    static async findOne(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const event = await EventService.findOne(id);
            return res.status(200).json({
                status: 'success',
                data: event,
            });
        } catch (error: any) {
            return res.status(404).json({
                status: 'error',
                message: error.message || 'Event not found',
            });
        }
    }

    static async update(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { id } = req.params;
            const updateData = req.body;

            const event = await EventService.update(id, userId, updateData);

            return res.status(200).json({
                status: 'success',
                data: event,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('Unauthorized') ? 403 : error.message.includes('not found') ? 404 : 400;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to update event',
            });
        }
    }

    static async delete(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { id } = req.params;

            const result = await EventService.delete(id, userId);

            return res.status(200).json({
                status: 'success',
                message: result.message,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('Unauthorized') ? 403 : error.message.includes('not found') ? 404 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to delete event',
            });
        }
    }

    static async getRecommendations(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const events = await EventService.getRecommendations(userId);

            return res.status(200).json({
                status: 'success',
                data: events,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch recommendations',
            });
        }
    }

    static async getRelated(req: Request, res: Response) {
        try {
            const { id: eventId } = req.params;
            const limit = parseInt(req.query.limit as string) || 5;
            const events = await EventService.getRelatedEvents(eventId, limit);

            return res.status(200).json({
                status: 'success',
                data: events,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to fetch related events',
            });
        }
    }

    static async getTrending(req: Request, res: Response) {
        try {
            const limit = parseInt(req.query.limit as string) || 10;
            const events = await EventService.getTrending(limit);

            return res.status(200).json({
                status: 'success',
                data: events,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch trending events',
            });
        }
    }
}
