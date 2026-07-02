import { z } from 'zod';

export const createPostSchema = z.object({
    content: z.string().min(1, 'Content is required').max(3000),
    images: z.array(z.string()).max(10).optional(),
});

export const createCommentSchema = z.object({
    content: z.string().min(1, 'Comment is required').max(1000),
});
