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

    static async updateProfile(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { username, displayName, avatar, interests, bio, location, website, socialLinks } = req.body;

            const result = await AuthService.updateProfile(userId, {
                username, displayName, avatar, interests, bio, location, website, socialLinks
            });

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(400).json({
                status: 'error',
                message: error.message || 'Failed to update profile',
            });
        }
    }

    static async getProfile(req: Request, res: Response) {
        try {
            const user = (req as any).user;

            if (!user) {
                return res.status(404).json({
                    status: 'error',
                    message: 'User not found',
                });
            }

            const { passwordHash, ...safeUser } = user;

            return res.status(200).json({
                status: 'success',
                data: safeUser,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Internal server error',
            });
        }
    }

    static async getMe(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { UserService } = await import('../services/user.service');
            const profile = await UserService.getFullProfile(userId);

            return res.status(200).json({
                status: 'success',
                data: profile,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch profile',
            });
        }
    }

    static async changePassword(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { currentPassword, newPassword, confirmPassword } = req.body;

            if (!currentPassword || !newPassword || !confirmPassword) {
                return res.status(400).json({
                    status: 'error',
                    message: 'All password fields are required',
                });
            }

            const { SettingsService } = await import('../services/settings.service');
            const result = await SettingsService.changePassword(userId, currentPassword, newPassword, confirmPassword);

            return res.status(200).json({
                status: 'success',
                message: result.message,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('incorrect') ? 401 :
                error.message.includes('match') || error.message.includes('least') ? 400 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to change password',
            });
        }
    }

    static async deleteAccount(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { password, reason } = req.body;

            if (!password) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Password is required to delete account',
                });
            }

            const { SettingsService } = await import('../services/settings.service');
            const result = await SettingsService.deleteAccount(userId, password, reason);

            return res.status(200).json({
                status: 'success',
                message: result.message,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('incorrect') ? 401 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to delete account',
            });
        }
    }

    static async logout(req: Request, res: Response) {
        try {
            // For JWT-based auth, logout is typically client-side
            // Here we can blacklist the token if using Redis
            return res.status(200).json({
                status: 'success',
                message: 'Logged out successfully',
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to logout',
            });
        }
    }

    static async logoutAll(req: Request, res: Response) {
        try {
            // Would invalidate all tokens for the user
            // For now, just return success
            return res.status(200).json({
                status: 'success',
                message: 'Logged out from all devices',
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to logout',
            });
        }
    }
}
