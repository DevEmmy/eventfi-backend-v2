import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';

export class AuthController {
    static async signup(req: Request, res: Response) {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Email and password are required',
                });
            }

            const result = await AuthService.signup(email, password);

            return res.status(201).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(error.message.includes('exists') ? 409 : 400).json({
                status: 'error',
                message: error.message || 'Internal server error',
            });
        }
    }

    static async login(req: Request, res: Response) {
        try {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Email and password are required',
                });
            }

            const result = await AuthService.login(email, password);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(401).json({
                status: 'error',
                message: error.message || 'Authentication failed',
            });
        }
    }

    static async forgotPassword(req: Request, res: Response) {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Email is required',
                });
            }

            await AuthService.forgotPassword(email);

            return res.status(200).json({
                status: 'success',
                message: 'If an account exists with this email, a reset link has been sent.',
            });
        } catch (error: any) {
            return res.status(400).json({
                status: 'error',
                message: error.message || 'Something went wrong',
            });
        }
    }

    static async resetPassword(req: Request, res: Response) {
        try {
            const { token, password } = req.body;

            if (!token || !password) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Token and new password are required',
                });
            }

            const result = await AuthService.resetPassword(token, password);

            return res.status(200).json({
                status: 'success',
                message: result.message,
            });
        } catch (error: any) {
            return res.status(400).json({
                status: 'error',
                message: error.message || 'Invalid or expired token',
            });
        }
    }
}
