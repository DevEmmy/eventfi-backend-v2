import { prisma } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { CommunityRole } from '@prisma/client';
import { CommunityAccessService } from './communityAccess.service';
import { EmailService } from './email.service';
import { EmailTemplates } from '../utils/email.templates';
import { NotificationService } from './notification.service';
import { slugify } from '../utils/slugify';

const USER_SELECT = { id: true, displayName: true, email: true, avatar: true } as const;
const CHAPTER_SELECT = { id: true, name: true, slug: true } as const;

interface CreateCommunityData {
    name: string;
    description?: string;
    logo?: string;
    bannerImage?: string;
}

interface InviteMemberData {
    emailOrUserId: string;
    role: CommunityRole;
    chapterId?: string;
}

interface ChapterEventsParams {
    page?: number;
    limit?: number;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateRoleScope(role: CommunityRole, chapterId?: string) {
    if (role === 'CHAPTER_LEAD' && !chapterId) {
        throw new Error('chapterId is required for CHAPTER_LEAD role');
    }
    if (role !== 'CHAPTER_LEAD' && chapterId) {
        throw new Error('chapterId must not be set for OWNER/ADMIN roles');
    }
}

export class CommunityService {
    /**
     * Create a community. The creator becomes its OWNER.
     */
    static async createCommunity(userId: string, data: CreateCommunityData) {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        if (!user) throw new Error('User not found');

        const baseSlug = slugify(data.name);
        let slug = baseSlug;
        let counter = 2;
        while (await prisma.community.findUnique({ where: { slug } })) {
            slug = `${baseSlug}-${counter++}`;
        }

        return prisma.community.create({
            data: {
                name: data.name,
                slug,
                description: data.description,
                logo: data.logo,
                bannerImage: data.bannerImage,
                ownerId: userId,
                members: {
                    create: { userId, email: user.email, role: 'OWNER', status: 'ACTIVE' },
                },
            },
            include: { chapters: true },
        });
    }

    /**
     * Get a community's details. Member list is only included for OWNER/ADMIN callers.
     */
    static async getCommunity(communityId: string, userId?: string) {
        const community = await prisma.community.findUnique({
            where: { id: communityId },
            include: { chapters: true },
        });
        if (!community) throw new Error('Community not found');

        let myRole: CommunityRole | null = null;
        let members: any = undefined;

        if (userId) {
            const membership = await prisma.communityMember.findFirst({
                where: { communityId, userId, status: 'ACTIVE' },
            });
            myRole = membership?.role ?? null;

            if (myRole === 'OWNER' || myRole === 'ADMIN') {
                members = await prisma.communityMember.findMany({
                    where: { communityId },
                    include: { user: { select: USER_SELECT }, chapter: { select: CHAPTER_SELECT } },
                    orderBy: { createdAt: 'asc' },
                });
            }
        }

        return { ...community, myRole, members };
    }

    /**
     * Public community page lookup by slug: community info, chapters, upcoming events
     * across all chapters, follower count, and the viewer's follow/membership status.
     */
    static async getCommunityBySlug(slug: string, userId?: string) {
        const community = await prisma.community.findUnique({
            where: { slug },
            include: { chapters: { select: CHAPTER_SELECT } },
        });
        if (!community) throw new Error('Community not found');

        const [upcomingEvents, followersCount] = await Promise.all([
            prisma.event.findMany({
                where: {
                    communityId: community.id,
                    status: 'PUBLISHED',
                    privacy: 'PUBLIC',
                    startDate: { gte: new Date() },
                },
                orderBy: { startDate: 'asc' },
                take: 24,
                include: {
                    tickets: { select: { price: true, currency: true } },
                    chapter: { select: CHAPTER_SELECT },
                },
            }),
            prisma.communityFollow.count({ where: { communityId: community.id } }),
        ]);

        let isFollowing = false;
        let myRole: CommunityRole | null = null;
        if (userId) {
            const [follow, membership] = await Promise.all([
                prisma.communityFollow.findUnique({ where: { userId_communityId: { userId, communityId: community.id } } }),
                prisma.communityMember.findFirst({ where: { communityId: community.id, userId, status: 'ACTIVE' } }),
            ]);
            isFollowing = !!follow;
            myRole = membership?.role ?? null;
        }

        return {
            id: community.id,
            name: community.name,
            slug: community.slug,
            description: community.description,
            logo: community.logo,
            bannerImage: community.bannerImage,
            chapters: community.chapters,
            followersCount,
            isFollowing,
            myRole,
            upcomingEvents,
        };
    }

