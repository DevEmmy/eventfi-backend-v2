import { prisma } from '../config/database';
import bcrypt from 'bcrypt';

interface NotificationSettings {
    email: boolean;
    push: boolean;
    sms: boolean;
    eventReminders: boolean;
    eventNearby: boolean;
    eventUpdates: boolean;
    ticketSales: boolean;
    bookingRequests: boolean;
    bookingConfirmations: boolean;
    reviews: boolean;
    newMessages: boolean;
    paymentNotifications: boolean;
    marketing: boolean;
    locationBased: boolean;
}

interface PrivacySettings {
    profileVisibility: 'public' | 'private' | 'followers';
    showEmail: boolean;
    showPhone: boolean;
    allowMessages: boolean;
}

const DEFAULT_NOTIFICATIONS: NotificationSettings = {
    email: true,
    push: true,
    sms: false,
    eventReminders: true,
    eventNearby: true,
    eventUpdates: true,
    ticketSales: true,
    bookingRequests: true,
    bookingConfirmations: true,
    reviews: true,
    newMessages: true,
    paymentNotifications: true,
    marketing: false,
    locationBased: true,
};

const DEFAULT_PRIVACY: PrivacySettings = {
    profileVisibility: 'public',
    showEmail: false,
    showPhone: false,
    allowMessages: true,
};

export class SettingsService {
    /**
     * Get or create user settings
     */
    static async getSettings(userId: string) {
        let settings = await prisma.userSettings.findUnique({
            where: { userId },
        });

        if (!settings) {
            // Create default settings if not exists
            settings = await prisma.userSettings.create({
                data: {
                    userId,
                    notifications: DEFAULT_NOTIFICATIONS,
                    privacy: DEFAULT_PRIVACY,
                },
            });
        }

        return {
            id: settings.id,
            userId: settings.userId,
            notifications: settings.notifications as NotificationSettings,
            privacy: settings.privacy as PrivacySettings,
            createdAt: settings.createdAt.toISOString(),
            updatedAt: settings.updatedAt.toISOString(),
        };
    }

    /**
     * Update user settings (partial update)
     */
    static async updateSettings(userId: string, data: {
        notifications?: Partial<NotificationSettings>;
        privacy?: Partial<PrivacySettings>;
    }) {
        // Get current settings
        const current = await this.getSettings(userId);

        const updateData: any = {};

        if (data.notifications) {
            updateData.notifications = {
                ...(current.notifications as object),
                ...data.notifications,
            };
        }

        if (data.privacy) {
            updateData.privacy = {
                ...(current.privacy as object),
                ...data.privacy,
            };
        }

        const settings = await prisma.userSettings.update({
            where: { userId },
            data: updateData,
        });

        return {
            id: settings.id,
            userId: settings.userId,
            notifications: settings.notifications as NotificationSettings,
            privacy: settings.privacy as PrivacySettings,
            createdAt: settings.createdAt.toISOString(),
            updatedAt: settings.updatedAt.toISOString(),
        };
    }

    /**
     * Change user password
     */
    static async changePassword(userId: string, currentPassword: string, newPassword: string, confirmPassword: string) {
        if (newPassword !== confirmPassword) {
            throw new Error('Passwords do not match');
        }

        if (newPassword.length < 8) {
            throw new Error('Password must be at least 8 characters');
        }

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error('User not found');

        const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isValid) throw new Error('Current password is incorrect');

        const newHash = await bcrypt.hash(newPassword, 10);

        await prisma.user.update({
            where: { id: userId },
            data: { passwordHash: newHash },
        });

        return { message: 'Password changed successfully' };
    }

    /**
     * Delete user account (soft delete with 30-day grace period)
     */
    static async deleteAccount(userId: string, password: string, reason?: string) {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error('User not found');

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) throw new Error('Password is incorrect');

        // Soft delete - set deletedAt
        await prisma.user.update({
            where: { id: userId },
            data: { deletedAt: new Date() },
        });

        // Log the deletion reason if provided
        if (reason) {
            console.log(`[Account Deletion] User ${userId} reason: ${reason}`);
        }

        return { message: 'Account scheduled for deletion' };
    }
}
