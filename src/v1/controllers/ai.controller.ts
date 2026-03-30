import { Request, Response } from 'express';
import multer from 'multer';
import { AIService } from '../services/ai.service';

// In-memory storage — no files written to disk
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        const allowed = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword'
        ];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file type. Please upload an image (JPG/PNG/WebP), PDF, or Word document.'));
        }
    }
});

export const aiUploadMiddleware = upload.single('file');

export class AIController {
    /**
     * POST /ai/generate-event
     * Accepts multipart/form-data with:
     *   - description (text, optional if file provided)
     *   - file (image / pdf / docx, optional if description provided)
     */
    static async generateEvent(req: Request, res: Response) {
        try {
            const description = req.body?.description as string | undefined;
            const file = req.file
                ? { buffer: req.file.buffer, mimetype: req.file.mimetype, originalname: req.file.originalname }
                : undefined;

            if (!file && (!description || description.trim().length < 10)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Provide a description (min 10 characters) or upload a file'
                });
            }

            if (description && description.length > 2000) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Description must be 2000 characters or less'
                });
            }

            const result = await AIService.generate(description, file);
            return res.status(200).json({ status: 'success', data: result });
        } catch (error: any) {
            console.error('AI generate error:', error);
            const status = error.message?.includes('Unsupported') ? 400 : 500;
            return res.status(status).json({
                status: 'error',
                message: error.message || 'Failed to generate event details'
            });
        }
    }
}
