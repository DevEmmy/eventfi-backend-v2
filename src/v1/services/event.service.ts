import { prisma } from '../config/database';
import { EventCategory, EventStatus, EventPrivacy, TicketType, Prisma } from '@prisma/client';
import { ChatService } from './chat.service';
import { EmailService } from './email.service';

// Interfaces matching the user's request structure (for input)
export interface CreateEventInput {
    title: string;
    slug?: string;
    description: string;
    category: EventCategory;
    tags?: string[];
    privacy: EventPrivacy;
    location: {
        type: string;
        address?: string;
        venueName?: string;
        city?: string;
        state?: string;
        country?: string;
        postalCode?: string;
        coordinates?: { lat: number; lng: number };
        onlineUrl?: string;
        onlinePassword?: string;
    };
    schedule: {
        startDate: string;
        endDate: string;
        startTime: string;
        endTime: string;
        timezone: string;
    };
    media: {
        coverImage: string;
        gallery?: string[];
        videoUrl?: string;
    };
    tickets: {
        name: string;
        description?: string;
        type: TicketType;
        price: number;
        currency: string;
        quantity: number;
        remaining?: number;
        maxPerUser?: number;
        salesStart?: string;
        salesEnd?: string;
    }[];
    scheduleItems?: {
        time: string;
        activity: string;
        description?: string;
        order?: number;
    }[];
}

export class EventService {
    static async create(userId: string, data: CreateEventInput) {
        // Map nested input to flattened schema
        // Auto-generate slug from title if not provided
        const slug = data.slug || data.title.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

        const eventData: Prisma.EventCreateInput = {
            title: data.title,
            slug,
            description: data.description,
            category: data.category,
            tags: data.tags || [],
            privacy: data.privacy,
            status: EventStatus.PUBLISHED, // Or DRAFT based on requirement, default to published for now

            // Location
            locationType: data.location.type,
            address: data.location.address,
            venueName: data.location.venueName,
            city: data.location.city,
            state: data.location.state,
            country: data.location.country,
            postalCode: data.location.postalCode,
            lat: data.location.coordinates?.lat,
            lng: data.location.coordinates?.lng,
            onlineUrl: data.location.onlineUrl,
            onlinePassword: data.location.onlinePassword,

            // Schedule
            startDate: new Date(data.schedule.startDate),
            endDate: new Date(data.schedule.endDate),
            startTime: data.schedule.startTime,
            endTime: data.schedule.endTime,
            timezone: data.schedule.timezone,

            // Media
            coverImage: data.media.coverImage,
            gallery: data.media.gallery || [],
            videoUrl: data.media.videoUrl,

            // Relations
            organizer: { connect: { id: userId } },
            tickets: {
                create: data.tickets.map(ticket => ({
                    name: ticket.name,
                    description: ticket.description,
                    type: ticket.type,
                    price: ticket.price,
                    currency: ticket.currency,
                    quantity: ticket.quantity,
                    remaining: ticket.quantity, // Initially, remaining equals quantity
                    maxPerUser: ticket.maxPerUser,
                    salesStart: ticket.salesStart ? new Date(ticket.salesStart) : null,
                    salesEnd: ticket.salesEnd ? new Date(ticket.salesEnd) : null,
                }))
            },
            ...(data.scheduleItems && data.scheduleItems.length > 0 && {
                scheduleItems: {
                    create: data.scheduleItems.map((item, index) => ({
                        time: item.time,
                        activity: item.activity,
                        description: item.description || null,
                        order: item.order ?? index,
                    }))
                }
            })
        };

        const event = await prisma.event.create({
            data: eventData,
            include: {
                tickets: true,
                scheduleItems: { orderBy: { order: 'asc' } },
                organizer: {
                    select: {
                        id: true,
                        displayName: true,
                        avatar: true,
                        username: true
                    }
                }
            }
        });

        // Auto-create event chat and add organizer
        try {
            await ChatService.getOrJoinChat(event.id, userId);
        } catch (error) {
            console.error('Failed to auto-create chat:', error);
            // Don't fail the event creation if chat creation fails
        }

        return event;
    }

