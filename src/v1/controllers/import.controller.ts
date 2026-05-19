import { Request, Response } from 'express';
import multer from 'multer';
import { ImportService } from '../services/import.service';
import { importGoogleFormsSchema } from '../validations/import.schema';
import { ZodError } from 'zod';

const csvUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are supported'));
        }
    },
});

export const csvUploadMiddleware = csvUpload.single('file');

export class ImportController {
    /**
     * POST /events/:eventId/import/google-forms
     * Accepts multipart/form-data:
     *   file         — CSV exported from Google Forms / Google Sheets
     *   ticketId     — UUID of the ticket type to assign importees
     *   nameColumn   — CSV column header that contains attendee name
     *   emailColumn  — CSV column header that contains attendee email
     *   phoneColumn  — (optional) column header for phone
     *   cityColumn   — (optional) column header for city
     *   locationColumn — (optional) column header for location
     *   skipDuplicates — "true" | "false" (default true)
     */
    static async importGoogleForms(req: Request, res: Response) {
        try {
            const eventId = req.params.eventId;
            const organizerId = (req as any).user.id;

            if (!req.file) {
                return res.status(400).json({ status: 'error', message: 'CSV file is required' });
            }

            // Validate form fields via Zod (multer puts them in req.body as strings)
            let options;
            try {
                options = importGoogleFormsSchema.parse(req.body);
            } catch (err) {
                if (err instanceof ZodError) {
                    const messages = err.issues.map(e => `${e.path.join('.')}: ${e.message}`);
                    return res.status(400).json({
                        status: 'error',
                        message: 'Validation failed',
                        errors: messages,
                    });
                }
                throw err;
            }

            const result = await ImportService.importFromCSV(
                eventId,
                organizerId,
                req.file.buffer,
                options,
            );

            return res.status(200).json({
                status: 'success',
                message: `Import complete — ${result.created} attendee(s) added`,
                data: result,
            });
        } catch (error: any) {
            console.error('Import error:', error);
            const status =
                error.message?.includes('not found') ? 404 :
                error.message?.includes('Unauthorized') || error.message?.includes('Insufficient') ? 403 :
                400;
            return res.status(status).json({ status: 'error', message: error.message || 'Import failed' });
        }
    }

    /**
     * POST /events/:eventId/import/preview
     * Accepts just the CSV file and returns the column headers so the
     * frontend can render the field-mapping step before the actual import.
     */
    static async previewHeaders(req: Request, res: Response) {
        try {
            if (!req.file) {
                return res.status(400).json({ status: 'error', message: 'CSV file is required' });
            }
            const headers = ImportService.parseHeaders(req.file.buffer);
            return res.status(200).json({ status: 'success', data: { headers } });
        } catch (error: any) {
            return res.status(400).json({ status: 'error', message: error.message || 'Could not parse CSV' });
        }
    }
}
