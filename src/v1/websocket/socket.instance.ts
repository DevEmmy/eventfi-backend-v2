import { Server as SocketServer } from 'socket.io';

/**
 * Module-level IO singleton.
 * Set once by initializeChatSocket(), then used by NotificationService
 * to push real-time events to individual users.
 */
let _io: SocketServer | null = null;

export function setIO(io: SocketServer) {
    _io = io;
}

export function getIO(): SocketServer | null {
    return _io;
}
