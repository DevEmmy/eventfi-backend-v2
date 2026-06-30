import { Worker, Job } from 'bullmq';
import { SMS_QUEUE_NAME } from './sms.queue';
import { MultitexterService } from '../services/sms.service';

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

const connection = buildConnection();

interface SmsJobData {
    type: 'event-reminder' | 'announcement';
    recipients: string[];
    message: string;
}

export const smsWorker = new Worker<SmsJobData>(
    SMS_QUEUE_NAME,
    async (job: Job<SmsJobData>) => {
        const { type, recipients, message } = job.data;

        console.log(`[SmsWorker] Processing job ${job.id} of type ${type} to ${recipients.length} recipient(s)`);

        try {
            const sent = await MultitexterService.sendBulk(recipients, message);
            if (!sent) {
                throw new Error('Multitexter send returned failure');
            }
            console.log(`[SmsWorker] Job ${job.id} completed`);
        } catch (error) {
            console.error(`[SmsWorker] Job ${job.id} failed`, error);
            throw error;
        }
    },
    {
        connection,
        concurrency: 3,
        limiter: {
            max: 5,
            duration: 1000,
        }
    }
);

smsWorker.on('completed', (job) => {
    console.log(`[SmsWorker] Job ${job.id} has completed!`);
});

smsWorker.on('failed', (job, err) => {
    console.log(`[SmsWorker] Job ${job?.id} has failed with ${err.message}`);
});
