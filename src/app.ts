import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import v1Routes from './v1/routes';
import cors from 'cors';
import compression from 'compression';

const app = express();

// Trust proxy (required behind reverse proxies like Render, Railway, etc.)
app.set('trust proxy', 1);

// Gzip compression (skip for already-compressed images/videos)
app.use(compression({
    filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
    },
    level: 6,
}));

// Security headers
app.use(helmet());

// CORS
app.use(cors({
    origin: process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',')
        : ['https://eventfi.live', 'https://www.eventfi.live', 'http://localhost:3000', 'http://localhost:3001'],
}));

// Body parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global rate limiter: 500 requests per 15 minutes per IP
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many requests, please try again later.' },
});
app.use(globalLimiter);

// Strict rate limiter for auth endpoints: 10 requests per 15 minutes per IP
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message: 'Too many authentication attempts, please try again later.' },
});
app.use('/api/v1/auth/login', authLimiter);
app.use('/api/v1/auth/signup', authLimiter);
app.use('/api/v1/auth/forgot-password', authLimiter);
app.use('/api/v1/auth/google', authLimiter);

app.use('/api/v1', v1Routes);

export default app;
