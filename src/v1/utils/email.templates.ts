/**
 * Email Templates Utility
 * Contains functions to generate HTML and Text versions of various system emails.
 */

export const EmailTemplates = {
    /**
     * Welcome Email Template
     */
    welcome: (name: string) => ({
        subject: `Welcome to EventFi, ${name}! 🚀`,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h1 style="color: #6366f1;">Welcome to EventFi!</h1>
                <p>Hi ${name},</p>
                <p>We're thrilled to have you join our community. EventFi is your go-to platform for discovering, creating, and managing amazing events.</p>
                <p>Get started by exploring upcoming events or creating your own!</p>
                <div style="margin: 30px 0;">
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/explore" 
                       style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                       Explore Events
                    </a>
                </div>
                <p>If you have any questions, feel free to reply to this email.</p>
                <p>Stay awesome,<br>The EventFi Team</p>
            </div>
        `,
        text: `Welcome to EventFi, ${name}! We're thrilled to have you join our community. Explore events at ${process.env.FRONTEND_URL || 'http://localhost:3000'}/explore`
    }),

    /**
     * Password Reset Template
     */
    passwordReset: (resetUrl: string) => ({
        subject: 'Reset your EventFi password 🔒',
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #6366f1;">Password Reset Request</h2>
                <p>We received a request to reset your password for your EventFi account.</p>
                <p>Click the button below to set a new password. This link will expire in 1 hour.</p>
                <div style="margin: 30px 0;">
                    <a href="${resetUrl}" 
                       style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                       Reset Password
                    </a>
                </div>
                <p>If you didn't request this, you can safely ignore this email.</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="font-size: 12px; color: #666;">If you're having trouble clicking the button, copy and paste this URL into your browser:</p>
                <p style="font-size: 12px; color: #666;">${resetUrl}</p>
            </div>
        `,
        text: `Reset your EventFi password by visiting this link: ${resetUrl}. This link expires in 1 hour.`
    }),

    /**
     * Ticket Confirmation Template
     */
    ticketConfirmation: (data: { eventTitle: string, userTitle: string, qrCodeUrl?: string, startDate: string, venue: string }) => ({
        subject: `Your Ticket for ${data.eventTitle} 🎫`,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h2 style="color: #6366f1;">You're Going!</h2>
                <p>Hi ${data.userTitle},</p>
                <p>Your registration for <strong>${data.eventTitle}</strong> is confirmed.</p>
                
                <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 5px 0;"><strong>Date:</strong> ${data.startDate}</p>
                    <p style="margin: 5px 0;"><strong>Venue:</strong> ${data.venue}</p>
                </div>

                ${data.qrCodeUrl ? `
                <div style="text-align: center; margin: 30px 0;">
                    <p>Your Entry Ticket (QR Code):</p>
                    <img src="${data.qrCodeUrl}" alt="Ticket QR Code" style="width: 200px; height: 200px;" />
                </div>
                ` : ''}

                <div style="margin: 30px 0; text-align: center;">
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/tickets" 
                       style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                       View My Tickets
                    </a>
                </div>

                <p>Enjoy the event!</p>
                <p>The EventFi Team</p>
            </div>
        `,
        text: `Your ticket for ${data.eventTitle} is confirmed! Date: ${data.startDate}, Venue: ${data.venue}. View your tickets at ${process.env.FRONTEND_URL || 'http://localhost:3000'}/tickets`
    }),

    /**
     * General Announcement (Organizer to Attendees)
     */
    announcement: (data: { eventTitle: string, subject: string, content: string, organizerName: string }) => ({
        subject: `[Update] ${data.eventTitle}: ${data.subject}`,
        html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
                <h3 style="color: #6366f1;">Update for ${data.eventTitle}</h3>
                <p>${data.content.replace(/\n/g, '<br>')}</p>
                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
                <p style="font-size: 14px; color: #666;">Sent by ${data.organizerName} via EventFi</p>
            </div>
        `,
        text: `${data.subject}\n\n${data.content}\n\nSent by ${data.organizerName} for ${data.eventTitle}`
    })
};
