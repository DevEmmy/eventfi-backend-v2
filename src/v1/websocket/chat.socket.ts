import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ChatService } from '../services/chat.service';
import { prisma } from '../config/database';
import { setIO } from './socket.instance';

if (!process.env.JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set.');
}
const JWT_SECRET: string = process.env.JWT_SECRET;

interface AuthenticatedSocket extends Socket {
    userId?: string;
    userName?: string;
    eventId?: string;
}

interface ChatPayload {
    eventId?: string;
    content?: string;
    type?: 'TEXT' | 'IMAGE' | 'ANNOUNCEMENT';
    replyToId?: string;
    messageId?: string;
}

// Track online users per chat room
const roomOnlineUsers = new Map<string, Set<string>>();
const userSockets = new Map<string, Set<string>>(); // userId -> socketIds

export function initializeChatSocket(httpServer: HttpServer) {
    const io = new SocketServer(httpServer, {
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            methods: ['GET', 'POST']
        },
        path: '/ws/chat'
    });

    // Store the IO instance so NotificationService can use it for real-time pushes
    setIO(io);

    // Authentication middleware
    io.use(async (socket: AuthenticatedSocket, next) => {
        try {
            const token = socket.handshake.auth.token || socket.handshake.query.token;
            if (!token) {
                return next(new Error('Authentication required'));
            }

            const decoded = jwt.verify(token as string, JWT_SECRET) as any;
            socket.userId = decoded.id || decoded.userId;
            socket.userName = decoded.displayName || decoded.name || 'User';

            if (!socket.userId) {
                return next(new Error('Invalid token'));
            }

            next();
        } catch (error) {
            next(new Error('Authentication failed'));
        }
    });

    io.on('connection', (socket: AuthenticatedSocket) => {
        console.log(`[Chat WS] User ${socket.userId} connected`);

        // Track user's sockets
        if (!userSockets.has(socket.userId!)) {
            userSockets.set(socket.userId!, new Set());
        }
        userSockets.get(socket.userId!)!.add(socket.id);

        // Auto-join personal notification room for real-time pushes
        socket.join(`notification:${socket.userId}`);

        /**
         * Join a chat room
         */
        socket.on('chat:join', async (data: ChatPayload) => {
            try {
                const { eventId } = data;
                if (!eventId) {
                    socket.emit('chat:error', { code: 'INVALID_REQUEST', message: 'Event ID required' });
                    return;
                }

                const result = await ChatService.getOrJoinChat(eventId, socket.userId!);

                if (!result.canJoin) {
                    socket.emit('chat:error', { code: result.reason, message: getErrorMessage(result.reason!) });
                    return;
                }

                // Leave previous room if any
                if (socket.eventId) {
                    await leaveRoom(socket, io);
                }

                // Join new room
                const room = `chat:${eventId}`;
                socket.join(room);
                socket.eventId = eventId;

                // Track online user
                if (!roomOnlineUsers.has(room)) {
                    roomOnlineUsers.set(room, new Set());
                }
                roomOnlineUsers.get(room)!.add(socket.userId!);

                // Get recent messages
                const messagesResult = await ChatService.getMessages(eventId, socket.userId!, undefined, 50);

                socket.emit('chat:joined', {
                    chat: result.chat,
                    recentMessages: messagesResult.messages
                });

                // Notify others
                socket.to(room).emit('chat:member:joined', {
                    member: {
                        userId: socket.userId,
                        name: socket.userName,
                        isOnline: true
                    }
                });

                console.log(`[Chat WS] User ${socket.userId} joined room ${room}`);
            } catch (error: any) {
                socket.emit('chat:error', { code: 'JOIN_FAILED', message: error.message });
            }
        });

        /**
         * Leave chat room
         */
        socket.on('chat:leave', async (data: ChatPayload) => {
            await leaveRoom(socket, io);
        });

        /**
         * Send a message
         */
        socket.on('chat:message', async (data: ChatPayload) => {
            try {
                if (!socket.eventId) {
                    socket.emit('chat:error', { code: 'NOT_JOINED', message: 'Join a chat first' });
                    return;
                }

                const { content, type, replyToId } = data;
                if (!content || !content.trim()) {
                    socket.emit('chat:error', { code: 'INVALID_MESSAGE', message: 'Message content required' });
                    return;
                }

                const message = await ChatService.sendMessage(
                    socket.eventId,
                    socket.userId!,
                    content,
                    type || 'TEXT',
                    replyToId
                );

                // Broadcast to all in room including sender
                const room = `chat:${socket.eventId}`;
                io.to(room).emit('chat:message', { message });
            } catch (error: any) {
                socket.emit('chat:error', { code: getErrorCode(error.message), message: error.message });
            }
        });

        /**
         * Typing indicator
         */
        let typingTimeout: NodeJS.Timeout;
        socket.on('chat:typing', () => {
            if (!socket.eventId) return;

            const room = `chat:${socket.eventId}`;
            socket.to(room).emit('chat:typing', {
                users: [{ id: socket.userId, name: socket.userName }]
            });

            // Auto-clear after 3 seconds
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                socket.to(room).emit('chat:typing:stop', { userId: socket.userId });
            }, 3000);
        });

        /**
         * Mark messages as read / update last seen
         */
        socket.on('chat:read', async (data: ChatPayload) => {
            if (!socket.eventId) return;
            await ChatService.updateLastSeen(socket.eventId, socket.userId!);
        });

        // ===== GAME / ACTIVITY EVENTS =====

        // Join a dedicated activity room for an event (no ticket required - auth only)
        socket.on('activity:join_event', (data: { eventId: string }) => {
            if (!data.eventId) return;
            const room = `activity:${data.eventId}`;
            socket.join(room);
            console.log(`[Activity WS] User ${socket.userId} joined activity room ${room}`);
        });

        // Helper: broadcast to activity room AND chat room (chat users also get updates)
        const emitToEvent = (eventId: string, event: string, payload: any) => {
            io.to(`activity:${eventId}`).emit(event, payload);
            io.to(`chat:${eventId}`).emit(event, payload);
        };

        // Organizer starts an activity - broadcast to all in event room
        socket.on('activity:start', async (data: { eventId: string; activityId: string; type: string; durationSeconds?: number }) => {
            emitToEvent(data.eventId, 'activity:started', {
                activityId: data.activityId,
                type: data.type,
                startedBy: socket.userId,
                durationSeconds: data.durationSeconds ?? null,
                startedAt: Date.now(),
            });

            // Auto-end Applause Meter when the time window expires
            if (data.type === 'APPLAUSE_METER' && data.durationSeconds && data.durationSeconds > 0) {
                setTimeout(async () => {
                    try {
                        // Compute final results from entries
                        const entries = await prisma.activityEntry.findMany({
                            where: { activityId: data.activityId },
                        });
                        const totalTaps = entries.reduce((s, e) => s + ((e.response as any)?.taps || 1), 0);
                        await prisma.eventActivity.update({
                            where: { id: data.activityId },
                            data: {
                                status: 'ENDED',
                                results: { totalTaps, participantCount: entries.length },
                            },
                        });
                    } catch { /* non-critical */ }
                    emitToEvent(data.eventId, 'activity:ended', {
                        activityId: data.activityId,
                        autoEnded: true,
                    });
                }, data.durationSeconds * 1000);
            }
        });

        // Organizer broadcasts draw countdown then result
        socket.on('activity:broadcast_draw', (data: { eventId: string; activityId: string; winners: any[]; totalPool: number }) => {
            // First emit countdown start so all clients begin counting
            emitToEvent(data.eventId, 'activity:draw_countdown', {
                activityId: data.activityId,
                seconds: 10
            });
            // After 10 seconds, emit the actual result
            setTimeout(() => {
                emitToEvent(data.eventId, 'activity:draw_result', {
                    activityId: data.activityId,
                    winners: data.winners,
                    totalPool: data.totalPool
                });
            }, 10000);
        });

        // Attendee taps applause — persist to DB then broadcast real totals + leaderboard
        socket.on('activity:tap', async (data: { eventId: string; activityId: string }) => {
            const userId = socket.userId;
            if (!userId) return;

            try {
                // Only checked-in attendees may participate
                const checkedIn = await prisma.attendee.findFirst({
                    where: { order: { eventId: data.eventId, userId }, checkedIn: true }
                });
                if (!checkedIn) {
                    socket.emit('activity:error', { message: 'Only checked-in attendees can participate' });
                    return;
                }

                // Upsert entry — increment tap count for this user
                const existing = await prisma.activityEntry.findUnique({
                    where: { activityId_userId: { activityId: data.activityId, userId } }
                });

                let myTaps: number;
                if (existing) {
                    const resp = existing.response as any;
                    myTaps = (resp?.taps || 1) + 1;
                    await prisma.activityEntry.update({
                        where: { id: existing.id },
                        data: { response: { taps: myTaps } }
                    });
                } else {
                    myTaps = 1;
                    await prisma.activityEntry.create({
                        data: { activityId: data.activityId, userId, response: { taps: 1 } }
                    });
                }

                // Fetch all entries with user info for leaderboard
                const entries = await prisma.activityEntry.findMany({
                    where: { activityId: data.activityId },
                    include: { user: { select: { id: true, displayName: true, username: true, avatar: true } } }
                });

                const totalTaps = entries.reduce((sum, e) => {
                    const r = e.response as any;
                    return sum + (r?.taps || 1);
                }, 0);

                const leaderboard = entries
                    .map(e => ({
                        userId: e.userId,
                        name: e.user.displayName || e.user.username || 'User',
                        avatar: e.user.avatar,
                        taps: (e.response as any)?.taps || 1,
                    }))
                    .sort((a, b) => b.taps - a.taps)
                    .slice(0, 5);

                // Send personal tap count back to the tapper
                socket.emit('activity:tap_ack', { myTaps, activityId: data.activityId });

                // Broadcast to everyone in the room
                emitToEvent(data.eventId, 'activity:tap_update', {
                    activityId: data.activityId,
                    totalTaps,
                    participantCount: entries.length,
                    leaderboard,
                });
            } catch (err) {
                socket.emit('activity:error', { message: 'Tap failed' });
            }
        });

        // Organizer ends activity
        socket.on('activity:end', (data: { eventId: string; activityId: string; results: any }) => {
            emitToEvent(data.eventId, 'activity:ended', {
                activityId: data.activityId,
                results: data.results
            });
        });

        /**
         * Disconnect handling
         */
        socket.on('disconnect', async () => {
            console.log(`[Chat WS] User ${socket.userId} disconnected`);

            // Remove from tracked sockets
            userSockets.get(socket.userId!)?.delete(socket.id);
            if (userSockets.get(socket.userId!)?.size === 0) {
                userSockets.delete(socket.userId!);
            }

            await leaveRoom(socket, io);
        });
    });

    // Export io for use in REST endpoints (e.g., to broadcast from HTTP handlers)
    return io;
}

