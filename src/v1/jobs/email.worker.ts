import { Worker, Job } from 'bullmq';
import { EMAIL_QUEUE_NAME } from './email.queue';
import { EmailService } from '../services/email.service';
import { EmailTemplates } from '../utils/email.templates';

const redisUrl = process.env.REDIS_URL;
const connection = redisUrl
    ? { url: redisUrl }
    : {
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    };

interface EmailJobData {
    type: 'welcome' | 'password-reset' | 'ticket-confirmation' | 'announcement';
    to: string;
    [key: string]: any;
}

export const emailWorker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobData>) => {
        const { type, to, ...data } = job.data;

        console.log(`[EmailWorker] Processing job ${job.id} of type ${type} to ${to}`);

        try {
            switch (type) {
                case 'password-reset':
                    const { resetUrl } = data;
                    const resetTemplate = EmailTemplates.passwordReset(resetUrl);
                    await EmailService.send(to, resetTemplate.subject, resetTemplate.html, resetTemplate.text);
                    break;

                // We can add other types here as we migrate them

                default:
                    console.warn(`[EmailWorker] Unknown job type: ${type}`);
            }

            console.log(`[EmailWorker] Job ${job.id} completed`);
        } catch (error) {
            console.error(`[EmailWorker] Job ${job.id} failed`, error);
            throw error;
        }
    },
    {
        connection: redisUrl ? new URL(redisUrl) as any : connection,
        concurrency: 5, // Process up to 5 emails concurrently
        limiter: {
            max: 10, // Max 10 jobs
            duration: 1000, // per 1 second (rate limiting email sending if needed)
        }
    }
);

emailWorker.on('completed', (job) => {
    console.log(`[EmailWorker] Job ${job.id} has completed!`);
});

emailWorker.on('failed', (job, err) => {
    console.log(`[EmailWorker] Job ${job?.id} has failed with ${err.message}`);
});
