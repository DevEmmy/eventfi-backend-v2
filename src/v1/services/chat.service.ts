import { prisma } from '../config/database';

const CHAT_ERROR_CODES = {
    CHAT_NOT_FOUND: 'Event chat does not exist',
    NO_TICKET: 'User must have ticket to join',
    CHAT_DISABLED: 'Chat is currently disabled',
    USER_MUTED: 'You are muted',
    SLOW_MODE: 'Please wait before sending another message',
    MESSAGE_TOO_LONG: 'Max 1000 characters',
    NOT_AUTHORIZED: 'You cannot perform this action',
};

const MAX_MESSAGE_LENGTH = 1000;

interface ChatRolePermissions {
    canSendMessage: boolean;
    canDeleteOwn: boolean;
    canDeleteAny: boolean;
    canPin: boolean;
    canMute: boolean;
    canAnnounce: boolean;
    canChangeSettings: boolean;
}

const ROLE_PERMISSIONS: Record<string, ChatRolePermissions> = {
    MEMBER: { canSendMessage: true, canDeleteOwn: true, canDeleteAny: false, canPin: false, canMute: false, canAnnounce: false, canChangeSettings: false },
    MODERATOR: { canSendMessage: true, canDeleteOwn: true, canDeleteAny: true, canPin: true, canMute: true, canAnnounce: false, canChangeSettings: false },
    ORGANIZER: { canSendMessage: true, canDeleteOwn: true, canDeleteAny: true, canPin: true, canMute: true, canAnnounce: true, canChangeSettings: true },
};

export class ChatService {
    /**
     * Get or create event chat and check if user can join
     */
    static async getOrJoinChat(eventId: string, userId: string) {
        // Get or create chat
        let chat = await prisma.eventChat.findUnique({
            where: { eventId },
            include: {
                event: { select: { organizerId: true, endDate: true } },
                _count: { select: { members: true } }
            }
        });

        if (!chat) {
            // Create chat for the event
            chat = await prisma.eventChat.create({
                data: { eventId },
                include: {
                    event: { select: { organizerId: true, endDate: true } },
                    _count: { select: { members: true } }
                }
            });
        }

        // Determine user's role
        let userRole: string = 'MEMBER';
        if (chat.event.organizerId === userId) {
            userRole = 'ORGANIZER';
        } else {
            const teamMember = await prisma.eventTeamMember.findFirst({
                where: { eventId, userId, status: 'ACTIVE' }
            });
            if (teamMember) {
                userRole = teamMember.role === 'CO_HOST' || teamMember.role === 'MANAGER' ? 'MODERATOR' : 'MEMBER';
            }
        }

        // Check if chat is still active (event ended + 24hrs)
        const eventEnd = new Date(chat.event.endDate);
        const chatExpiry = new Date(eventEnd.getTime() + 24 * 60 * 60 * 1000);
        const isExpired = new Date() > chatExpiry;

        if (!chat.isActive || isExpired) {
            return {
                chat: null,
                canJoin: false,
                reason: 'CHAT_DISABLED'
            };
        }

        // Check if user has a ticket (for membersOnly chats)
        let hasTicket = false;
        if (chat.membersOnly && userRole === 'MEMBER') {
            const attendee = await prisma.attendee.findFirst({
                where: {
                    order: { eventId, userId, status: 'CONFIRMED' }
                }
            });
            hasTicket = !!attendee;

            if (!hasTicket) {
                return {
                    chat: this.formatChatInfo(chat, userRole, false),
                    canJoin: false,
                    reason: 'NO_TICKET'
                };
            }
        } else {
            hasTicket = true;
        }

        // Auto-join the user
        let member = await prisma.chatMember.findUnique({
            where: { chatId_userId: { chatId: chat.id, userId } }
        });

        if (!member) {
            member = await prisma.chatMember.create({
                data: {
                    chatId: chat.id,
                    userId,
                    role: userRole as any
                }
            });
        } else {
            // Update last seen
            await prisma.chatMember.update({
                where: { id: member.id },
                data: { lastSeenAt: new Date() }
            });
        }

        // Get online count (active in last 5 minutes)
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        const onlineCount = await prisma.chatMember.count({
            where: { chatId: chat.id, lastSeenAt: { gte: fiveMinutesAgo } }
        });

        return {
            chat: {
                id: chat.id,
                eventId: chat.eventId,
                isActive: chat.isActive,
                slowMode: chat.slowMode,
                membersOnly: chat.membersOnly,
                memberCount: chat._count.members,
                onlineCount,
                userRole: userRole.toLowerCase(),
                isMuted: member.isMuted
            },
            canJoin: true,
            reason: null
        };
    }

