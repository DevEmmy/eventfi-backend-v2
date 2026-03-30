import { Request, Response } from 'express';
import { AIService } from '../services/ai.service';

export class AIController {
    /**
     * POST /ai/generate-event
     * Body: { description: string }
     */
    static async generateEvent(req: Request, res: Response) {
        try {
            const { description } = req.body;

            if (!description || typeof description !== 'string' || description.trim().length < 10) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Please provide a description of at least 10 characters'
                });
            }

            if (description.length > 2000) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Description must be 2000 characters or less'
                });
            }

            const result = await AIService.generateEvent(description.trim());

            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            console.error('AI generate error:', error);
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to generate event details'
            });
        }
    }
}
