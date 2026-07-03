import { z } from 'zod';

export const createCommunitySchema = z.object({
    name: z.string().min(1, 'Name is required').max(100),
    description: z.string().max(2000).optional(),
    logo: z.string().optional(),
    bannerImage: z.string().optional(),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
});

export const updateCommunitySchema = createCommunitySchema.partial();

export const createChapterSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100),
});

export const updateChapterSchema = createChapterSchema;

const communityRoleEnum = z.enum(['OWNER', 'ADMIN', 'CHAPTER_LEAD']);

const chapterScopeRefinement = (data: { role: string; chapterId?: string }, ctx: z.RefinementCtx) => {
    if (data.role === 'CHAPTER_LEAD' && !data.chapterId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'chapterId is required when role is CHAPTER_LEAD',
            path: ['chapterId'],
        });
    }
    if (data.role !== 'CHAPTER_LEAD' && data.chapterId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'chapterId must not be set for OWNER/ADMIN roles',
            path: ['chapterId'],
        });
    }
};

export const inviteMemberSchema = z.object({
    emailOrUserId: z.string().min(1, 'emailOrUserId is required'),
    role: communityRoleEnum,
    chapterId: z.string().uuid().optional(),
}).superRefine(chapterScopeRefinement);

export const updateMemberSchema = z.object({
    role: communityRoleEnum,
    chapterId: z.string().uuid().optional(),
}).superRefine(chapterScopeRefinement);