    /**
     * Get chat messages (history)
     */
    static async getMessages(eventId: string, userId: string, before?: string, limit: number = 50) {
        const chat = await prisma.eventChat.findUnique({ where: { eventId } });
        if (!chat) throw new Error(CHAT_ERROR_CODES.CHAT_NOT_FOUND);

        // Verify user is a member
        const member = await prisma.chatMember.findUnique({
            where: { chatId_userId: { chatId: chat.id, userId } }
        });
        if (!member) throw new Error(CHAT_ERROR_CODES.NOT_AUTHORIZED);

        const messages = await prisma.chatMessage.findMany({
            where: {
                chatId: chat.id,
                isDeleted: false,
                ...(before && { createdAt: { lt: (await prisma.chatMessage.findUnique({ where: { id: before } }))?.createdAt } })
            },
            take: Math.min(limit, 100),
            orderBy: { createdAt: 'desc' },
            include: {
                sender: { select: { id: true, displayName: true, avatar: true } },
                replyTo: {
                    select: { id: true, content: true, sender: { select: { displayName: true } } }
                }
            }
        });

        // Get sender roles
        const senderIds = [...new Set(messages.map(m => m.senderId))];
        const memberRoles = await prisma.chatMember.findMany({
            where: { chatId: chat.id, userId: { in: senderIds } },
            select: { userId: true, role: true }
        });
        const roleMap = new Map(memberRoles.map(m => [m.userId, m.role]));

        const formattedMessages = messages.map(m => ({
            id: m.id,
            content: m.content,
            type: m.type,
            sender: {
                id: m.sender.id,
                name: m.sender.displayName || 'User',
                avatar: m.sender.avatar,
                role: (roleMap.get(m.senderId) || 'MEMBER').toLowerCase()
            },
            replyTo: m.replyTo ? {
                id: m.replyTo.id,
                content: m.replyTo.content.substring(0, 100),
                senderName: m.replyTo.sender.displayName || 'User'
            } : undefined,
            isPinned: m.isPinned,
            createdAt: m.createdAt.toISOString()
        })).reverse();

        // Check if there are more messages
        const oldestMessage = messages[messages.length - 1];
        const hasMore = oldestMessage ? await prisma.chatMessage.count({
            where: { chatId: chat.id, isDeleted: false, createdAt: { lt: oldestMessage.createdAt } }
        }) > 0 : false;

        return { messages: formattedMessages, hasMore };
    }

    /**
     * Get pinned messages
     */
    static async getPinnedMessages(eventId: string, userId: string) {
        const chat = await prisma.eventChat.findUnique({ where: { eventId } });
        if (!chat) throw new Error(CHAT_ERROR_CODES.CHAT_NOT_FOUND);

        const messages = await prisma.chatMessage.findMany({
            where: { chatId: chat.id, isPinned: true, isDeleted: false },
            orderBy: { createdAt: 'desc' },
            include: {
                sender: { select: { id: true, displayName: true, avatar: true } }
            }
        });

        return messages.map(m => ({
            id: m.id,
            content: m.content,
            type: m.type,
            sender: { id: m.sender.id, name: m.sender.displayName || 'User', avatar: m.sender.avatar },
            isPinned: true,
            createdAt: m.createdAt.toISOString()
        }));
    }

