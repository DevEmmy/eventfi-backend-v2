import { prisma } from '../config/database';
import { CommunityRole } from '@prisma/client';

const ROLE_RANK: Record<CommunityRole, number> = {
    CHAPTER_LEAD: 1,
    ADMIN: 2,
    OWNER: 3,
};

export interface CommunityAccess {
    role: CommunityRole;
    /** Chapters this user leads directly (empty for OWNER/ADMIN, who have access to all chapters). */
    chapterIds: string[];
}

export class CommunityAccessService {
    /**
     * Verify a user's access to a community, optionally requiring a minimum role
     * and/or scoping the check to a specific chapter (required for CHAPTER_LEAD access).
     */
    static async checkAccess(
        userId: string,
        communityId: string,
        opts: { chapterId?: string | null; minRole?: CommunityRole } = {}
    ): Promise<CommunityAccess> {
        const community = await prisma.community.findUnique({
            where: { id: communityId },
            select: { id: true },
        });
        if (!community) throw new Error('Community not found');

        const memberships = await prisma.communityMember.findMany({
            where: { communityId, userId, status: 'ACTIVE' },
        });
        if (memberships.length === 0) throw new Error('Forbidden');

        const role = memberships.reduce<CommunityRole>(
            (highest, m) => (ROLE_RANK[m.role] > ROLE_RANK[highest] ? m.role : highest),
            memberships[0].role
        );

        const chapterIds = memberships
            .filter((m) => m.role === 'CHAPTER_LEAD' && m.chapterId)
            .map((m) => m.chapterId as string);

        if (opts.minRole && ROLE_RANK[role] < ROLE_RANK[opts.minRole]) {
            throw new Error('Forbidden');
        }

        // OWNER/ADMIN have access to every chapter; CHAPTER_LEAD only to their own.
        if (opts.chapterId && role === 'CHAPTER_LEAD' && !chapterIds.includes(opts.chapterId)) {
            throw new Error('Forbidden');
        }

        return { role, chapterIds };
    }
}