async function leaveRoom(socket: AuthenticatedSocket, io: SocketServer) {
    if (!socket.eventId) return;

    const room = `chat:${socket.eventId}`;

    // Remove from online tracking
    roomOnlineUsers.get(room)?.delete(socket.userId!);
    if (roomOnlineUsers.get(room)?.size === 0) {
        roomOnlineUsers.delete(room);
    }

    // Notify others only if user has no more sockets in this room
    const userSocketIds = userSockets.get(socket.userId!) || new Set();
    const socketsInRoom = Array.from(userSocketIds).filter(sid => {
        const s = io.sockets.sockets.get(sid) as AuthenticatedSocket;
        return s?.eventId === socket.eventId;
    });

    if (socketsInRoom.length <= 1) {
        socket.to(room).emit('chat:member:left', { userId: socket.userId });
    }

    socket.leave(room);
    socket.eventId = undefined;
}

function getErrorMessage(code: string): string {
    const messages: Record<string, string> = {
        CHAT_NOT_FOUND: 'Event chat does not exist',
        NO_TICKET: 'You need a ticket to join this chat',
        CHAT_DISABLED: 'Chat is currently disabled',
        USER_MUTED: 'You are muted',
        SLOW_MODE: 'Please wait before sending another message',
        MESSAGE_TOO_LONG: 'Maximum 1000 characters',
        NOT_AUTHORIZED: 'You cannot perform this action'
    };
    return messages[code] || 'An error occurred';
}

function getErrorCode(message: string): string {
    if (message.includes('muted')) return 'USER_MUTED';
    if (message.includes('wait')) return 'SLOW_MODE';
    if (message.includes('Max')) return 'MESSAGE_TOO_LONG';
    if (message.includes('cannot')) return 'NOT_AUTHORIZED';
    if (message.includes('not found')) return 'NOT_FOUND';
    return 'ERROR';
}
