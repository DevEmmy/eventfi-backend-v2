import { Queue, Job } from 'bullmq';
import { REDIS_ENABLED } from '../config/redis';

function buildConnection() {
    const url = process.env.REDIS_URL;
    if (url) {
        const parsed = new URL(url);
        return {
            host: parsed.hostname,
            port: parseInt(parsed.port) || 6379,
            password: parsed.password || undefined,
            username: parsed.username || undefined,
            tls: parsed.protocol === 'rediss:' ? {} : undefined,
        };
    }
    return {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    };
}

export const SMS_QUEUE_NAME = 'sms-queue';

export interface JobQueue {
    name: string;
    add(jobName: string, data: any): Promise<unknown>;
}

let inlineJobCount = 0;

// Without Redis there is no worker to pick jobs up, so run the processor directly in the
// background. No retries in this mode — a failure is logged and dropped.
const inlineSmsQueue: JobQueue = {
    name: SMS_QUEUE_NAME,
    async add(jobName, data) {
        const job = { id: `inline-${++inlineJobCount}`, name: jobName, data } as Job;
        setImmediate(async () => {
            try {
                // Lazy import: sms.worker imports this module
                const { processSmsJob } = await import('./sms.worker');
                await processSmsJob(job);
            } catch {
                // already logged by the processor
            }
        });
        return job;
    },
};

export const smsQueue: JobQueue = !REDIS_ENABLED ? inlineSmsQueue : new Queue(SMS_QUEUE_NAME, {
    connection: buildConnection(),
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: { count: 100 }, // keep last 100 failed jobs for debugging; don't retain indefinitely
    },
});
