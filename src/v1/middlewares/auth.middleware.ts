import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import redis from '../config/redis';

if (!process.env.JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start without it.');
}
const JWT_SECRET: string = process.env.JWT_SECRET;

const USER_CACHE_TTL = 300; // 5 minutes

export interface AuthRequest extends Request {
    user?: any;
}

async function fetchUser(userId: string) {
    // 1. Try Redis cache
    try {
        const cached = await redis.get(`user:${userId}`);
        if (cached) return JSON.parse(cached);
    } catch {
        // Redis unavailable — fall through to DB
    }

    // 2. Hit the DB — exclude passwordHash so it is never stored in Redis
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true, email: true, username: true, displayName: true,
            avatar: true, bio: true, location: true, website: true,
            socialLinks: true, interests: true, roles: true,
            isVerified: true, googleId: true,
            createdAt: true, updatedAt: true, lastLoginAt: true,
        },
    });
    if (!user) return null;

    // 3. Warm the cache (non-blocking) — no passwordHash ever touches Redis
    redis.set(`user:${userId}`, JSON.stringify(user), 'EX', USER_CACHE_TTL).catch(() => {});

    return user;
}

/** Call this whenever a user's profile is updated so the cache doesn't go stale. */
export async function invalidateUserCache(userId: string) {
    try {
        await redis.del(`user:${userId}`);
    } catch {
        // Redis unavailable — no-op
    }
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized: No token provided',
            });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };

        const user = await fetchUser(decoded.userId);

        if (!user) {
            return res.status(401).json({
                status: 'error',
                message: 'Unauthorized: User not found',
            });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(401).json({
            status: 'error',
            message: 'Unauthorized: Invalid token',
        });
    }
};

/**
 * Optional authentication — doesn't fail if no token, just sets req.user if valid.
 */
export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };

        const user = await fetchUser(decoded.userId);
        if (user) req.user = user;
        next();
    } catch {
        next();
    }
};