    /**
     * Get online/all members
     */
    static async getMembers(eventId: string, userId: string, onlineOnly: boolean = false, limit: number = 20) {
        const chat = await prisma.eventChat.findUnique({ where: { eventId } });
        if (!chat) throw new Error(CHAT_ERROR_CODES.CHAT_NOT_FOUND);

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

        const [total, onlineCount, members] = await prisma.$transaction([
            prisma.chatMember.count({ where: { chatId: chat.id } }),
            prisma.chatMember.count({ where: { chatId: chat.id, lastSeenAt: { gte: fiveMinutesAgo } } }),
            prisma.chatMember.findMany({
                where: {
                    chatId: chat.id,
                    ...(onlineOnly && { lastSeenAt: { gte: fiveMinutesAgo } })
                },
                take: limit,
                orderBy: { lastSeenAt: 'desc' },
                include: { user: { select: { id: true, displayName: true, avatar: true } } }
            })
        ]);

        return {
            members: members.map(m => ({
                id: m.id,
                userId: m.userId,
                name: m.user.displayName || 'User',
                avatar: m.user.avatar,
                role: m.role.toLowerCase(),
                isMuted: m.isMuted,
                isOnline: m.lastSeenAt >= fiveMinutesAgo,
                joinedAt: m.joinedAt.toISOString()
            })),
            total,
            online: onlineCount
        };
    }

    /**
     * Send a message
     */
    static async sendMessage(
        eventId: string,
        userId: string,
        content: string,
        type: 'TEXT' | 'IMAGE' | 'ANNOUNCEMENT' = 'TEXT',
        replyToId?: string
    ) {
        if (content.length > MAX_MESSAGE_LENGTH) {
            throw new Error(CHAT_ERROR_CODES.MESSAGE_TOO_LONG);
        }

        const chat = await prisma.eventChat.findUnique({ where: { eventId } });
        if (!chat) throw new Error(CHAT_ERROR_CODES.CHAT_NOT_FOUND);
        if (!chat.isActive) throw new Error(CHAT_ERROR_CODES.CHAT_DISABLED);

        const member = await prisma.chatMember.findUnique({
            where: { chatId_userId: { chatId: chat.id, userId } }
        });
        if (!member) throw new Error(CHAT_ERROR_CODES.NOT_AUTHORIZED);

        const permissions = ROLE_PERMISSIONS[member.role] || ROLE_PERMISSIONS.MEMBER;

        // Check mute status
        if (member.isMuted) {
            if (!member.mutedUntil || member.mutedUntil > new Date()) {
                throw new Error(CHAT_ERROR_CODES.USER_MUTED);
            }
            // Unmute if expired
            await prisma.chatMember.update({
                where: { id: member.id },
                data: { isMuted: false, mutedUntil: null }
            });
        }

        // Check announcement permission
        if (type === 'ANNOUNCEMENT' && !permissions.canAnnounce) {
            throw new Error(CHAT_ERROR_CODES.NOT_AUTHORIZED);
        }

        // Check slow mode
        if (chat.slowMode > 0 && member.role === 'MEMBER') {
            const lastMessage = await prisma.chatMessage.findFirst({
                where: { chatId: chat.id, senderId: userId },
                orderBy: { createdAt: 'desc' }
            });
            if (lastMessage) {
                const timeSince = (Date.now() - lastMessage.createdAt.getTime()) / 1000;
                if (timeSince < chat.slowMode) {
                    throw new Error(`${CHAT_ERROR_CODES.SLOW_MODE}: ${Math.ceil(chat.slowMode - timeSince)}s`);
                }
            }
        }

        const message = await prisma.chatMessage.create({
            data: {
                chatId: chat.id,
                senderId: userId,
                content,
                type: type as any,
                replyToId
            },
            include: {
                sender: { select: { id: true, displayName: true, avatar: true } },
                replyTo: {
                    select: { id: true, content: true, sender: { select: { displayName: true } } }
                }
            }
        });

        // Update member's last seen
        await prisma.chatMember.update({
            where: { id: member.id },
            data: { lastSeenAt: new Date() }
        });

        return {
            id: message.id,
            content: message.content,
            type: message.type,
            sender: {
                id: message.sender.id,
                name: message.sender.displayName || 'User',
                avatar: message.sender.avatar,
                role: member.role.toLowerCase()
            },
            replyTo: message.replyTo ? {
                id: message.replyTo.id,
                content: message.replyTo.content.substring(0, 100),
                senderName: message.replyTo.sender.displayName || 'User'
            } : undefined,
            isPinned: false,
            createdAt: message.createdAt.toISOString()
        };
    }

