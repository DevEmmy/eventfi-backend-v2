import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/database';
import { EmailService } from './email.service';
import { EmailTemplates } from '../utils/email.templates';
import { CloudinaryService } from '../utils/cloudinary.service';
import { invalidateUserCache } from '../middlewares/auth.middleware';

const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || '10');
if (!process.env.JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set.');
}
const JWT_SECRET: string = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const RESET_TOKEN_EXPIRY = 3600; // 1 hour in seconds

export class AuthService {
    static async signup(email: string, password: string) {
        // ... (existing code)
        const existingUser = await prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            throw new Error('User with this email already exists');
        }

        const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

        // Generate email verification token
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
                emailVerificationToken: verificationToken,
                emailVerificationExpires: verificationExpires,
            },
        });

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET as jwt.Secret,
            { expiresIn: JWT_EXPIRES_IN as any }
        );

        // Send verification email directly
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const verifyUrl = `${frontendUrl}/auth/verify-email?token=${verificationToken}`;
        const template = EmailTemplates.emailVerification(verifyUrl);
        EmailService.send(user.email, template.subject, template.html, template.text).catch(err =>
            console.error('Failed to send verification email:', err)
        );

        return {
            user: {
                id: user.id,
                email: user.email,
                isVerified: user.isVerified,
            },
            token,
        };
    }

    static async login(email: string, password: string) {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            throw new Error('Invalid email or password');
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            throw new Error('Invalid email or password');
        }

        await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
        });

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET as jwt.Secret,
            { expiresIn: JWT_EXPIRES_IN as any }
        );

        return {
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                displayName: user.displayName,
                isVerified: user.isVerified,
            },
            token,
        };
    }

    static async forgotPassword(email: string) {
        const user = await prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            // We don't want to reveal if a user exists or not for security reasons
            // but for now, we'll just return.
            return { message: 'If an account exists with this email, a reset link has been sent.' };
        }

        // Generate a random token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = new Date(Date.now() + RESET_TOKEN_EXPIRY * 1000);

        // Store in Database
        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetPasswordToken: resetToken,
                resetPasswordExpires: resetExpires,
            },
        });

        // Send password reset email
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/reset-password?token=${resetToken}`;
        await EmailService.sendPasswordResetEmail(user.email, resetUrl);

        return { message: 'If an account exists with this email, a reset link has been sent.' };
    }

    static async resetPassword(token: string, newPassword: string) {
        const user = await prisma.user.findFirst({
            where: {
                resetPasswordToken: token,
                resetPasswordExpires: { gt: new Date() },
            },
        });

        if (!user) {
            throw new Error('Invalid or expired reset token');
        }

        const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                passwordHash,
                resetPasswordToken: null,
                resetPasswordExpires: null,
            },
        });

        return { message: 'Password has been reset successfully' };
    }

    static async updateProfile(userId: string, data: {
        username?: string;
        displayName?: string;
        avatar?: string;
        interests?: any[];
        bio?: string;
        location?: string;
        website?: string;
        socialLinks?: { twitter?: string; instagram?: string; linkedin?: string; facebook?: string };
    }) {
        // Upload avatar to Cloudinary when a base64 data URI is provided.
        // Using a stable public_id keyed to the user means re-uploads overwrite
        // the same Cloudinary asset rather than accumulating orphaned files.
        if (data.avatar) {
            data.avatar = await CloudinaryService.ensureCloudinaryUrl(
                data.avatar,
                'avatars',
                `user_${userId}`,
            );
        }

        // Check if username is taken by another user
        if (data.username) {
            const existingUser = await prisma.user.findFirst({
                where: {
                    username: data.username,
                    id: { not: userId },
                },
            });

            if (existingUser) {
                throw new Error('Username is already taken');
            }
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: {
                ...(data.username && { username: data.username }),
                ...(data.displayName && { displayName: data.displayName }),
                ...(data.avatar && { avatar: data.avatar }),
                ...(data.interests && { interests: data.interests }),
                ...(data.bio !== undefined && { bio: data.bio }),
                ...(data.location !== undefined && { location: data.location }),
                ...(data.website !== undefined && { website: data.website }),
                ...(data.socialLinks && { socialLinks: data.socialLinks }),
            },
            select: {
                id: true,
                email: true,
                username: true,
                displayName: true,
                avatar: true,
                bio: true,
                location: true,
                website: true,
                socialLinks: true,
                isVerified: true,
                createdAt: true,
                updatedAt: true,
                interests: true,
            },
        });

        // Bust the auth-middleware cache so the next request sees fresh data
        invalidateUserCache(userId).catch(() => {});

        return updatedUser;
    }

    /**
     * Google OAuth authentication
     * Verifies Google ID token and creates/logs in user
     */
    static async googleAuth(idToken: string) {
        const { OAuth2Client } = await import('google-auth-library');

        const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
        if (!GOOGLE_CLIENT_ID) {
            throw new Error('Google OAuth is not configured');
        }

        const client = new OAuth2Client(GOOGLE_CLIENT_ID);

        let payload;
        try {
            const ticket = await client.verifyIdToken({
                idToken,
                audience: GOOGLE_CLIENT_ID,
            });
            payload = ticket.getPayload();
        } catch (error) {
            throw new Error('Invalid Google token');
        }

        if (!payload || !payload.email) {
            throw new Error('Invalid Google token payload');
        }

        const { email, name, picture, sub: googleId, email_verified } = payload;

        // Check if user exists
        let user = await prisma.user.findUnique({
            where: { email },
        });

        if (user) {
            // Existing user - update Google ID if not set, and update last login
            if (!user.googleId) {
                user = await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        googleId,
                        lastLoginAt: new Date(),
                        // Auto-verify if Google email is verified
                        ...(email_verified && !user.isVerified && { isVerified: true }),
                    },
                });
            } else {
                await prisma.user.update({
                    where: { id: user.id },
                    data: { lastLoginAt: new Date() },
                });
            }
        } else {
            // New user - create account
            user = await prisma.user.create({
                data: {
                    email,
                    googleId,
                    displayName: name || undefined,
                    avatar: picture || undefined,
                    isVerified: email_verified || false,
                    // No password for Google users
                    passwordHash: '',
                },
            });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            JWT_SECRET as jwt.Secret,
            { expiresIn: JWT_EXPIRES_IN as any }
        );

        // Send welcome email for brand new users
        if (!user.username) {
            EmailService.sendWelcomeEmail(user.email, user.displayName || user.email.split('@')[0]);
        }

        return {
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                displayName: user.displayName,
                avatar: user.avatar,
                isVerified: user.isVerified,
                isNewUser: !user.username, // True if user needs to complete onboarding
            },
            token,
        };
    }

    /**
     * Verify email address using token
     */
    static async verifyEmail(token: string) {
        const user = await prisma.user.findFirst({
            where: {
                emailVerificationToken: token,
                emailVerificationExpires: { gt: new Date() },
            },
        });

        if (!user) {
            throw new Error('Invalid or expired verification token');
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                isVerified: true,
                emailVerificationToken: null,
                emailVerificationExpires: null,
            },
        });

        // Send welcome email now that they're verified
        const welcomeTemplate = EmailTemplates.welcome(user.displayName || user.email.split('@')[0]);
        EmailService.send(user.email, welcomeTemplate.subject, welcomeTemplate.html, welcomeTemplate.text).catch(err =>
            console.error('Failed to send welcome email:', err)
        );

        return { message: 'Email verified successfully' };
    }

    /**
     * Resend verification email
     */
    static async resendVerification(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) throw new Error('User not found');
        if (user.isVerified) throw new Error('Email is already verified');

        const verificationToken = crypto.randomBytes(32).toString('hex');
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

        await prisma.user.update({
            where: { id: user.id },
            data: {
                emailVerificationToken: verificationToken,
                emailVerificationExpires: verificationExpires,
            },
        });

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const verifyUrl = `${frontendUrl}/auth/verify-email?token=${verificationToken}`;
        const resendTemplate = EmailTemplates.emailVerification(verifyUrl);
        EmailService.send(user.email, resendTemplate.subject, resendTemplate.html, resendTemplate.text).catch(err =>
            console.error('Failed to send verification email:', err)
        );

        return { message: 'Verification email sent' };
    }
}

