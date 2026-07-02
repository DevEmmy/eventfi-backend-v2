import { Resend } from 'resend';
import { EmailTemplates } from '../utils/email.templates';

export class EmailService {
    private static client: Resend | null = null;

    private static getClient(): Resend {
        if (!this.client) {
            const apiKey = process.env.RESEND_API_KEY;

            if (!apiKey) {
                console.error('[EmailService] RESEND_API_KEY is missing in .env');
                throw new Error('Resend API key is not configured');
            }

            this.client = new Resend(apiKey);
            console.log('[EmailService] Resend client initialized.');
        }
        return this.client;
    }

    static async send(to: string, subject: string, html: string, text?: string) {
        const client = this.getClient();
        const from = process.env.EMAIL_FROM || 'EventFi <onboarding@resend.dev>';

        const { data, error } = await client.emails.send({ from, to, subject, html, text: text || '' });

        if (error) {
            console.error('[EmailService] Error sending email:', error);
            throw new Error(error.message);
        }

        console.log(`[EmailService] Email sent to ${to}: ${data?.id}`);
        return data;
    }

    static async sendWelcomeEmail(to: string, name: string) {
        const template = EmailTemplates.welcome(name);
        return this.send(to, template.subject, template.html, template.text);
    }

    static async sendPasswordResetEmail(to: string, resetUrl: string) {
        const template = EmailTemplates.passwordReset(resetUrl);
        return this.send(to, template.subject, template.html, template.text);
    }

    static async sendTicketConfirmation(to: string, data: { eventTitle: string, userTitle: string, qrCodeUrl?: string, startDate: string, venue: string }) {
        const template = EmailTemplates.ticketConfirmation(data);
        return this.send(to, template.subject, template.html, template.text);
    }

    static async sendAnnouncement(to: string, data: { eventTitle: string, subject: string, content: string, organizerName: string }) {
        const template = EmailTemplates.announcement(data);
        return this.send(to, template.subject, template.html, template.text);
    }

    static async sendLocationAnnounced(to: string, data: { eventTitle: string, eventDate: string, venueName?: string, address?: string, eventUrl: string }) {
        const template = EmailTemplates.locationAnnounced(data);
        return this.send(to, template.subject, template.html, template.text);
    }
}
