import nodemailer from 'nodemailer';
import { EmailTemplates } from '../utils/email.templates';

/**
 * Email Service
 * Handles sending transactional and automated emails using Nodemailer.
 */
export class EmailService {
    private static transporter: nodemailer.Transporter | null = null;

    /**
     * Initialize the transporter
     */
    private static async getTransporter(): Promise<nodemailer.Transporter> {
        if (!this.transporter) {
            let auth = {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            };

      

            // If no credentials, create a test account (Ethereal)
            if (!auth.user || !auth.pass) {
                console.log('[EmailService] SMTP credentials missing in .env. Creating test account...');
                const testAccount = await nodemailer.createTestAccount();
                auth = {
                    user: testAccount.user,
                    pass: testAccount.pass,
                };
                console.log(`[EmailService] Created test account: ${auth.user}`);
            } else {
                console.log(`[EmailService] Using SMTP user: ${auth.user}`);
            }

            const port = parseInt(process.env.SMTP_PORT || '587');

            this.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.ethereal.email',
                port,
                secure: port === 465, // true for 465, false for other ports
                auth,
                connectionTimeout: 10000, // 10 seconds
                socketTimeout: 10000,
            });
            console.log('[EmailService] Transporter initialized.');
        }
        return this.transporter;
    }

    /**
     * Send a general email
     */
    static async send(to: string, subject: string, html: string, text?: string) {
        try {
            const transporter = await this.getTransporter();
            const from = process.env.SMTP_FROM || '"EventFi" <noreply@eventfi.com>';

            const info = await transporter.sendMail({
                from,
                to,
                subject,
                text: text || '',
                html,
            });

            console.log(`[EmailService] Email sent to ${to}: ${info.messageId}`);

            // If using Ethereal, log the preview URL
            const previewUrl = nodemailer.getTestMessageUrl(info);
            if (previewUrl) {
                console.log(`[EmailService] Preview URL: ${previewUrl}`);
            }

            return info;
        } catch (error) {
            console.error('[EmailService] Error sending email:', error);
            // We don't throw error to avoid breaking the main process (transactional)
            // unless it's critical. Usually, we'd log this to a monitoring service.
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
}
