import { prisma } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { ManageService } from './manage.service';

const ROLE_PERMISSIONS: Record<string, any> = {
    ORGANIZER: { canEdit: true, canManageAttendees: true, canViewAnalytics: true, canManageTeam: true },
    CO_HOST: { canEdit: true, canManageAttendees: true, canViewAnalytics: true, canManageTeam: false },
    MANAGER: { canEdit: false, canManageAttendees: true, canViewAnalytics: true, canManageTeam: false },
    ASSISTANT: { canEdit: false, canManageAttendees: false, canViewAnalytics: false, canManageTeam: false },
};

export class TeamService {
    /**
     * Get team members for an event
     */
    static async getTeamMembers(eventId: string, userId: string) {
        await ManageService.checkEventAccess(userId, eventId);

        // Get event organizer
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: { organizer: { select: { id: true, displayName: true, email: true, avatar: true } } }
        });

        if (!event) throw new Error('Event not found');

        // Get team members
        const teamMembers = await prisma.eventTeamMember.findMany({
            where: { eventId },
            include: {
                user: { select: { id: true, displayName: true, email: true, avatar: true } }
            },
            orderBy: { createdAt: 'asc' }
        });

        // Format response
        const members = [
            // Organizer as first member
            {
                id: 'organizer',
                userId: event.organizer.id,
                name: event.organizer.displayName || event.organizer.email,
                email: event.organizer.email,
                avatar: event.organizer.avatar,
                role: 'organizer',
                addedDate: event.createdAt.toISOString(),
                status: 'active',
                permissions: ROLE_PERMISSIONS.ORGANIZER
            },
            // Team members
            ...teamMembers.map(m => ({
                id: m.id,
                userId: m.userId,
                name: m.user?.displayName || m.email,
                email: m.email,
                avatar: m.user?.avatar,
                role: m.role.toLowerCase().replace('_', '-'),
                addedDate: m.createdAt.toISOString(),
                status: m.status.toLowerCase(),
                permissions: ROLE_PERMISSIONS[m.role] || ROLE_PERMISSIONS.ASSISTANT
            }))
        ];

        return { members };
    }

    /**
     * Add team member
     */
    static async addTeamMember(
        eventId: string,
        userId: string,
        userIdOrEmail: string,
        role: 'CO_HOST' | 'MANAGER' | 'ASSISTANT'
    ) {
        await ManageService.checkEventAccess(userId, eventId, 'canManageTeam');

        // Check if it's a UUID (existing user) or email (new invitation)
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const isUserId = uuidRegex.test(userIdOrEmail);

        let targetUser = null;
        let email = userIdOrEmail;
        let invitationSent = false;

        if (isUserId) {
            targetUser = await prisma.user.findUnique({
                where: { id: userIdOrEmail },
                select: { id: true, email: true, displayName: true, avatar: true }
            });
            if (!targetUser) throw new Error('User not found');
            email = targetUser.email;
        } else {
            // Check if email belongs to existing user
            targetUser = await prisma.user.findUnique({
                where: { email: userIdOrEmail },
                select: { id: true, email: true, displayName: true, avatar: true }
            });
        }

        // Check if already a team member
        const existing = await prisma.eventTeamMember.findFirst({
            where: { eventId, OR: [{ email }, { userId: targetUser?.id }] }
        });
        if (existing) throw new Error('User is already a team member');

        // Check if user is the organizer
        const event = await prisma.event.findUnique({ where: { id: eventId } });
        if (event?.organizerId === targetUser?.id) {
            throw new Error('Cannot add event organizer as team member');
        }

        // Create team member
        const inviteToken = targetUser ? null : uuidv4();
        const member = await prisma.eventTeamMember.create({
            data: {
                eventId,
                userId: targetUser?.id,
                email,
                role: role as any,
                status: targetUser ? 'ACTIVE' : 'PENDING',
                inviteToken
            },
            include: { user: { select: { id: true, displayName: true, email: true, avatar: true } } }
        });

        if (!targetUser) {
            // TODO: Send invitation email
            console.log(`[Team Invite] Sending invitation to ${email} for event ${eventId}`);
            invitationSent = true;
        }

        return {
            member: {
                id: member.id,
                userId: member.userId,
                name: member.user?.displayName || member.email,
                email: member.email,
                avatar: member.user?.avatar,
                role: member.role.toLowerCase().replace('_', '-'),
                addedDate: member.createdAt.toISOString(),
                status: member.status.toLowerCase(),
                permissions: ROLE_PERMISSIONS[member.role]
            },
            invitationSent
        };
    }

    /**
     * Update team member role
     */
    static async updateTeamMember(eventId: string, memberId: string, userId: string, role: string) {
        await ManageService.checkEventAccess(userId, eventId, 'canManageTeam');

        const member = await prisma.eventTeamMember.findUnique({
            where: { id: memberId }
        });

        if (!member) throw new Error('Team member not found');
        if (member.eventId !== eventId) throw new Error('Team member does not belong to this event');

        const updated = await prisma.eventTeamMember.update({
            where: { id: memberId },
            data: { role: role.toUpperCase().replace('-', '_') as any },
            include: { user: { select: { id: true, displayName: true, email: true, avatar: true } } }
        });

        return {
            id: updated.id,
            userId: updated.userId,
            name: updated.user?.displayName || updated.email,
            email: updated.email,
            avatar: updated.user?.avatar,
            role: updated.role.toLowerCase().replace('_', '-'),
            addedDate: updated.createdAt.toISOString(),
            status: updated.status.toLowerCase(),
            permissions: ROLE_PERMISSIONS[updated.role]
        };
    }

    /**
     * Remove team member
     */
    static async removeTeamMember(eventId: string, memberId: string, userId: string) {
        await ManageService.checkEventAccess(userId, eventId, 'canManageTeam');

        const member = await prisma.eventTeamMember.findUnique({
            where: { id: memberId }
        });

        if (!member) throw new Error('Team member not found');
        if (member.eventId !== eventId) throw new Error('Team member does not belong to this event');

        await prisma.eventTeamMember.delete({ where: { id: memberId } });

        return { message: 'Team member removed' };
    }

    /**
     * Search users for team member addition
     */
    static async searchUsers(query: string, excludeEventTeam?: string) {
        if (query.length < 3) return [];

        const users = await prisma.user.findMany({
            where: {
                OR: [
                    { displayName: { contains: query, mode: 'insensitive' } },
                    { email: { contains: query, mode: 'insensitive' } }
                ]
            },
            select: { id: true, displayName: true, email: true, avatar: true },
            take: 10
        });

        if (excludeEventTeam) {
            // Get existing team member user IDs
            const teamMembers = await prisma.eventTeamMember.findMany({
                where: { eventId: excludeEventTeam },
                select: { userId: true }
            });
            const teamUserIds = new Set(teamMembers.map(m => m.userId).filter(Boolean));

            // Get organizer ID
            const event = await prisma.event.findUnique({
                where: { id: excludeEventTeam },
                select: { organizerId: true }
            });
            if (event) teamUserIds.add(event.organizerId);

            return users.filter(u => !teamUserIds.has(u.id)).map(u => ({
                id: u.id,
                name: u.displayName || u.email,
                email: u.email,
                avatar: u.avatar
            }));
        }

        return users.map(u => ({
            id: u.id,
            name: u.displayName || u.email,
            email: u.email,
            avatar: u.avatar
        }));
    }

    /**
     * Accept team invitation
     */
    static async acceptInvitation(inviteToken: string, userId: string) {
        const member = await prisma.eventTeamMember.findFirst({
            where: { inviteToken }
        });

        if (!member) throw new Error('Invalid invitation token');
        if (member.status !== 'PENDING') throw new Error('Invitation already used');

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true }
        });

        if (!user) throw new Error('User not found');
        if (user.email !== member.email) throw new Error('Invitation was sent to a different email');

        await prisma.eventTeamMember.update({
            where: { id: member.id },
            data: { userId, status: 'ACTIVE', inviteToken: null }
        });

        return { message: 'Invitation accepted', eventId: member.eventId };
    }
}
