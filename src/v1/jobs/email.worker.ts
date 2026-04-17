import { Worker, Job } from 'bullmq';
import { EMAIL_QUEUE_NAME } from './email.queue';
import { EmailService } from '../services/email.service';
import { EmailTemplates } from '../utils/email.templates';

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

interface EmailJobData {
    type: 'welcome' | 'password-reset' | 'ticket-confirmation' | 'announcement' | 'team-invitation' | 'event-cancellation' | 'email-verification' | 'payout-requested' | 'payout-approved' | 'payout-rejected' | 'payout-completed';
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
                case 'welcome': {
                    const template = EmailTemplates.welcome(data.name);
                    await EmailService.send(to, template.subject, template.html, template.text);
                    break;
                }

                case 'password-reset': {
                    const template = EmailTemplates.passwordReset(data.resetUrl);
                    await EmailService.send(to, template.subject, template.html, template.text);
                    break;
                }

                case 'ticket-confirmation': {
                    const template = EmailTemplates.ticketConfirmation({
                        eventTitle: data.eventTitle,
                        userTitle: data.userTitle,
                        qrCodeUrl: data.qrCodeUrl,
                        startDate: data.startDate,
                        venue: data.venue,
                    });
                    await EmailService.send(to, template.subject, template.html, template.text);
                    break;
                }

                case 'announcement': {
                    const template = EmailTemplates.announcement({
                        eventTitle: data.eventTitle,
                        subject: data.subject,
                        content: data.content,
                        organizerName: data.organizerName,
                    });
                    await EmailService.send(to, template.subject, template.html, template.text);
                    break;
                }

                case 'team-invitation': {
                    const template = EmailTemplates.teamInvitation({
                        eventTitle: data.eventTitle,
                        role: data.role,
                        inviteUrl: data.inviteUrl,
                    });
                    await EmailService.send(to, template.subject, template.html, template.text);
                    break;
                }

                case 'event-cancellation': {
                    const template = EmailTemplates.eventCancellation({
                        eventTitle: data.eventTitle,
                        eventDate: data.eventDate,
                        reason: data.reason,
                        refundPolicy: data.refundPolicy,
                    });
                    await EmailService.send(to, template.subject, template.html, template.text);
                    break;
                }

                case 'email-verification': {
                    const template = EmailTemplates.emailVerification(data.verifyUrl);
                    await EmailService.send(to, template.subject, template.html, template.text);
                    break;
                }

                case 'payout-requested': {
                    const template = EmailTemplates.payoutRequested({
                        name: data.name,
                        eventTitle: data.eventTitle,
                        netAmount: data.netAmount,
                        currency: data.currency,
                    });
                    await EmailService.send(to, template.subject, template.html, template.text);
                    break;
                }

                case 'payout-approved': {
                    const template = EmailTemplates.payoutApproved({
                        name: data.name,
                        netAmount: data.netAmount,
                        currency: data.currency,
                    });
                    await EmailService.send(to, template.subject, template.html, template.text);
                    break;
                }

                case 'payout-rejected': {
                    const template = EmailTemplates.payoutRejected({
                        name: data.name,
                        reason: data.reason,
                        currency: data.currency,
                    });
                    await EmailService.send(to, template.subject, template.html, template.text);
                    break;
                }

                case 'payout-completed': {
                    const template = EmailTemplates.payoutCompleted({
                        name: data.name,
                        netAmount: data.netAmount,
                        currency: data.currency,
                        paymentReference: data.paymentReference,
                    });
                    await EmailService.send(to, template.subject, template.html, template.text);
                    break;
                }

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
        connection,
        concurrency: 5,
        limiter: {
            max: 10,
            duration: 1000,
        }
    }
);

emailWorker.on('completed', (job) => {
    console.log(`[EmailWorker] Job ${job.id} has completed!`);
});

emailWorker.on('failed', (job, err) => {
    console.log(`[EmailWorker] Job ${job?.id} has failed with ${err.message}`);
});
