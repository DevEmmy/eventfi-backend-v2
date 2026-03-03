import { z } from 'zod';

export const signupSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
    email: z.string().email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
    token: z.string().min(1, 'Token is required'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const googleAuthSchema = z.object({
    idToken: z.string().min(1, 'Google ID token is required'),
});

export const updateProfileSchema = z.object({
    username: z.string().min(3).max(30).optional(),
    displayName: z.string().min(1).max(100).optional(),
    avatar: z.string().url().optional().or(z.literal('')),
    interests: z.array(z.string()).optional(),
    bio: z.string().max(500).optional(),
    location: z.string().max(200).optional(),
    website: z.string().url().optional().or(z.literal('')),
    socialLinks: z.record(z.string(), z.string()).optional(),
});

export const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm password is required'),
}).refine(data => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
});

export const deleteAccountSchema = z.object({
    password: z.string().min(1, 'Password is required'),
    reason: z.string().optional(),
});
