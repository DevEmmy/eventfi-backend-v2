
import 'dotenv/config';
import http from 'http';
import app from './app';
import {
  connectDatabase,
  disconnectDatabase,
} from './v1/config/database';
import { initializeChatSocket } from './v1/websocket/chat.socket';
// import { connectRedis, disconnectRedis } from './v1/config/redis';
// import { emailWorker } from './v1/jobs/email.worker';
// import { emailQueue } from './v1/jobs/email.queue';

const DEFAULT_PORT = 8000;

const resolvePort = (value?: string) => {
  if (!value) {
    return DEFAULT_PORT;
  }

  const numericPort = Number.parseInt(value, 10);

  if (Number.isNaN(numericPort) || numericPort <= 0 || numericPort >= 65_536) {
    throw new Error(
      `Invalid PORT value "${value}". Provide an integer between 1 and 65535.`,
    );
  }

  return numericPort;
};

const port = resolvePort(process.env.PORT);
const server = http.createServer(app);

// Initialize WebSocket for chat
const io = initializeChatSocket(server);
console.log('🔌 WebSocket initialized for chat at /ws/chat');

const handleServerError = (error: NodeJS.ErrnoException) => {
  if (error.syscall !== 'listen') {
    throw error;
  }

  const bind = typeof port === 'string' ? `Pipe ${port}` : `Port ${port}`;

  switch (error.code) {
    case 'EACCES':
      console.error(`${bind} requires elevated privileges.`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`${bind} is already in use.`);
      process.exit(1);
      break;
    default:
      throw error;
  }
};

const handleServerListening = () => {
  const address = server.address();
  const bind =
    typeof address === 'string'
      ? address
      : `${address?.address ?? '0.0.0.0'}:${address?.port ?? port}`;

  console.log(`🚀 API ready on ${bind}`);
};

const gracefulShutdown = (signal: NodeJS.Signals) => {
  console.log(`${signal} received. Closing server...`);

  // Close WebSocket connections
  io.close();

  server.close((error) => {
    if (error) {
      console.error('Error while shutting down server:', error);
      process.exit(1);
    }

    const finalize = async () => {
      try {
        // await disconnectRedis();
        // await emailWorker.close();
        // await emailQueue.close();
        // console.log('Email worker and queue closed');
      } catch (redisError) {
        console.error('Error while disconnecting Redis/Queue', redisError);
      }

      try {
        await disconnectDatabase();
      } catch (dbError) {
        console.error('Error while disconnecting Prisma', dbError);
      }

      process.exit(0);
    };

    void finalize();
  });
};

const bootstrap = async () => {
  try {
    await Promise.all([connectDatabase()]);
    server.listen(port);
  } catch (error) {
    console.error('Failed to bootstrap services', error);
    process.exit(1);
  }
};

bootstrap();

server.on('error', handleServerError);
server.on('listening', handleServerListening);

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