    /**
     * Moderate message (delete/pin/unpin)
     */
    static async moderateMessage(
        eventId: string,
        messageId: string,
        userId: string,
        action: 'delete' | 'pin' | 'unpin'
    ) {
        const chat = await prisma.eventChat.findUnique({ where: { eventId } });
        if (!chat) throw new Error(CHAT_ERROR_CODES.CHAT_NOT_FOUND);

        const member = await prisma.chatMember.findUnique({
            where: { chatId_userId: { chatId: chat.id, userId } }
        });
        if (!member) throw new Error(CHAT_ERROR_CODES.NOT_AUTHORIZED);

        const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
        if (!message || message.chatId !== chat.id) throw new Error('Message not found');

        const permissions = ROLE_PERMISSIONS[member.role] || ROLE_PERMISSIONS.MEMBER;

        if (action === 'delete') {
            const canDelete = message.senderId === userId ? permissions.canDeleteOwn : permissions.canDeleteAny;
            if (!canDelete) throw new Error(CHAT_ERROR_CODES.NOT_AUTHORIZED);

            await prisma.chatMessage.update({
                where: { id: messageId },
                data: { isDeleted: true, deletedBy: userId }
            });

            return { messageId, action: 'deleted', deletedBy: userId };
        }

        if (action === 'pin' || action === 'unpin') {
            if (!permissions.canPin) throw new Error(CHAT_ERROR_CODES.NOT_AUTHORIZED);

            const updated = await prisma.chatMessage.update({
                where: { id: messageId },
                data: { isPinned: action === 'pin' }
            });

            return { messageId, action, isPinned: updated.isPinned };
        }

        throw new Error('Invalid action');
    }

    /**
     * Mute/unmute user
     */
    static async muteUser(eventId: string, targetUserId: string, actorUserId: string, durationMinutes: number) {
        const chat = await prisma.eventChat.findUnique({ where: { eventId } });
        if (!chat) throw new Error(CHAT_ERROR_CODES.CHAT_NOT_FOUND);

        const actor = await prisma.chatMember.findUnique({
            where: { chatId_userId: { chatId: chat.id, userId: actorUserId } }
        });
        if (!actor) throw new Error(CHAT_ERROR_CODES.NOT_AUTHORIZED);

        const permissions = ROLE_PERMISSIONS[actor.role] || ROLE_PERMISSIONS.MEMBER;
        if (!permissions.canMute) throw new Error(CHAT_ERROR_CODES.NOT_AUTHORIZED);

        const target = await prisma.chatMember.findUnique({
            where: { chatId_userId: { chatId: chat.id, userId: targetUserId } }
        });
        if (!target) throw new Error('User not found in chat');

        // Cannot mute higher roles
        const roleOrder = { MEMBER: 0, MODERATOR: 1, ORGANIZER: 2 };
        if (roleOrder[target.role as keyof typeof roleOrder] >= roleOrder[actor.role as keyof typeof roleOrder]) {
            throw new Error(CHAT_ERROR_CODES.NOT_AUTHORIZED);
        }

        if (durationMinutes === 0) {
            // Unmute
            await prisma.chatMember.update({
                where: { id: target.id },
                data: { isMuted: false, mutedUntil: null }
            });
            return { userId: targetUserId, isMuted: false, until: null };
        }

        const mutedUntil = new Date(Date.now() + durationMinutes * 60 * 1000);
        await prisma.chatMember.update({
            where: { id: target.id },
            data: { isMuted: true, mutedUntil }
        });

        return { userId: targetUserId, isMuted: true, until: mutedUntil.toISOString() };
    }

    /**
     * Update chat settings (organizer only)
     */
    static async updateSettings(eventId: string, userId: string, slowMode?: number, isActive?: boolean) {
        const chat = await prisma.eventChat.findUnique({
            where: { eventId },
            include: { event: { select: { organizerId: true } } }
        });
        if (!chat) throw new Error(CHAT_ERROR_CODES.CHAT_NOT_FOUND);

        // Only organizer can change settings
        if (chat.event.organizerId !== userId) {
            const member = await prisma.chatMember.findUnique({
                where: { chatId_userId: { chatId: chat.id, userId } }
            });
            if (!member || member.role !== 'ORGANIZER') {
                throw new Error(CHAT_ERROR_CODES.NOT_AUTHORIZED);
            }
        }

        const updated = await prisma.eventChat.update({
            where: { id: chat.id },
            data: {
                ...(slowMode !== undefined && { slowMode }),
                ...(isActive !== undefined && { isActive })
            }
        });

        return { slowMode: updated.slowMode, isActive: updated.isActive };
    }

