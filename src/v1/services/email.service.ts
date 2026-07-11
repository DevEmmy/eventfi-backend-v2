import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { EmailTemplates } from '../utils/email.templates';

export class EmailService {
    private static transporter: nodemailer.Transporter | null = null;
    private static resendClient: Resend | null = null;

    private static getTransporter(): nodemailer.Transporter | null {
        if (this.transporter) return this.transporter;

        const user = process.env.SMTP_USER;
        const pass = process.env.SMTP_PASS;
        if (!user || !pass) return null;

        this.transporter = nodemailer.createTransport({
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: { user, pass },
            // Reuse one authenticated connection instead of re-logging in per email —
            // that repeated AUTH is what tripped Gmail's "too many login attempts" block.
            pool: true,
            maxConnections: 1,
            maxMessages: 100,
        });
        return this.transporter;
    }

    private static getResendClient(): Resend | null {
        if (this.resendClient) return this.resendClient;

        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) return null;

        this.resendClient = new Resend(apiKey);
        return this.resendClient;
    }

    /**
     * Gmail SMTP is primary (free, generous daily volume) but prone to transient
     * auth-rate-limit blocks. Resend is the paid fallback — only hit when Gmail
     * actually fails, so the free-tier Resend quota is reserved for overflow.
     */
    static async send(to: string, subject: string, html: string, text?: string) {
        const transporter = this.getTransporter();
        const smtpFrom = process.env.EMAIL_FROM || (process.env.SMTP_USER ? `EventFi <${process.env.SMTP_USER}>` : undefined);

        if (transporter && smtpFrom) {
            try {
                const info = await transporter.sendMail({ from: smtpFrom, to, subject, html, text: text || '' });
                console.log(`[EmailService] Email sent via SMTP to ${to}: ${info.messageId}`);
                return info;
            } catch (error) {
                console.error('[EmailService] SMTP send failed, falling back to Resend:', error);
            }
        }

        const client = this.getResendClient();
        if (!client) {
            throw new Error('Email delivery failed: SMTP unavailable and RESEND_API_KEY is not configured');
        }

        const resendFrom = process.env.RESEND_FROM || process.env.EMAIL_FROM || 'EventFi <onboarding@resend.dev>';
        const { data, error } = await client.emails.send({ from: resendFrom, to, subject, html, text: text || '' });

        if (error) {
            console.error('[EmailService] Resend fallback also failed:', error);
            throw new Error(error.message);
        }

        console.log(`[EmailService] Email sent via Resend fallback to ${to}: ${data?.id}`);
        return data;
    }

    static async sendWelcomeEmail(to: string, name: string) {
        const template = EmailTemplates.welcome(name);
        return this.send(to, template.subject, template.html, template.text);
    }

    static async sendPasswordResetEmail(to: string, resetUrl: string, name?: string) {
        const template = EmailTemplates.passwordReset(resetUrl, name);
        return this.send(to, template.subject, template.html, template.text);
    }

    static async sendTicketConfirmation(to: string, data: Parameters<typeof EmailTemplates.ticketConfirmation>[0]) {
        const template = EmailTemplates.ticketConfirmation(data);
        return this.send(to, template.subject, template.html, template.text);
    }

    static async sendAnnouncement(to: string, data: Parameters<typeof EmailTemplates.announcement>[0]) {
        const template = EmailTemplates.announcement(data);
        return this.send(to, template.subject, template.html, template.text);
    }

    static async sendLocationAnnounced(to: string, data: Parameters<typeof EmailTemplates.locationAnnounced>[0]) {
        const template = EmailTemplates.locationAnnounced(data);
        return this.send(to, template.subject, template.html, template.text);
    }
}
