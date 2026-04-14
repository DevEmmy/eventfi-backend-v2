import { ZendFiClient, type Currency } from '@zendfi/sdk';
import crypto from 'crypto';

const ZENDFI_API_KEY = process.env.ZENDFI_API_KEY;
const ZENDFI_WEBHOOK_SECRET = process.env.ZENDFI_WEBHOOK_SECRET;

if (!ZENDFI_API_KEY) {
    console.warn('WARNING: ZENDFI_API_KEY is not set. Payment features will be unavailable.');
}

const zendfi = ZENDFI_API_KEY ? new ZendFiClient({ apiKey: ZENDFI_API_KEY }) : null;

export interface PaymentInitResult {
    paymentUrl: string;
    reference: string; // ZendFi payment ID (pay_test_... / pay_live_...)
}

export interface PaymentVerifyResult {
    status: 'success' | 'failed' | 'abandoned';
    reference: string;
    amount: number;
    currency: string;
}

export class PaymentService {
    /**
     * Create a ZendFi payment and return the hosted checkout URL.
     * ZendFi accepts amounts in standard units (not smallest unit).
     * Supported currencies: USD, EUR, GBP. Supported tokens: USDC, USDT, SOL.
     */
    static async initializeTransaction(
        amount: number,
        currency: string,
        description: string,
        metadata?: Record<string, any>
    ): Promise<PaymentInitResult> {
        if (!zendfi) {
            throw new Error('Payment service not configured. Set ZENDFI_API_KEY environment variable.');
        }

        // ZendFi only supports USD/EUR/GBP — default to USD for unsupported currencies (e.g. NGN)
        const zendfiCurrency = (['USD', 'EUR', 'GBP'].includes(currency) ? currency : 'USD') as Currency;

        const payment = await zendfi.createPayment({
            amount,
            currency: zendfiCurrency,
            token: 'USDC',
            description,
            metadata,
        });

        return {
            paymentUrl: (payment as any).payment_url,
            reference: (payment as any).id,
        };
    }

    /**
     * Fetch a ZendFi payment by ID to check its current status.
     */
    static async getPayment(paymentId: string) {
        if (!zendfi) {
            throw new Error('Payment service not configured. Set ZENDFI_API_KEY environment variable.');
        }
        return (zendfi as any).getPayment(paymentId);
    }

    /**
     * Verify a ZendFi webhook signature.
     *
     * Header format:  x-zendfi-signature: t={timestamp},v1={signature}
     * Algorithm:      HMAC-SHA256( "{timestamp}.{rawBody}", webhookSecret )
     * Replay window:  reject signatures older than 5 minutes
     */
    static verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
        if (!ZENDFI_WEBHOOK_SECRET) return false;

        const parts = signatureHeader.split(',');
        const tPart = parts.find(p => p.startsWith('t='));
        const v1Part = parts.find(p => p.startsWith('v1='));

        if (!tPart || !v1Part) return false;

        const timestamp = tPart.slice(2);
        const signature = v1Part.slice(3);

        // Reject signatures older than 5 minutes
        const ts = parseInt(timestamp, 10);
        if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

        const payload = `${timestamp}.${rawBody}`;
        const expected = crypto
            .createHmac('sha256', ZENDFI_WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');

        return expected === signature;
    }
}
