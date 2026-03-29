import { Request, Response } from 'express';
import { ActivityService } from '../services/activity.service';
import { ActivityType } from '@prisma/client';

export class ActivityController {
    // POST /events/:id/activities
    static async create(req: Request, res: Response) {
        try {
            const { id: eventId } = req.params;
            const userId = (req as any).user.id;
            const { type, config } = req.body;

            if (!type || !Object.values(ActivityType).includes(type)) {
                return res.status(400).json({ status: 'error', message: 'Valid activity type required' });
            }

            const activity = await ActivityService.create(eventId, userId, type, config || {});
            res.status(201).json({ status: 'success', data: activity });
        } catch (error: any) {
            const status = error.message === 'Unauthorized' ? 403 : error.message === 'Event not found' ? 404 : 400;
            res.status(status).json({ status: 'error', message: error.message });
        }
    }

    // GET /events/:id/activities
    static async list(req: Request, res: Response) {
        try {
            const { id: eventId } = req.params;
            const activities = await ActivityService.getByEvent(eventId);
            res.json({ status: 'success', data: activities });
        } catch (error: any) {
            res.status(500).json({ status: 'error', message: error.message });
        }
    }

    // GET /events/:id/activities/active
    static async getActive(req: Request, res: Response) {
        try {
            const { id: eventId } = req.params;
            const activity = await ActivityService.getActive(eventId);
            res.json({ status: 'success', data: activity });
        } catch (error: any) {
            res.status(500).json({ status: 'error', message: error.message });
        }
    }

    // PATCH /events/:id/activities/:activityId/start
    static async start(req: Request, res: Response) {
        try {
            const { activityId } = req.params;
            const userId = (req as any).user.id;
            const activity = await ActivityService.start(activityId, userId);
            res.json({ status: 'success', data: activity });
        } catch (error: any) {
            const status = error.message === 'Unauthorized' ? 403 : 400;
            res.status(status).json({ status: 'error', message: error.message });
        }
    }

    // PATCH /events/:id/activities/:activityId/end
    static async end(req: Request, res: Response) {
        try {
            const { activityId } = req.params;
            const userId = (req as any).user.id;
            const activity = await ActivityService.end(activityId, userId);
            res.json({ status: 'success', data: activity });
        } catch (error: any) {
            const status = error.message === 'Unauthorized' ? 403 : 400;
            res.status(status).json({ status: 'error', message: error.message });
        }
    }

    // POST /events/:id/activities/:activityId/draw
    static async draw(req: Request, res: Response) {
        try {
            const { activityId } = req.params;
            const userId = (req as any).user.id;
            const result = await ActivityService.draw(activityId, userId);
            res.json({ status: 'success', data: result });
        } catch (error: any) {
            const status = error.message === 'Unauthorized' ? 403 : 400;
            res.status(status).json({ status: 'error', message: error.message });
        }
    }

    // POST /events/:id/activities/:activityId/tap
    static async tap(req: Request, res: Response) {
        try {
            const { activityId } = req.params;
            const userId = (req as any).user.id;
            const result = await ActivityService.tap(activityId, userId);
            res.json({ status: 'success', data: result });
        } catch (error: any) {
            res.status(400).json({ status: 'error', message: error.message });
        }
    }
}
