/**
 * Email Templates Utility
 * Contains functions to generate HTML and Text versions of various system emails.
 */

const BRAND_COLOR = '#6366f1';
const WEBSITE_URL = 'https://eventfi.live';
const SOCIAL_LINKS = {
    x: 'https://x.com/theEventfi',
    instagram: 'https://instagram.com/the_eventfi',
};

interface LayoutOptions {
    heading: string;
    bodyHtml: string;
    ctaLabel?: string;
    ctaUrl?: string;
    contextTitle?: string;
    contextMeta?: string;
    contextImageUrl?: string;
    contextUrl?: string;
    hostName?: string;
    hostAvatarUrl?: string;
    hostProfileUrl?: string;
    footerNote?: string;
}

function socialIcon(href: string, letter: string) {
    return `<a href="${href}" style="display:inline-block; width:30px; height:30px; line-height:30px; text-align:center; border-radius:50%; background-color:#f1f1f4; color:#666; font-size:12px; font-weight:700; text-decoration:none; margin:0 4px; font-family:sans-serif;">${letter}</a>`;
}

/**
 * Most email clients (Gmail, Outlook, Yahoo) refuse to render SVG images for
 * security reasons, so they show up as broken. Dicebear (our default seeded
 * avatar) serves SVG by default — swap it for their PNG raster endpoint.
 */
function toEmailSafeImageUrl(url?: string): string | undefined {
    if (!url) return url;
    if (url.includes('api.dicebear.com') && url.includes('/svg')) {
        return url.replace('/svg', '/png');
    }
    if (/\.svg(\?|$)/i.test(url)) return undefined;
    return url;
}

