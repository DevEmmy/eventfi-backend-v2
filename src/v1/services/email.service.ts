import { Resend } from 'resend';
import { EmailTemplates } from '../utils/email.templates';

/**
 * Email Service
 * Handles sending transactional and automated emails using Resend (HTTP-based).
 */
export class EmailService {
    private static resend: Resend | null = null;

    /**
     * Initialize the Resend client
     */
    private static getClient(): Resend {
        if (!this.resend) {
            const apiKey = process.env.RESEND_API_KEY;
            if (!apiKey) {
                console.error('[EmailService] RESEND_API_KEY is missing in .env');
                throw new Error('RESEND_API_KEY is not configured');
            }
            this.resend = new Resend(apiKey);
            console.log('[EmailService] Resend client initialized.');
        }
        return this.resend;
    }

    /**
     * Send a general email
     */
    static async send(to: string, subject: string, html: string, text?: string) {
        try {
            const client = this.getClient();
            const from = process.env.EMAIL_FROM || 'EventFi <noreply@eventfi.com>';

            const { data, error } = await client.emails.send({
                from,
                to: [to],
                subject,
                html,
                text: text || '',
            });

            if (error) {
                console.error('[EmailService] Resend error:', error);
                return null;
            }

            console.log(`[EmailService] Email sent to ${to}: ${data?.id}`);
            return data;
        } catch (error) {
            console.error('[EmailService] Error sending email:', error);
            return null;
        }
    }

    /**
     * Send Welcome Email
     */
    static async sendWelcomeEmail(to: string, name: string) {
        const template = EmailTemplates.welcome(name);
        return this.send(to, template.subject, template.html, template.text);
    }

    /**
     * Send Password Reset Email
     */
    static async sendPasswordResetEmail(to: string, resetUrl: string) {
        const template = EmailTemplates.passwordReset(resetUrl);
        return this.send(to, template.subject, template.html, template.text);
    }

    /**
     * Send Ticket Confirmation Email
     */
    static async sendTicketConfirmation(to: string, data: { eventTitle: string, userTitle: string, qrCodeUrl?: string, startDate: string, venue: string }) {
        const template = EmailTemplates.ticketConfirmation(data);
        return this.send(to, template.subject, template.html, template.text);
    }

    /**
     * Send Organizer Announcement
     */
    static async sendAnnouncement(to: string, data: { eventTitle: string, subject: string, content: string, organizerName: string }) {
        const template = EmailTemplates.announcement(data);
        return this.send(to, template.subject, template.html, template.text);
    }

    /**
     * Send Location Announced notification to all registered attendees
     */
    static async sendLocationAnnounced(to: string, data: { eventTitle: string, eventDate: string, venueName?: string, address?: string, eventUrl: string }) {
        const template = EmailTemplates.locationAnnounced(data);
        return this.send(to, template.subject, template.html, template.text);
    }
}
