import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

if (!process.env.ADMIN_JWT_SECRET) {
    throw new Error('FATAL: ADMIN_JWT_SECRET environment variable is not set.');
}
const ADMIN_JWT_SECRET: string = process.env.ADMIN_JWT_SECRET;

export interface AdminRequest extends Request {
    admin?: { id: string; email: string; name: string };
}

/**
 * Middleware that verifies an admin-scoped JWT (signed with ADMIN_JWT_SECRET).
 * Admin tokens are issued by POST /api/v1/admin/auth/login and carry
 * { id, email, name, role: 'admin' } in the payload.
 */
export const requireAdmin = (req: AdminRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ status: 'error', message: 'Admin token required' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, ADMIN_JWT_SECRET) as {
            id: string;
            email: string;
            name: string;
            role: string;
        };

        if (decoded.role !== 'admin') {
            return res.status(403).json({ status: 'error', message: 'Forbidden: admin access only' });
        }

        req.admin = { id: decoded.id, email: decoded.email, name: decoded.name };
        next();
    } catch {
        return res.status(401).json({ status: 'error', message: 'Invalid or expired admin token' });
    }
};