function renderLayout(opts: LayoutOptions): string {
    const {
        heading, bodyHtml, ctaLabel, ctaUrl,
        contextTitle, contextMeta, contextUrl,
        hostName, hostProfileUrl, footerNote,
    } = opts;
    const contextImageUrl = toEmailSafeImageUrl(opts.contextImageUrl);
    const hostAvatarUrl = toEmailSafeImageUrl(opts.hostAvatarUrl);

    const contextHeader = contextTitle ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
            <tr>
                <td style="font-size:15px; font-weight:700; color:#111;">
                    ${contextImageUrl ? `<img src="${contextImageUrl}" width="28" height="28" alt="" style="border-radius:6px; vertical-align:middle; margin-right:8px; object-fit:cover;" />` : ''}
                    <span style="vertical-align:middle;">${contextTitle}</span>
                </td>
                ${contextUrl ? `<td style="text-align:right; width:24px;"><a href="${contextUrl}" style="color:#999; text-decoration:none; font-size:16px;">&#8599;</a></td>` : ''}
            </tr>
            ${contextMeta ? `<tr><td colspan="2" style="font-size:13px; color:#888; padding-top:2px;">${contextMeta}</td></tr>` : ''}
        </table>
    ` : '';

    const heroImage = contextImageUrl ? `
        <img src="${contextImageUrl}" alt="${contextTitle || 'Event'}" width="600" style="width:100%; max-width:600px; height:auto; max-height:280px; object-fit:cover; border-radius:10px; display:block; margin-bottom:20px;" />
    ` : '';

    const hostRow = hostName ? `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
            <tr>
                <td style="padding-right:10px;">
                    ${hostAvatarUrl
            ? `<img src="${hostAvatarUrl}" width="36" height="36" alt="${hostName}" style="border-radius:50%; display:block; object-fit:cover;" />`
            : `<div style="width:36px; height:36px; border-radius:50%; background-color:${BRAND_COLOR}; color:#fff; text-align:center; line-height:36px; font-weight:700; font-size:14px; font-family:sans-serif;">${hostName.charAt(0).toUpperCase()}</div>`
        }
                </td>
                <td style="font-size:14px; color:#666; font-family:sans-serif;">
                    Hosted by<br/>
                    ${hostProfileUrl
            ? `<a href="${hostProfileUrl}" style="color:#111; font-weight:700; text-decoration:none;">${hostName}</a>`
            : `<span style="color:#111; font-weight:700;">${hostName}</span>`
        }
                </td>
            </tr>
        </table>
    ` : '';

    const ctaButton = ctaUrl ? `
        <div style="margin:28px 0;">
            <a href="${ctaUrl}" style="background-color:${BRAND_COLOR}; color:#ffffff; padding:12px 28px; text-decoration:none; border-radius:8px; font-weight:600; font-size:14px; display:inline-block; font-family:sans-serif;">${ctaLabel || 'View Details'}</a>
        </div>
    ` : '';

    return `
    <div style="background-color:#f4f4f7; padding:24px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
        <div style="max-width:600px; margin:0 auto; background-color:#ffffff; border:1px solid #eee; border-radius:14px; padding:28px;">
            ${contextHeader}
            ${heroImage}
            ${hostRow}
            <h2 style="color:#111; font-size:20px; margin:0 0 12px;">${heading}</h2>
            <div style="font-size:15px; line-height:1.6; color:#333;">${bodyHtml}</div>
            ${ctaButton}
            <hr style="border:0; border-top:1px solid #eee; margin:28px 0 24px;" />
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr>
                    <td>
                        <p style="margin:0 0 4px; font-weight:700; font-size:14px; color:#111;">Discover more on EventFi</p>
                        <p style="margin:0 0 12px; font-size:13px; color:#666;">Find events, connect with organizers, and manage your tickets — all in one place.</p>
                        <a href="${WEBSITE_URL}" style="display:inline-block; background-color:#111; color:#ffffff; text-decoration:none; padding:10px 18px; border-radius:8px; font-size:13px; font-weight:600;">Visit eventfi.live</a>
                    </td>
                </tr>
            </table>
            <p style="font-size:12px; color:#999; margin:0 0 16px;">${footerNote || 'You are receiving this email because you have an account on EventFi.'}</p>
            <div style="margin-bottom:16px;">
                ${socialIcon(SOCIAL_LINKS.x, 'X')}
                ${socialIcon(SOCIAL_LINKS.instagram, 'IG')}
            </div>
            <p style="font-size:11px; color:#bbb; margin:0;">EventFi &middot; <a href="${WEBSITE_URL}" style="color:#bbb;">eventfi.live</a></p>
        </div>
    </div>
    `;
}

export const EmailTemplates = {
    /**
     * Email Verification Template
     */
    emailVerification: (verifyUrl: string, name?: string) => ({
        subject: 'Verify your EventFi email address',
        html: renderLayout({
            heading: 'Verify your email',
            bodyHtml: `
                <p>Hi ${name || 'there'},</p>
                <p>Thanks for signing up for EventFi! Please verify your email address by clicking the button below.</p>
                <p>This link will expire in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
                <p style="font-size:12px; color:#999;">If the button doesn't work, copy and paste this URL: ${verifyUrl}</p>
            `,
            ctaLabel: 'Verify Email',
            ctaUrl: verifyUrl,
        }),
        text: `Hi ${name || 'there'}, verify your EventFi email by visiting: ${verifyUrl}. This link expires in 24 hours.`
    }),

    /**
     * Welcome Email Template
     */
    welcome: (name: string) => ({
        subject: `Welcome to EventFi, ${name}! 🚀`,
        html: renderLayout({
            heading: 'Welcome to EventFi!',
            bodyHtml: `
                <p>Hi ${name},</p>
                <p>We're thrilled to have you join our community. EventFi is your go-to platform for discovering, creating, and managing amazing events.</p>
                <p>Get started by exploring upcoming events or creating your own!</p>
                <p>If you have any questions, feel free to reply to this email.</p>
                <p>Stay awesome,<br>The EventFi Team</p>
            `,
            ctaLabel: 'Explore Events',
            ctaUrl: `${WEBSITE_URL}/explore-events`,
        }),
        text: `Welcome to EventFi, ${name}! We're thrilled to have you join our community. Explore events at ${WEBSITE_URL}/explore-events`
    }),

    /**
     * Password Reset Template
     */
    passwordReset: (resetUrl: string, name?: string) => ({
        subject: 'Reset your EventFi password 🔒',
        html: renderLayout({
            heading: 'Password Reset Request',
            bodyHtml: `
                <p>Hi ${name || 'there'},</p>
                <p>We received a request to reset your password for your EventFi account.</p>
                <p>Click the button below to set a new password. This link will expire in 1 hour.</p>
                <p>If you didn't request this, you can safely ignore this email.</p>
                <p style="font-size:12px; color:#999;">If you're having trouble clicking the button, copy and paste this URL into your browser:<br/>${resetUrl}</p>
            `,
            ctaLabel: 'Reset Password',
            ctaUrl: resetUrl,
        }),
        text: `Hi ${name || 'there'}, reset your EventFi password by visiting this link: ${resetUrl}. This link expires in 1 hour.`
    }),

    /**
     * Ticket Confirmation Template
     */
    ticketConfirmation: (data: { eventTitle: string, userTitle: string, qrCodeUrl?: string, startDate: string, venue: string, eventImageUrl?: string, eventUrl?: string, organizerName?: string, organizerAvatarUrl?: string, organizerProfileUrl?: string }) => ({
        subject: `Your Ticket for ${data.eventTitle} 🎫`,
        html: renderLayout({
            contextTitle: data.eventTitle,
            contextMeta: [data.startDate, data.venue].filter(Boolean).join(' &middot; '),
            contextImageUrl: data.eventImageUrl,
            contextUrl: data.eventUrl,
            hostName: data.organizerName,
            hostAvatarUrl: data.organizerAvatarUrl,
            hostProfileUrl: data.organizerProfileUrl,
            heading: "You're Going!",
            bodyHtml: `
                <p>Hi ${data.userTitle},</p>
                <p>Your registration for <strong>${data.eventTitle}</strong> is confirmed.</p>
                <div style="background-color:#f8fafc; padding:15px; border-radius:8px; margin:20px 0;">
                    <p style="margin:5px 0;"><strong>Date:</strong> ${data.startDate}</p>
                    <p style="margin:5px 0;"><strong>Venue:</strong> ${data.venue}</p>
                </div>
                ${data.qrCodeUrl ? `
                <div style="text-align:center; margin:24px 0;">
                    <p style="margin:0 0 10px;">Your Entry Ticket (QR Code):</p>
                    <img src="${data.qrCodeUrl}" alt="Ticket QR Code" style="width:200px; height:200px;" />
                </div>
                ` : ''}
                <p>Enjoy the event!</p>
                <p>The EventFi Team</p>
            `,
            ctaLabel: 'View My Tickets',
            ctaUrl: `${WEBSITE_URL}/profile?tab=tickets`,
        }),
        text: `Your ticket for ${data.eventTitle} is confirmed! Date: ${data.startDate}, Venue: ${data.venue}. View your tickets at ${WEBSITE_URL}/profile?tab=tickets`
    }),

    /**
     * Team Invitation Template
     */
    teamInvitation: (data: { eventTitle: string, role: string, inviteUrl: string, eventImageUrl?: string, eventUrl?: string }) => ({
        subject: `You're invited to join the team for ${data.eventTitle}`,
        html: renderLayout({
            contextTitle: data.eventTitle,
            contextImageUrl: data.eventImageUrl,
            contextUrl: data.eventUrl,
            heading: 'Team Invitation',
            bodyHtml: `
                <p>You've been invited to join the team for <strong>${data.eventTitle}</strong> as a <strong>${data.role}</strong>.</p>
                <p>Click the button below to accept your invitation and join the team.</p>
                <p>If you weren't expecting this, you can safely ignore this email.</p>
                <p>The EventFi Team</p>
            `,
            ctaLabel: 'Accept Invitation',
            ctaUrl: data.inviteUrl,
        }),
        text: `You've been invited to join the team for ${data.eventTitle} as a ${data.role}. Accept at: ${data.inviteUrl}`
    }),

    /**
     * Event Cancellation Template
     */
    eventCancellation: (data: { eventTitle: string, eventDate: string, reason?: string, refundPolicy: string, eventImageUrl?: string, recipientName?: string }) => ({
        subject: `Event Cancelled: ${data.eventTitle}`,
        html: renderLayout({
            contextTitle: data.eventTitle,
            contextMeta: data.eventDate,
            contextImageUrl: data.eventImageUrl,
            heading: 'Event Cancelled',
            bodyHtml: `
                <p>Hi ${data.recipientName || 'there'},</p>
                <p>We're sorry to inform you that <strong>${data.eventTitle}</strong> scheduled for <strong>${data.eventDate}</strong> has been cancelled.</p>
                ${data.reason ? `<p><strong>Reason:</strong> ${data.reason}</p>` : ''}
                <div style="background-color:#f8fafc; padding:15px; border-radius:8px; margin:20px 0;">
                    <p style="margin:5px 0;"><strong>Refund Policy:</strong> ${data.refundPolicy === 'full' ? 'Full refund will be processed' : data.refundPolicy === 'partial' ? 'Partial refund will be processed' : 'No refund applicable'}</p>
                </div>
                <p>We apologize for any inconvenience.</p>
                <p>The EventFi Team</p>
            `,
        }),
        text: `Hi ${data.recipientName || 'there'}, Event Cancelled: ${data.eventTitle} (${data.eventDate}). ${data.reason || ''} Refund: ${data.refundPolicy}. We apologize for any inconvenience.`
    }),

    /**
     * Team Added Notification (for existing users added to a team)
     */
    teamAdded: (data: { eventTitle: string, role: string, eventUrl: string, eventImageUrl?: string, recipientName?: string }) => ({
        subject: `You've been added to the team for ${data.eventTitle}`,
        html: renderLayout({
            contextTitle: data.eventTitle,
            contextImageUrl: data.eventImageUrl,
            contextUrl: data.eventUrl,
            heading: "You're on the Team!",
            bodyHtml: `
                <p>Hi ${data.recipientName || 'there'},</p>
                <p>You've been added to the team for <strong>${data.eventTitle}</strong> as a <strong>${data.role}</strong>.</p>
                <p>You can now manage this event from your dashboard.</p>
                <p>The EventFi Team</p>
            `,
            ctaLabel: 'View Event',
            ctaUrl: data.eventUrl,
        }),
        text: `Hi ${data.recipientName || 'there'}, you've been added to the team for ${data.eventTitle} as a ${data.role}. View the event at: ${data.eventUrl}`
    }),

    /**
     * Location Announced Template — sent when organizer sets venue on a previously unannounced event
     */
    locationAnnounced: (data: { eventTitle: string, eventDate: string, venueName?: string, address?: string, eventUrl: string, eventImageUrl?: string, organizerName?: string, organizerAvatarUrl?: string, organizerProfileUrl?: string }) => ({
        subject: `📍 Venue Confirmed: ${data.eventTitle}`,
        html: renderLayout({
            contextTitle: data.eventTitle,
            contextMeta: data.eventDate,
            contextImageUrl: data.eventImageUrl,
            contextUrl: data.eventUrl,
            hostName: data.organizerName,
            hostAvatarUrl: data.organizerAvatarUrl,
            hostProfileUrl: data.organizerProfileUrl,
            heading: 'The venue has been confirmed!',
            bodyHtml: `
                <p>Great news — the organizer of <strong>${data.eventTitle}</strong> has just confirmed the venue details for the event on <strong>${data.eventDate}</strong>.</p>
                <div style="background-color:#f5f3ff; border-left:4px solid ${BRAND_COLOR}; padding:16px 20px; border-radius:8px; margin:20px 0;">
                    <p style="margin:0 0 4px; font-weight:bold; color:#4f46e5;">📍 Venue</p>
                    ${data.venueName ? `<p style="margin:0 0 4px; font-size:16px; font-weight:600; color:#111;">${data.venueName}</p>` : ''}
                    ${data.address ? `<p style="margin:0; color:#555;">${data.address}</p>` : ''}
                </div>
                <p>Mark your calendar and make sure you have your ticket ready. We look forward to seeing you there!</p>
                <p style="color:#888; font-size:13px;">You are receiving this because you registered for this event on EventFi.</p>
                <p>The EventFi Team</p>
            `,
            ctaLabel: 'View Event Details',
            ctaUrl: data.eventUrl,
        }),
        text: `Venue Confirmed for ${data.eventTitle} (${data.eventDate}). ${data.venueName || ''} — ${data.address || ''}. View event: ${data.eventUrl}`
    }),

    /**
     * General Announcement (Organizer to Attendees)
     */
    announcement: (data: { eventTitle: string, subject: string, content: string, organizerName: string, eventImageUrl?: string, eventUrl?: string, organizerAvatarUrl?: string, organizerProfileUrl?: string, recipientName?: string }) => ({
        subject: `[Update] ${data.eventTitle}: ${data.subject}`,
        html: renderLayout({
            contextTitle: data.eventTitle,
            contextImageUrl: data.eventImageUrl,
            contextUrl: data.eventUrl,
            hostName: data.organizerName,
            hostAvatarUrl: data.organizerAvatarUrl,
            hostProfileUrl: data.organizerProfileUrl,
            heading: data.subject,
            bodyHtml: `
                <p>Hi ${data.recipientName || 'there'},</p>
                <p>${data.content.replace(/\n/g, '<br>')}</p>
            `,
            ctaLabel: data.eventUrl ? 'View Event' : undefined,
            ctaUrl: data.eventUrl,
            footerNote: `Sent by ${data.organizerName} via EventFi.`,
        }),
        text: `Hi ${data.recipientName || 'there'},\n\n${data.subject}\n\n${data.content}\n\nSent by ${data.organizerName} for ${data.eventTitle}`
    }),

    // ─── Payout emails ────────────────────────────────────────────────────────

    payoutRequested: (data: { name: string; eventTitle: string; netAmount: number; currency: string }) => ({
        subject: 'Payout request received — EventFi',
        html: renderLayout({
            heading: 'Payout request received',
            bodyHtml: `
                <p>Hi ${data.name},</p>
                <p>We've received your payout request for <strong>${data.eventTitle}</strong>.</p>
                <table style="width:100%; border-collapse:collapse; margin:16px 0;">
                    <tr><td style="padding:8px; color:#666;">Amount requested</td><td style="padding:8px; font-weight:bold;">${data.currency} ${data.netAmount.toLocaleString()}</td></tr>
                    <tr style="background-color:#f9f9f9"><td style="padding:8px; color:#666;">Status</td><td style="padding:8px;">Under review</td></tr>
                </table>
                <p>Our team will review your request within 1–2 business days. You'll receive another email once it's approved or if we need more information.</p>
                <p>The EventFi Team</p>
            `,
        }),
        text: `Hi ${data.name}, we received your payout request for ${data.eventTitle}. Amount: ${data.currency} ${data.netAmount.toLocaleString()}. Status: Under review. We'll update you within 1–2 business days.`
    }),

    payoutApproved: (data: { name: string; netAmount: number; currency: string }) => ({
        subject: 'Your payout has been approved — EventFi',
        html: renderLayout({
            heading: 'Payout approved!',
            bodyHtml: `
                <p>Hi ${data.name},</p>
                <p>Great news — your payout of <strong>${data.currency} ${data.netAmount.toLocaleString()}</strong> has been approved and is now being processed to your registered bank account.</p>
                <p>Bank transfers typically arrive within 1–3 business days depending on your bank.</p>
                <p>The EventFi Team</p>
            `,
        }),
        text: `Hi ${data.name}, your payout of ${data.currency} ${data.netAmount.toLocaleString()} has been approved and is being processed. Expect funds within 1–3 business days.`
    }),

    payoutRejected: (data: { name: string; reason: string; currency: string }) => ({
        subject: 'Payout request update — EventFi',
        html: renderLayout({
            heading: 'Payout request not approved',
            bodyHtml: `
                <p>Hi ${data.name},</p>
                <p>Unfortunately we were unable to process your payout request at this time.</p>
                <p><strong>Reason:</strong> ${data.reason}</p>
                <p>If you believe this is an error or need assistance, please contact our support team.</p>
                <p>The EventFi Team</p>
            `,
        }),
        text: `Hi ${data.name}, your payout request was not approved. Reason: ${data.reason}. Contact support if you need assistance.`
    }),

    payoutCompleted: (data: { name: string; netAmount: number; currency: string; paymentReference: string }) => ({
        subject: 'Your payout is on its way — EventFi',
        html: renderLayout({
            heading: 'Payment sent!',
            bodyHtml: `
                <p>Hi ${data.name},</p>
                <p><strong>${data.currency} ${data.netAmount.toLocaleString()}</strong> has been transferred to your bank account.</p>
                <table style="width:100%; border-collapse:collapse; margin:16px 0;">
                    <tr><td style="padding:8px; color:#666;">Reference</td><td style="padding:8px; font-family:monospace;">${data.paymentReference}</td></tr>
                </table>
                <p>Please keep this reference number for your records. If the funds haven't arrived after 3 business days, contact your bank with this reference.</p>
                <p>Thank you for hosting on EventFi!</p>
                <p>The EventFi Team</p>
            `,
        }),
        text: `Hi ${data.name}, ${data.currency} ${data.netAmount.toLocaleString()} has been transferred to your bank. Reference: ${data.paymentReference}. Keep this for your records.`
    }),

    // ─── Installment payment emails ────────────────────────────────────────────

    installmentReminder: (data: { eventTitle: string; sequence: number; installmentCount: number; amount: number; currency: string; dueDate: string; payUrl: string; recipientName?: string }) => ({
        subject: `Payment reminder: installment ${data.sequence}/${data.installmentCount} due for ${data.eventTitle}`,
        html: renderLayout({
            heading: 'Installment payment due soon',
            bodyHtml: `
                <p>Hi ${data.recipientName || 'there'},</p>
                <p>Your next installment for <strong>${data.eventTitle}</strong> is coming up.</p>
                <table style="width:100%; border-collapse:collapse; margin:16px 0;">
                    <tr><td style="padding:8px; color:#666;">Installment</td><td style="padding:8px; font-weight:bold;">${data.sequence} of ${data.installmentCount}</td></tr>
                    <tr style="background-color:#f9f9f9"><td style="padding:8px; color:#666;">Amount due</td><td style="padding:8px; font-weight:bold;">${data.currency} ${data.amount.toLocaleString()}</td></tr>
                    <tr><td style="padding:8px; color:#666;">Due date</td><td style="padding:8px;">${data.dueDate}</td></tr>
                </table>
                <p>Pay before the due date to keep your tickets reserved.</p>
                <p>The EventFi Team</p>
            `,
            ctaLabel: 'Pay now',
            ctaUrl: data.payUrl,
        }),
        text: `Hi ${data.recipientName || 'there'}, installment ${data.sequence}/${data.installmentCount} for ${data.eventTitle} is due ${data.dueDate}: ${data.currency} ${data.amount.toLocaleString()}. Pay at: ${data.payUrl}`
    }),

    installmentOverdue: (data: { eventTitle: string; sequence: number; installmentCount: number; amount: number; currency: string; graceDays: number; payUrl: string; recipientName?: string }) => ({
        subject: `Overdue: installment ${data.sequence}/${data.installmentCount} for ${data.eventTitle}`,
        html: renderLayout({
            heading: 'Installment payment overdue',
            bodyHtml: `
                <p>Hi ${data.recipientName || 'there'},</p>
                <p>Installment <strong>${data.sequence} of ${data.installmentCount}</strong> for <strong>${data.eventTitle}</strong> is now overdue.</p>
                <table style="width:100%; border-collapse:collapse; margin:16px 0;">
                    <tr><td style="padding:8px; color:#666;">Amount due</td><td style="padding:8px; font-weight:bold;">${data.currency} ${data.amount.toLocaleString()}</td></tr>
                </table>
                <p>You have <strong>${data.graceDays} day${data.graceDays > 1 ? 's' : ''}</strong> left to pay before your order is cancelled and your tickets are released.</p>
                <p>The EventFi Team</p>
            `,
            ctaLabel: 'Pay now',
            ctaUrl: data.payUrl,
        }),
        text: `Hi ${data.recipientName || 'there'}, installment ${data.sequence}/${data.installmentCount} for ${data.eventTitle} is overdue: ${data.currency} ${data.amount.toLocaleString()}. You have ${data.graceDays} day(s) left before cancellation. Pay at: ${data.payUrl}`
    }),

    installmentDefaulted: (data: { eventTitle: string; recipientName?: string; currency: string; depositAmount: number; refundedAmount: number }) => {
        const refundLine = data.refundedAmount > 0
            ? `Your ${data.currency} ${data.depositAmount.toLocaleString()} deposit is non-refundable, but the ${data.currency} ${data.refundedAmount.toLocaleString()} you paid beyond that has been refunded to your original payment method.`
            : `Your ${data.currency} ${data.depositAmount.toLocaleString()} deposit is non-refundable.`;
        return {
            subject: `Your installment plan for ${data.eventTitle} was cancelled`,
            html: renderLayout({
                heading: 'Installment plan cancelled',
                bodyHtml: `
                    <p>Hi ${data.recipientName || 'there'},</p>
                    <p>Your installment plan for <strong>${data.eventTitle}</strong> has been cancelled after a missed payment past the grace period.</p>
                    <p>Your reserved tickets have been released back to the event. ${refundLine}</p>
                    <p>If you'd still like to attend, check the event page — you may be able to reinstate your plan if tickets are still available.</p>
                    <p>The EventFi Team</p>
                `,
            }),
            text: `Hi ${data.recipientName || 'there'}, your installment plan for ${data.eventTitle} was cancelled after a missed payment. Reserved tickets have been released. ${refundLine}`
        };
    },

    // ─── Community emails ──────────────────────────────────────────────────────

    /**
     * Community Member Invitation Template (for users who don't have an account yet,
     * or need to accept the invite explicitly)
     */
    communityInvitation: (data: { communityName: string, role: string, chapterName?: string, inviteUrl: string, communityImageUrl?: string, ownerName?: string, ownerAvatarUrl?: string, ownerProfileUrl?: string }) => ({
        subject: `You're invited to join ${data.communityName} on EventFi`,
        html: renderLayout({
            contextTitle: data.communityName,
            contextImageUrl: data.communityImageUrl,
            hostName: data.ownerName,
            hostAvatarUrl: data.ownerAvatarUrl,
            hostProfileUrl: data.ownerProfileUrl,
            heading: 'Community Invitation',
            bodyHtml: `
                <p>You've been invited to join <strong>${data.communityName}</strong> as ${data.chapterName ? `the <strong>${data.role}</strong> for <strong>${data.chapterName}</strong>` : `an <strong>${data.role}</strong>`}.</p>
                <p>Click the button below to accept your invitation.</p>
                <p>If you weren't expecting this, you can safely ignore this email.</p>
                <p>The EventFi Team</p>
            `,
            ctaLabel: 'Accept Invitation',
            ctaUrl: data.inviteUrl,
        }),
        text: `You've been invited to join ${data.communityName} as ${data.chapterName ? `${data.role} for ${data.chapterName}` : data.role}. Accept at: ${data.inviteUrl}`
    }),

    /**
     * Community Member Added Notification (for existing users added directly to a community)
     */
    communityMemberAdded: (data: { communityName: string, role: string, chapterName?: string, communityUrl: string, communityImageUrl?: string, ownerName?: string, ownerAvatarUrl?: string, ownerProfileUrl?: string, recipientName?: string }) => ({
        subject: `You've been added to ${data.communityName}`,
        html: renderLayout({
            contextTitle: data.communityName,
            contextImageUrl: data.communityImageUrl,
            contextUrl: data.communityUrl,
            hostName: data.ownerName,
            hostAvatarUrl: data.ownerAvatarUrl,
            hostProfileUrl: data.ownerProfileUrl,
            heading: "You're part of the team!",
            bodyHtml: `
                <p>Hi ${data.recipientName || 'there'},</p>
                <p>You've been added to <strong>${data.communityName}</strong> as ${data.chapterName ? `the <strong>${data.role}</strong> for <strong>${data.chapterName}</strong>` : `an <strong>${data.role}</strong>`}.</p>
                <p>You can now manage this community from your dashboard.</p>
                <p>The EventFi Team</p>
            `,
            ctaLabel: 'View Community',
            ctaUrl: data.communityUrl,
        }),
        text: `Hi ${data.recipientName || 'there'}, you've been added to ${data.communityName} as ${data.chapterName ? `${data.role} for ${data.chapterName}` : data.role}. View it at: ${data.communityUrl}`
    }),
};
