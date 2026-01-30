import { prisma } from '../config/database';
import { EventPrivacy } from '@prisma/client';

interface SocialLinks {
    twitter?: string;
    instagram?: string;
    linkedin?: string;
    facebook?: string;
}

interface UserStats {
    eventsHosted: number;
    eventsAttended: number;
    followers: number;
    following: number;
}

export class UserService {
    /**
     * Get full profile with stats for authenticated user
     */
    static async getFullProfile(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                username: true,
                displayName: true,
                avatar: true,
                bio: true,
                location: true,
                website: true,
                socialLinks: true,
                isVerified: true,
                roles: true,
                createdAt: true,
                updatedAt: true,
                lastLoginAt: true,
            }
        });

        if (!user) throw new Error('User not found');

        const stats = await this.getUserStats(userId);

        return {
            ...user,
            socialLinks: user.socialLinks as SocialLinks | null,
            stats,
            isOwnProfile: true,
        };
    }

    /**
     * Get user stats
     */
    static async getUserStats(userId: string): Promise<UserStats> {
        const [eventsHosted, eventsAttended, followers, following] = await prisma.$transaction([
            prisma.event.count({ where: { organizerId: userId } }),
            prisma.userTicket.count({ where: { userId, status: 'valid' } }),
            prisma.follow.count({ where: { followingId: userId } }),
            prisma.follow.count({ where: { followerId: userId } }),
        ]);

        return { eventsHosted, eventsAttended, followers, following };
    }

    /**
     * Get public profile by username
     */
    static async getPublicProfile(username: string, viewerId?: string) {
        const user = await prisma.user.findUnique({
            where: { username },
            select: {
                id: true,
                username: true,
                displayName: true,
                avatar: true,
                bio: true,
                location: true,
                website: true,
                socialLinks: true,
                isVerified: true,
                roles: true,
                createdAt: true,
            }
        });

        if (!user) throw new Error('User not found');

        const stats = await this.getUserStats(user.id);

        let isFollowing = false;
        if (viewerId) {
            const follow = await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: viewerId, followingId: user.id } }
            });
            isFollowing = !!follow;
        }

        return {
            ...user,
            socialLinks: user.socialLinks as SocialLinks | null,
            stats,
            isFollowing,
            isOwnProfile: viewerId === user.id,
        };
    }

    /**
     * Get user's hosted events with filtering
     */
    static async getUserEvents(userId: string, status?: string, page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;
        const where: any = { organizerId: userId };
        if (status) where.status = status;

        const [total, events] = await prisma.$transaction([
            prisma.event.count({ where }),
            prisma.event.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    tickets: { select: { type: true, price: true, currency: true } },
                }
            })
        ]);

        return {
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
            data: events
        };
    }

    /**
     * Get user's purchased tickets
     */
    static async getUserTickets(userId: string, status?: string, page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;
        const now = new Date();

        let where: any = { userId };
        if (status === 'upcoming') {
            where.event = { startDate: { gte: now } };
        } else if (status === 'past') {
            where.event = { startDate: { lt: now } };
        }

        const [total, tickets] = await prisma.$transaction([
            prisma.userTicket.count({ where }),
            prisma.userTicket.findMany({
                where,
                skip,
                take: limit,
                orderBy: { purchaseDate: 'desc' },
                include: {
                    ticket: { select: { name: true, type: true, price: true, currency: true } },
                    event: {
                        select: {
                            id: true,
                            title: true,
                            coverImage: true,
                            startDate: true,
                            venueName: true,
                            city: true,
                        }
                    }
                }
            })
        ]);

        return {
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
            data: tickets.map(t => ({
                id: t.id,
                eventId: t.eventId,
                event: t.event,
                ticketType: t.ticket.name,
                purchaseDate: t.purchaseDate.toISOString(),
                status: t.status,
                qrCode: t.qrCode,
            }))
        };
    }

    /**
     * Get user's favorited events
     */
    static async getUserFavorites(userId: string, page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;
        const where = { userId };

        const [total, favorites] = await prisma.$transaction([
            prisma.favorite.count({ where }),
            prisma.favorite.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    event: {
                        include: {
                            tickets: { select: { type: true, price: true, currency: true } },
                            organizer: { select: { id: true, displayName: true, avatar: true, isVerified: true } }
                        }
                    }
                }
            })
        ]);

        return {
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
            data: favorites.map(f => f.event)
        };
    }

    /**
     * Follow a user
     */
    static async followUser(followerId: string, followingId: string) {
        if (followerId === followingId) throw new Error('You cannot follow yourself');

        try {
            await prisma.follow.create({
                data: { followerId, followingId }
            });
            return { message: 'Successfully followed user' };
        } catch (error: any) {
            if (error.code === 'P2002') throw new Error('Already following this user');
            throw error;
        }
    }

    /**
     * Unfollow a user
     */
    static async unfollowUser(followerId: string, followingId: string) {
        const follow = await prisma.follow.findUnique({
            where: { followerId_followingId: { followerId, followingId } }
        });

        if (!follow) throw new Error('Not following this user');

        await prisma.follow.delete({
            where: { followerId_followingId: { followerId, followingId } }
        });

        return { message: 'Successfully unfollowed user' };
    }

    /**
     * Save/favorite an event
     */
    static async saveEvent(userId: string, eventId: string) {
        // Check event exists
        const event = await prisma.event.findUnique({ where: { id: eventId } });
        if (!event) throw new Error('Event not found');

        try {
            await prisma.favorite.create({
                data: { userId, eventId }
            });

            // Increment favorites count on event
            await prisma.event.update({
                where: { id: eventId },
                data: { favoritesCount: { increment: 1 } }
            });

            return { message: 'Event saved successfully' };
        } catch (error: any) {
            if (error.code === 'P2002') throw new Error('Event already saved');
            throw error;
        }
    }

    /**
     * Unsave/unfavorite an event
     */
    static async unsaveEvent(userId: string, eventId: string) {
        const favorite = await prisma.favorite.findUnique({
            where: { userId_eventId: { userId, eventId } }
        });

        if (!favorite) throw new Error('Event not saved');

        await prisma.favorite.delete({
            where: { userId_eventId: { userId, eventId } }
        });

        // Decrement favorites count on event
        await prisma.event.update({
            where: { id: eventId },
            data: { favoritesCount: { decrement: 1 } }
        });

        return { message: 'Event unsaved successfully' };
    }
}
