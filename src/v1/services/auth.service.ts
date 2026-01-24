import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/database';
import redis from '../config/redis';

const SALT_ROUNDS = parseInt(process.env.SALT_ROUNDS || '10');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
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

        const user = await prisma.user.create({
            data: {
                email,
                passwordHash,
            },
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
            // but for now, let's keep it simple or return success anyway
            return;
        }

        // Generate a random token
        const resetToken = crypto.randomBytes(32).toString('hex');

        // Store in Redis with expiry
        const redisKey = `reset_password:${resetToken}`;
        await redis.set(redisKey, user.id, 'EX', RESET_TOKEN_EXPIRY);

        // In a real app, send an email. For now, log it.
        console.log(`[DEBUG] Password reset token for ${email}: ${resetToken}`);
        console.log(`[DEBUG] Reset URL: http://localhost:3000/reset-password?token=${resetToken}`);

        return { message: 'If an account exists with this email, a reset link has been sent.' };
    }

    static async resetPassword(token: string, newPassword: string) {
        const redisKey = `reset_password:${token}`;
        const userId = await redis.get(redisKey);

        if (!userId) {
            throw new Error('Invalid or expired reset token');
        }

        const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

        await prisma.user.update({
            where: { id: userId },
            data: { passwordHash },
        });

        // Delete token after use
        await redis.del(redisKey);

        return { message: 'Password has been reset successfully' };
    }
}