    static async findAll(query: any) {
        const {
            page = 1,
            limit = 10,
            search,
            category,
            startDate,
            endDate,
            city,
            country,
            type, // PHYSICAL, ONLINE, HYBRID
            organizerId
        } = query;

        const skip = (Number(page) - 1) * Number(limit);
        const take = Number(limit);

        const where: Prisma.EventWhereInput = {
            privacy: EventPrivacy.PUBLIC,
            // Search filters
            ...(search && {
                OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                    { city: { contains: search, mode: 'insensitive' } }
                ]
            }),
            ...(category && { category: category }),
            ...(city && { city: { contains: city, mode: 'insensitive' } }),
            ...(country && { country: { contains: country, mode: 'insensitive' } }),
            ...(type && { locationType: type }),
            ...(organizerId && { organizerId }),

            // Date filters — when browsing (no organizerId), exclude past events
            ...(startDate
                ? { startDate: { gte: new Date(startDate) } }
                : !organizerId
                    ? { endDate: { gte: new Date() } }
                    : {}
            ),
            ...(endDate && { endDate: { lte: new Date(endDate) } }),
        };

        // Execute query transactionally to get count and data
        const [total, events] = await prisma.$transaction([
            prisma.event.count({ where }),
            prisma.event.findMany({
                where,
                include: {
                    tickets: {
                        select: {
                            type: true,
                            price: true,
                            currency: true
                        }
                    }, // Optimized selection
                    organizer: {
                        select: {
                            id: true,
                            displayName: true,
                            avatar: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take,
            })
        ]);

        return {
            meta: {
                total,
                page: Number(page),
                limit: Number(limit),
                totalPages: Math.ceil(total / Number(limit)),
            },
            data: events
        };
    }

    static async findOne(id: string) {
        const event = await prisma.event.findUnique({
            where: { id },
            include: {
                tickets: true,
                scheduleItems: {
                    orderBy: { order: 'asc' }
                },
                organizer: {
                    select: {
                        id: true,
                        displayName: true,
                        avatar: true,
                        username: true,
                        email: true,
                        isVerified: true
                    }
                }
            }
        });

        if (!event) throw new Error('Event not found');
        return event;
    }

    static async update(id: string, userId: string, data: Partial<CreateEventInput>) {
        const event = await prisma.event.findUnique({ where: { id } });

        if (!event) throw new Error('Event not found');
        if (event.organizerId !== userId) throw new Error('Unauthorized: You can only update your own events');

        // Construct update data
        // Use explicit slug if provided, otherwise regenerate from title if title changed
        const slug = data.slug
            ? data.slug.replace(/[^a-zA-Z0-9-_]/g, '').toUpperCase()
            : data.title
                ? data.title.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
                : undefined;

        const updateData: Prisma.EventUpdateInput = {
            ...(data.title && { title: data.title }),
            ...(slug && { slug }),
            ...(data.description && { description: data.description }),
            ...(data.category && { category: data.category }),
            ...(data.tags && { tags: data.tags }),
            ...(data.privacy && { privacy: data.privacy }),

            // Location
            ...(data.location && {
                locationType: data.location.type,
                address: data.location.address,
                venueName: data.location.venueName,
                city: data.location.city,
                state: data.location.state,
                country: data.location.country,
                postalCode: data.location.postalCode,
                lat: data.location.coordinates?.lat,
                lng: data.location.coordinates?.lng,
                onlineUrl: data.location.onlineUrl,
                onlinePassword: data.location.onlinePassword,
            }),

            // Schedule
            ...(data.schedule && {
                startDate: new Date(data.schedule.startDate),
                endDate: new Date(data.schedule.endDate),
                startTime: data.schedule.startTime,
                endTime: data.schedule.endTime,
                timezone: data.schedule.timezone,
            }),

            // Media
            ...(data.media && {
                coverImage: data.media.coverImage,
                gallery: data.media.gallery,
                videoUrl: data.media.videoUrl,
            }),
        };

        // Handle schedule items: delete old ones and create new ones
        if (data.scheduleItems) {
            await prisma.scheduleItem.deleteMany({ where: { eventId: id } });
            if (data.scheduleItems.length > 0) {
                await prisma.scheduleItem.createMany({
                    data: data.scheduleItems.map((item, index) => ({
                        eventId: id,
                        time: item.time,
                        activity: item.activity,
                        description: item.description || null,
                        order: item.order ?? index,
                    }))
                });
            }
        }

        // Handle tickets: upsert existing, create new, delete removed (only if unsold)
        // All ticket ops run in a transaction so a partial failure doesn't leave
        // the DB in an inconsistent state.
        if (data.tickets && data.tickets.length > 0) {
            await prisma.$transaction(async (tx) => {
                const existingTickets = await tx.ticket.findMany({
                    where: { eventId: id },
                    include: { orderItems: { take: 1 } },
                });

                const existingMap = new Map(existingTickets.map(t => [t.id, t]));

                // Only treat an incoming id as "existing" when it is actually a DB UUID
                const submittedIds = new Set(
                    (data.tickets as any[])
                        .map((t: any) => t.id)
                        .filter((tid: unknown) => typeof tid === 'string' && existingMap.has(tid))
                );

                // Delete tickets removed by the organizer — only if no orders placed
                for (const existing of existingTickets) {
                    if (!submittedIds.has(existing.id) && existing.orderItems.length === 0) {
                        await tx.ticket.delete({ where: { id: existing.id } });
                    }
                }

                // Create or update each submitted ticket
                for (const ticket of data.tickets as any[]) {
                    const existing = existingMap.get(ticket.id);
                    if (existing) {
                        // Preserve sold count when adjusting quantity
                        const sold = existing.quantity - existing.remaining;
                        const newRemaining = Math.max(0, ticket.quantity - sold);
                        await tx.ticket.update({
                            where: { id: ticket.id },
                            data: {
                                name: ticket.name,
                                description: ticket.description || null,
                                type: ticket.type,
                                price: ticket.price,
                                currency: ticket.currency,
                                quantity: ticket.quantity,
                                remaining: newRemaining,
                                maxPerUser: ticket.maxPerUser || null,
                                salesStart: ticket.salesStart ? new Date(ticket.salesStart) : null,
                                salesEnd: ticket.salesEnd ? new Date(ticket.salesEnd) : null,
                            },
                        });
                    } else {
                        // New ticket — frontend ID is a temporary placeholder, ignore it.
                        // Prisma will auto-generate the real UUID.
                        await tx.ticket.create({
                            data: {
                                eventId: id,
                                name: ticket.name,
                                description: ticket.description || null,
                                type: ticket.type,
                                price: ticket.price,
                                currency: ticket.currency,
                                quantity: ticket.quantity,
                                remaining: ticket.quantity,
                                maxPerUser: ticket.maxPerUser || null,
                                salesStart: ticket.salesStart ? new Date(ticket.salesStart) : null,
                                salesEnd: ticket.salesEnd ? new Date(ticket.salesEnd) : null,
                            },
                        });
                    }
                }
            });
        }

        // Detect location reveal: was previously unset, now being set
        const locationBeingSet = data.location && (data.location.venueName || data.location.address);
        const hadNoLocation = !event.venueName && !event.address;
        const locationJustRevealed = locationBeingSet && hadNoLocation;

        const updatedEvent = await prisma.event.update({
            where: { id },
            data: updateData,
            include: {
                tickets: true,
                scheduleItems: { orderBy: { order: 'asc' } },
                organizer: {
                    select: { id: true, displayName: true, avatar: true }
                }
            }
        });

        // If location was just revealed, email all registered attendees
        if (locationJustRevealed) {
            const orders = await prisma.order.findMany({
                where: { eventId: id, status: 'CONFIRMED' },
                include: { user: { select: { email: true, displayName: true } } }
            });

            const frontendUrl = process.env.FRONTEND_URL || 'https://eventfi.live';
            const eventUrl = updatedEvent.slug
                ? `https://eventfi.live/${updatedEvent.slug}`
                : `${frontendUrl}/events/${id}`;
            const eventDate = updatedEvent.startDate.toLocaleDateString('en-NG', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
            });

            // Fire-and-forget — don't block the response
            for (const order of orders) {
                if (order.user?.email) {
                    EmailService.sendLocationAnnounced(order.user.email, {
                        eventTitle: updatedEvent.title,
                        eventDate,
                        venueName: data.location?.venueName,
                        address: data.location?.address,
                        eventUrl,
                    }).catch(() => {/* silently fail per-email */});
                }
            }
        }

        return updatedEvent;
    }

    static async delete(id: string, userId: string) {
        const event = await prisma.event.findUnique({ where: { id } });

        if (!event) throw new Error('Event not found');
        if (event.organizerId !== userId) throw new Error('Unauthorized: You can only delete your own events');

        // Delete tickets first
        await prisma.ticket.deleteMany({
            where: { eventId: id }
        });

        await prisma.event.delete({
            where: { id }
        });

        return { message: 'Event deleted successfully' };
    }

    static async getRecommendations(userId: string) {
        // 1. Fetch user interests
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { interests: true }
        });

