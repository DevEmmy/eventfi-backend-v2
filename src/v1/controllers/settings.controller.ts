import { Request, Response } from 'express';
import { SettingsService } from '../services/settings.service';

export class SettingsController {
    /**
     * GET /users/me/settings - Get user settings
     */
    static async getSettings(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const settings = await SettingsService.getSettings(userId);

            return res.status(200).json({
                status: 'success',
                data: settings,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch settings',
            });
        }
    }

    /**
     * PATCH /users/me/settings - Update all settings
     */
    static async updateSettings(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { notifications, privacy } = req.body;

            const settings = await SettingsService.updateSettings(userId, { notifications, privacy });

            return res.status(200).json({
                status: 'success',
                data: settings,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to update settings',
            });
        }
    }

    /**
     * PATCH /users/me/settings/notifications - Update notification settings only
     */
    static async updateNotifications(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const notifications = req.body;

            const settings = await SettingsService.updateSettings(userId, { notifications });

            return res.status(200).json({
                status: 'success',
                data: settings,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to update notification settings',
            });
        }
    }

    /**
     * PATCH /users/me/settings/privacy - Update privacy settings only
     */
    static async updatePrivacy(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const privacy = req.body;

            const settings = await SettingsService.updateSettings(userId, { privacy });

            return res.status(200).json({
                status: 'success',
                data: settings,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to update privacy settings',
            });
        }
    }
}
