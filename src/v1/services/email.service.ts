import nodemailer from 'nodemailer';
import { EmailTemplates } from '../utils/email.templates';

export class EmailService {
    private static transporter: nodemailer.Transporter | null = null;

    private static getTransporter(): nodemailer.Transporter {
        if (!this.transporter) {
            const user = process.env.SMTP_USER;
            const pass = process.env.SMTP_PASS;

            if (!user || !pass) {
                console.error('[EmailService] SMTP_USER or SMTP_PASS is missing in .env');
                throw new Error('SMTP credentials are not configured');
            }

            this.transporter = nodemailer.createTransport({
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                auth: { user, pass },
                pool: true,
                maxConnections: 1,
                maxMessages: 100,
            });

            console.log('[EmailService] Nodemailer SMTP transporter initialized.');
        }
        return this.transporter;
    }

    static async send(to: string, subject: string, html: string, text?: string) {
        const transporter = this.getTransporter();
        const from = process.env.EMAIL_FROM || `EventFi <${process.env.SMTP_USER}>`;

        try {
            const info = await transporter.sendMail({ from, to, subject, html, text: text || '' });
            console.log(`[EmailService] Email sent to ${to}: ${info.messageId}`);
            return info;
        } catch (error) {
            console.error('[EmailService] Error sending email:', error);
            throw error;
        }
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