    /**
     * List all communities the user is an active member of, with their role(s) per community.
     */
    static async listMyCommunities(userId: string) {
        const memberships = await prisma.communityMember.findMany({
            where: { userId, status: 'ACTIVE' },
            include: {
                community: { select: { id: true, name: true, slug: true, logo: true, bannerImage: true } },
                chapter: { select: CHAPTER_SELECT },
            },
            orderBy: { createdAt: 'asc' },
        });

        const byCommunity = new Map<string, any>();
        for (const m of memberships) {
            if (!byCommunity.has(m.communityId)) {
                byCommunity.set(m.communityId, { ...m.community, roles: [] as any[] });
            }
            byCommunity.get(m.communityId).roles.push({ role: m.role, chapter: m.chapter ?? null });
        }

        return Array.from(byCommunity.values());
    }

    /**
     * Update community details. Requires OWNER/ADMIN.
     */
    static async updateCommunity(userId: string, communityId: string, data: Partial<CreateCommunityData>) {
        await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'ADMIN' });

        return prisma.community.update({
            where: { id: communityId },
            data,
            include: { chapters: true },
        });
    }

    /**
     * Delete a community. Requires OWNER.
     */
    static async deleteCommunity(userId: string, communityId: string) {
        await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'OWNER' });

        await prisma.community.delete({ where: { id: communityId } });
        return { message: 'Community deleted' };
    }

    // ==================== CHAPTERS ====================

    /**
     * Create a chapter within a community. Requires OWNER/ADMIN.
     */
    static async createChapter(userId: string, communityId: string, data: { name: string }) {
        await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'ADMIN' });

        const baseSlug = slugify(data.name);
        let slug = baseSlug;
        let counter = 2;
        while (
            await prisma.communityChapter.findUnique({
                where: { communityId_slug: { communityId, slug } },
            })
        ) {
            slug = `${baseSlug}-${counter++}`;
        }

        return prisma.communityChapter.create({ data: { communityId, name: data.name, slug } });
    }

    /**
     * Update a chapter's name. Requires OWNER/ADMIN.
     */
    static async updateChapter(userId: string, communityId: string, chapterId: string, data: { name: string }) {
        await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'ADMIN' });

        const chapter = await prisma.communityChapter.findUnique({ where: { id: chapterId } });
        if (!chapter || chapter.communityId !== communityId) throw new Error('Chapter not found');

        return prisma.communityChapter.update({ where: { id: chapterId }, data: { name: data.name } });
    }

    /**
     * Delete a chapter. Requires OWNER/ADMIN. Blocked if the chapter still has events.
     */
    static async deleteChapter(userId: string, communityId: string, chapterId: string) {
        await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'ADMIN' });

        const chapter = await prisma.communityChapter.findUnique({ where: { id: chapterId } });
        if (!chapter || chapter.communityId !== communityId) throw new Error('Chapter not found');

        const eventCount = await prisma.event.count({ where: { chapterId } });
        if (eventCount > 0) throw new Error('Cannot delete a chapter that still has events');

        await prisma.communityChapter.delete({ where: { id: chapterId } });
        return { message: 'Chapter deleted' };
    }

    // ==================== MEMBERS ====================

    /**
     * List all members of a community. Requires OWNER/ADMIN.
     */
    static async listMembers(userId: string, communityId: string) {
        await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'ADMIN' });

        return prisma.communityMember.findMany({
            where: { communityId },
            include: { user: { select: USER_SELECT }, chapter: { select: CHAPTER_SELECT } },
            orderBy: { createdAt: 'asc' },
        });
    }

    /**
     * Invite a user (by id or email) to a community with a given role/chapter scope.
     * Requires OWNER/ADMIN.
     */
    static async inviteMember(userId: string, communityId: string, data: InviteMemberData) {
        await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'ADMIN' });
        validateRoleScope(data.role, data.chapterId);

        const community = await prisma.community.findUnique({ where: { id: communityId } });
        if (!community) throw new Error('Community not found');

        let chapter = null;
        if (data.chapterId) {
            chapter = await prisma.communityChapter.findUnique({ where: { id: data.chapterId } });
            if (!chapter || chapter.communityId !== communityId) throw new Error('Chapter not found');
        }

        const isUserId = UUID_REGEX.test(data.emailOrUserId);

        let targetUser = null;
        let email = data.emailOrUserId;

        if (isUserId) {
            targetUser = await prisma.user.findUnique({ where: { id: data.emailOrUserId }, select: USER_SELECT });
            if (!targetUser) throw new Error('User not found');
            email = targetUser.email;
        } else {
            targetUser = await prisma.user.findUnique({ where: { email: data.emailOrUserId }, select: USER_SELECT });
        }

        const existing = await prisma.communityMember.findFirst({
            where: {
                communityId,
                chapterId: data.chapterId ?? null,
                OR: [{ email }, ...(targetUser ? [{ userId: targetUser.id }] : [])],
            },
        });
        if (existing) throw new Error('This user is already a member of this community in that scope');

        const inviteToken = targetUser ? null : uuidv4();
        const member = await prisma.communityMember.create({
            data: {
                communityId,
                userId: targetUser?.id,
                email,
                role: data.role,
                chapterId: data.chapterId,
                status: targetUser ? 'ACTIVE' : 'PENDING',
                inviteToken,
            },
            include: { user: { select: USER_SELECT }, chapter: { select: CHAPTER_SELECT } },
        });

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const roleLabel = data.role.toLowerCase().replace('_', ' ');

        if (!targetUser && inviteToken) {
            const inviteUrl = `${frontendUrl}/communities/accept?token=${inviteToken}`;
            const template = EmailTemplates.communityInvitation({
                communityName: community.name,
                role: roleLabel,
                chapterName: chapter?.name,
                inviteUrl,
            });
            EmailService.send(email, template.subject, template.html, template.text).catch((err) =>
                console.error('Failed to send community invitation email:', err)
            );
        } else if (targetUser) {
            const communityUrl = `${frontendUrl}/communities/${communityId}/manage`;
            const template = EmailTemplates.communityMemberAdded({
                communityName: community.name,
                role: roleLabel,
                chapterName: chapter?.name,
                communityUrl,
            });
            EmailService.send(targetUser.email, template.subject, template.html, template.text).catch((err) =>
                console.error('Failed to send community member added email:', err)
            );

            NotificationService.create({
                userId: targetUser.id,
                type: 'COMMUNITY_INVITE',
                title: `Added to ${community.name}`,
                message: `You've been added to ${community.name} as ${chapter ? `${roleLabel} for ${chapter.name}` : roleLabel}.`,
                actionUrl: `${frontendUrl}/communities/${communityId}/manage`,
            }).catch(() => {});
        }

        return member;
    }

    /**
     * Update a member's role/chapter scope. Requires OWNER/ADMIN.
     */
    static async updateMemberRole(
        userId: string,
        communityId: string,
        memberId: string,
        data: { role: CommunityRole; chapterId?: string }
    ) {
        await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'ADMIN' });
        validateRoleScope(data.role, data.chapterId);

        const member = await prisma.communityMember.findUnique({ where: { id: memberId } });
        if (!member || member.communityId !== communityId) throw new Error('Member not found');

        if (data.chapterId) {
            const chapter = await prisma.communityChapter.findUnique({ where: { id: data.chapterId } });
            if (!chapter || chapter.communityId !== communityId) throw new Error('Chapter not found');
        }

        if (member.role === 'OWNER' && data.role !== 'OWNER') {
            const ownerCount = await prisma.communityMember.count({
                where: { communityId, role: 'OWNER', status: 'ACTIVE' },
            });
            if (ownerCount <= 1) throw new Error('Cannot change the role of the last owner');
        }

        return prisma.communityMember.update({
            where: { id: memberId },
            data: { role: data.role, chapterId: data.role === 'CHAPTER_LEAD' ? data.chapterId : null },
            include: { user: { select: USER_SELECT }, chapter: { select: CHAPTER_SELECT } },
        });
    }

    /**
     * Remove a member from a community. Requires OWNER/ADMIN.
     */
    static async removeMember(userId: string, communityId: string, memberId: string) {
        await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'ADMIN' });

        const member = await prisma.communityMember.findUnique({ where: { id: memberId } });
        if (!member || member.communityId !== communityId) throw new Error('Member not found');

        if (member.role === 'OWNER') {
            const ownerCount = await prisma.communityMember.count({
                where: { communityId, role: 'OWNER', status: 'ACTIVE' },
            });
            if (ownerCount <= 1) throw new Error('Cannot remove the last owner');
        }

        await prisma.communityMember.delete({ where: { id: memberId } });
        return { message: 'Member removed' };
    }

    /**
     * Accept a pending community invitation.
     */
    static async acceptInvite(inviteToken: string, userId: string) {
        const member = await prisma.communityMember.findFirst({ where: { inviteToken } });
        if (!member) throw new Error('Invalid invitation token');
        if (member.status !== 'PENDING') throw new Error('Invitation already used');

        const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
        if (!user) throw new Error('User not found');
        if (user.email !== member.email) throw new Error('Invitation was sent to a different email');

        await prisma.communityMember.update({
            where: { id: member.id },
            data: { userId, status: 'ACTIVE', inviteToken: null },
        });

        return { message: 'Invitation accepted', communityId: member.communityId };
    }

    // ==================== FOLLOW ====================

    /**
     * Follow a community.
     */
    static async followCommunity(userId: string, communityId: string) {
        const community = await prisma.community.findUnique({ where: { id: communityId }, select: { id: true } });
        if (!community) throw new Error('Community not found');

        try {
            await prisma.communityFollow.create({ data: { userId, communityId } });
            return { message: 'Successfully followed community' };
        } catch (error: any) {
            if (error.code === 'P2002') throw new Error('You are already following this community');
            throw error;
        }
    }

    /**
     * Unfollow a community.
     */
    static async unfollowCommunity(userId: string, communityId: string) {
        const follow = await prisma.communityFollow.findUnique({
            where: { userId_communityId: { userId, communityId } },
        });
        if (!follow) throw new Error('Not following this community');

        await prisma.communityFollow.delete({ where: { userId_communityId: { userId, communityId } } });
        return { message: 'Successfully unfollowed community' };
    }

    // ==================== OVERVIEW & EVENTS ====================

    /**
     * Cross-chapter dashboard for OWNER/ADMIN: per-chapter event/attendee/revenue breakdown.
     */
    static async getOverview(userId: string, communityId: string) {
        await CommunityAccessService.checkAccess(userId, communityId, { minRole: 'ADMIN' });

        const community = await prisma.community.findUnique({
            where: { id: communityId },
            include: { chapters: true },
        });
        if (!community) throw new Error('Community not found');

        const events = await prisma.event.findMany({
            where: { communityId },
            select: {
                id: true,
                title: true,
                status: true,
                startDate: true,
                attendeesCount: true,
                chapterId: true,
                orders: { where: { status: 'CONFIRMED' }, select: { total: true } },
            },
        });

        const now = new Date();
        const summarize = (rows: typeof events) => ({
            eventCount: rows.length,
            upcomingCount: rows.filter((e) => e.startDate >= now).length,
            pastCount: rows.filter((e) => e.startDate < now).length,
            totalAttendees: rows.reduce((sum, e) => sum + e.attendeesCount, 0),
            totalRevenue: rows.reduce((sum, e) => sum + e.orders.reduce((s, o) => s + o.total, 0), 0),
        });

        return {
            community: { id: community.id, name: community.name, slug: community.slug },
            totals: summarize(events),
            unassigned: summarize(events.filter((e) => !e.chapterId)),
            chapters: community.chapters.map((chapter) => ({
                id: chapter.id,
                name: chapter.name,
                slug: chapter.slug,
                ...summarize(events.filter((e) => e.chapterId === chapter.id)),
            })),
        };
    }

    /**
     * Paginated list of events within a chapter. Accessible to OWNER/ADMIN, or the
     * CHAPTER_LEAD(s) of that chapter.
     */
    static async getChapterEvents(userId: string, communityId: string, chapterId: string, params: ChapterEventsParams) {
        await CommunityAccessService.checkAccess(userId, communityId, { chapterId, minRole: 'CHAPTER_LEAD' });

        const chapter = await prisma.communityChapter.findUnique({ where: { id: chapterId } });
        if (!chapter || chapter.communityId !== communityId) throw new Error('Chapter not found');

        const page = params.page || 1;
        const limit = params.limit || 12;

        const [events, total] = await Promise.all([
            prisma.event.findMany({
                where: { communityId, chapterId },
                orderBy: { startDate: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            prisma.event.count({ where: { communityId, chapterId } }),
        ]);

        return { events, total, page, totalPages: Math.ceil(total / limit) || 1 };
    }
}