    /**
     * Update member's last seen (for heartbeat)
     */
    static async updateLastSeen(eventId: string, userId: string) {
        const chat = await prisma.eventChat.findUnique({ where: { eventId } });
        if (!chat) return;

        await prisma.chatMember.updateMany({
            where: { chatId: chat.id, userId },
            data: { lastSeenAt: new Date() }
        });
    }

    private static formatChatInfo(chat: any, userRole: string, isMuted: boolean) {
        return {
            id: chat.id,
            eventId: chat.eventId,
            isActive: chat.isActive,
            slowMode: chat.slowMode,
            membersOnly: chat.membersOnly,
            memberCount: chat._count?.members || 0,
            onlineCount: 0,
            userRole: userRole.toLowerCase(),
            isMuted
        };
    }

    /**
     * Get all event chats for a user
     */
    static async getUserEventChats(userId: string) {
        // Get all chat memberships for the user
        const memberships = await prisma.chatMember.findMany({
            where: { userId },
            include: {
                chat: {
                    include: {
                        event: {
                            select: {
                                id: true,
                                title: true,
                                startDate: true,
                                venueName: true,
                                address: true,
                                city: true,
                                coverImage: true,
                                organizerId: true,
                                organizer: {
                                    select: { displayName: true }
                                }
                            }
                        },
                        _count: {
                            select: { members: true }
                        }
                    }
                }
            },
            orderBy: { lastSeenAt: 'desc' }
        });

        // Get last message and unread count for each chat
        const chatPreviews = await Promise.all(
            memberships.map(async (membership) => {
                const chat = membership.chat;
                const event = chat.event;

                // Get last message
                const lastMessage = await prisma.chatMessage.findFirst({
                    where: { chatId: chat.id, isDeleted: false },
                    orderBy: { createdAt: 'desc' },
                    include: {
                        sender: { select: { displayName: true } }
                    }
                });

                // Get unread count (messages after last seen)
                const unreadCount = await prisma.chatMessage.count({
                    where: {
                        chatId: chat.id,
                        isDeleted: false,
                        createdAt: { gt: membership.lastSeenAt },
                        senderId: { not: userId } // Don't count own messages
                    }
                });

                // Format event date
                const eventDate = new Date(event.startDate);
                const formattedDate = eventDate.toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric'
                });

                // Format location
                const eventLocation = event.venueName || event.address || event.city || 'Online';

                // Format last message preview
                let lastMessagePreview = '';
                if (lastMessage) {
                    const senderName = lastMessage.sender.displayName || 'User';
                    const contentPreview = lastMessage.content.length > 50
                        ? lastMessage.content.substring(0, 50) + '...'
                        : lastMessage.content;

                    if (lastMessage.type === 'ANNOUNCEMENT') {
                        lastMessagePreview = `📢 ${senderName}: ${contentPreview}`;
                    } else if (lastMessage.type === 'SYSTEM') {
                        lastMessagePreview = contentPreview;
                    } else {
                        lastMessagePreview = `${senderName}: ${contentPreview}`;
                    }
                }

                return {
                    id: chat.id,
                    eventId: event.id,
                    eventName: event.title,
                    eventDate: formattedDate,
                    eventLocation,
                    eventImage: event.coverImage || null,
                    organizerName: event.organizer.displayName || 'Organizer',
                    participantCount: chat._count.members,
                    unreadCount,
                    lastMessage: lastMessagePreview,
                    lastMessageTime: lastMessage?.createdAt.toISOString() || null,
                    userRole: membership.role
                };
            })
        );

        // Sort by last message time (most recent first)
        chatPreviews.sort((a, b) => {
            if (!a.lastMessageTime && !b.lastMessageTime) return 0;
            if (!a.lastMessageTime) return 1;
            if (!b.lastMessageTime) return -1;
            return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime();
        });

        return chatPreviews;
    }
}

