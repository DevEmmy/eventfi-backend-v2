import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Express middleware to validate request body against a Zod schema.
 * Returns 400 with structured error messages on validation failure.
 */
export const validate = (schema: ZodSchema) => {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            req.body = schema.parse(req.body);
            next();
        } catch (error: any) {
            if (error instanceof ZodError) {
                const messages = error.issues.map((e: any) => `${e.path.join('.')}: ${e.message}`);
                return res.status(400).json({
                    status: 'error',
                    message: 'Validation failed',
                    errors: messages,
                });
            }
            return res.status(400).json({
                status: 'error',
                message: 'Invalid request body',
            });
        }
    };
};
