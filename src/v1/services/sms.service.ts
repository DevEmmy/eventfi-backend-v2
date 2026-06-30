const MULTITEXTER_URL = 'https://app.multitexter.com/v2/app/sms';

/**
 * Normalizes a Nigerian phone number to Multitexter's expected format:
 * digits only, country code 234, no leading 0 or '+'.
 * e.g. "0801 234 5678" / "+2348012345678" / "2348012345678" -> "2348012345678"
 */
function normalizePhone(phone: string): string | null {
    const digits = phone.replace(/[^\d]/g, '');
    if (digits.startsWith('234') && digits.length === 13) return digits;
    if (digits.startsWith('0') && digits.length === 11) return `234${digits.slice(1)}`;
    if (digits.length === 10) return `234${digits}`;
    return null;
}

export class MultitexterService {
    /**
     * Send one SMS message to a single recipient.
     */
    static async send(to: string, message: string): Promise<boolean> {
        return this.sendBulk([to], message);
    }

    /**
     * Send one SMS message to multiple recipients in a single Multitexter request
     * (their API accepts comma-separated recipients natively).
     */
    static async sendBulk(recipients: string[], message: string): Promise<boolean> {
        const email = process.env.MULTITEXTER_EMAIL;
        const password = process.env.MULTITEXTER_PASSWORD;
        const senderName = process.env.MULTITEXTER_SENDER_NAME;

        if (!email || !password || !senderName) {
            console.error('[MultitexterService] MULTITEXTER_EMAIL, MULTITEXTER_PASSWORD or MULTITEXTER_SENDER_NAME is missing in .env');
            return false;
        }

        const normalized = recipients
            .map(normalizePhone)
            .filter((n): n is string => n !== null);

        if (normalized.length === 0) {
            console.warn('[MultitexterService] No valid recipient phone numbers after normalization');
            return false;
        }

        try {
            const response = await fetch(MULTITEXTER_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email,
                    password,
                    message,
                    sender_name: senderName,
                    recipients: normalized.join(','),
                }),
            });

            const result = await response.json().catch(() => null);

            if (!response.ok) {
                console.error('[MultitexterService] Send failed:', response.status, result);
                return false;
            }

            console.log(`[MultitexterService] SMS sent to ${normalized.length} recipient(s)`);
            return true;
        } catch (error) {
            console.error('[MultitexterService] Error sending SMS:', error);
            return false;
        }
    }
}
