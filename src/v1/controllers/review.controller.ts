import { Request, Response } from 'express';
import { ReviewService } from '../services/review.service';

export class ReviewController {
    static async getReviews(req: Request, res: Response) {
        try {
            const { id: eventId } = req.params;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await ReviewService.getReviews(eventId, page, limit);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch reviews',
            });
        }
    }

    static async getStats(req: Request, res: Response) {
        try {
            const { id: eventId } = req.params;
            const stats = await ReviewService.getStats(eventId);

            return res.status(200).json({
                status: 'success',
                data: stats,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch review stats',
            });
        }
    }

    static async createReview(req: Request, res: Response) {
        try {
            const { id: eventId } = req.params;
            const userId = (req as any).user.id;
            const { rating, title, comment, photos } = req.body;

            if (!rating || !comment) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Rating and comment are required',
                });
            }

            if (rating < 1 || rating > 5) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Rating must be between 1 and 5',
                });
            }

            const review = await ReviewService.createReview(eventId, userId, { rating, title, comment, photos });

            return res.status(201).json({
                status: 'success',
                data: review,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('already reviewed') ? 409 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to create review',
            });
        }
    }
}
