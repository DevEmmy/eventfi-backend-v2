import { Queue } from 'bullmq';

const redisUrl = process.env.REDIS_URL;
const connection = redisUrl
    ? { url: redisUrl }
    : {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    };

export const EMAIL_QUEUE_NAME = 'email-queue';

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
    connection: redisUrl ? new URL(redisUrl) as any : connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
    },
});