        const interests = user?.interests || [];
        let events: any[] = [];

        // 2. If user has interests, try to find matching events
        if (interests.length > 0) {
            events = await prisma.event.findMany({
                where: {
                    privacy: EventPrivacy.PUBLIC,
                    endDate: { gte: new Date() },
                    category: { in: interests }
                },
                take: 5,
                orderBy: { createdAt: 'desc' },
                include: {
                    tickets: {
                        select: { type: true, price: true, currency: true }
                    },
                    organizer: {
                        select: { id: true, displayName: true, avatar: true }
                    }
                }
            });
        }

        // 3. Fallback: If no interests or no events found, fetch latest
        if (events.length === 0) {
            events = await prisma.event.findMany({
                where: {
                    privacy: EventPrivacy.PUBLIC,
                    endDate: { gte: new Date() },
                },
                take: 5,
                orderBy: { createdAt: 'desc' },
                include: {
                    tickets: {
                        select: { type: true, price: true, currency: true }
                    },
                    organizer: {
                        select: { id: true, displayName: true, avatar: true }
                    }
                }
            });
        }

        return events;
    }

    static async getRelatedEvents(eventId: string, limit: number = 5) {
        // Get the event's category and tags
        const event = await prisma.event.findUnique({
            where: { id: eventId },
            select: { category: true, tags: true }
        });

        if (!event) throw new Error('Event not found');

        // Find events with same category or overlapping tags, excluding current and past
        const related = await prisma.event.findMany({
            where: {
                AND: [
                    { id: { not: eventId } },
                    { privacy: EventPrivacy.PUBLIC },
                    { endDate: { gte: new Date() } },
                    {
                        OR: [
                            { category: event.category },
                            { tags: { hasSome: event.tags } }
                        ]
                    }
                ]
            },
            take: limit,
            orderBy: { createdAt: 'desc' },
            include: {
                tickets: {
                    select: { type: true, price: true, currency: true }
                },
                organizer: {
                    select: { id: true, displayName: true, avatar: true, isVerified: true }
                }
            }
        });

        return related;
    }

    /**
     * Get trending events near user (placeholder - location logic to be added later)
     * Currently returns public events sorted by popularity (attendees + favorites)
     */
    static async getTrending(limit: number = 10) {
        const events = await prisma.event.findMany({
            where: {
                privacy: EventPrivacy.PUBLIC,
                startDate: { gte: new Date() } // Only upcoming events
            },
            orderBy: [
                { attendeesCount: 'desc' },
                { favoritesCount: 'desc' },
                { createdAt: 'desc' }
            ],
            take: limit,
            include: {
                tickets: {
                    select: { type: true, price: true, currency: true }
                },
                organizer: {
                    select: { id: true, displayName: true, avatar: true, isVerified: true }
                }
            }
        });

        return events;
    }

    /**
     * Find an event by its short URL slug
     */
    static async findBySlug(slug: string) {
        const event = await prisma.event.findFirst({
            where: { slug: slug.toUpperCase() },
            include: {
                tickets: true,
                scheduleItems: { orderBy: { order: 'asc' } },
                organizer: {
                    select: {
                        id: true,
                        displayName: true,
                        avatar: true,
                        username: true,
                        email: true,
                        isVerified: true
                    }
                }
            }
        });

        if (!event) throw new Error('Event not found');
        return event;
    }
}
