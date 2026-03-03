import { Paystack } from 'paystack-sdk';
import crypto from 'crypto';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

if (!PAYSTACK_SECRET_KEY) {
    console.warn('WARNING: PAYSTACK_SECRET_KEY is not set. Payment features will be unavailable.');
}

const paystack = PAYSTACK_SECRET_KEY ? new Paystack(PAYSTACK_SECRET_KEY) : null;

export interface PaymentInitResult {
    paymentUrl: string;
    reference: string;
    accessCode: string;
}

export interface PaymentVerifyResult {
    status: 'success' | 'failed' | 'abandoned';
    reference: string;
    amount: number;
    currency: string;
    paidAt?: string;
}

export class PaymentService {
    /**
     * Initialize a Paystack transaction
     */
    static async initializeTransaction(
        email: string,
        amountInKobo: number,
        reference: string,
        callbackUrl: string,
        metadata?: Record<string, any>
    ): Promise<PaymentInitResult> {
        if (!paystack) {
            throw new Error('Payment service not configured. Set PAYSTACK_SECRET_KEY environment variable.');
        }

        const response = await paystack.transaction.initialize({
            email,
            amount: String(amountInKobo),
            reference,
            callback_url: callbackUrl,
            metadata: metadata as any,
        });

        if (!response || !response.status) {
            throw new Error(response?.message || 'Failed to initialize payment');
        }

        const data = response.data as any;
        return {
            paymentUrl: data.authorization_url,
            reference: data.reference,
            accessCode: data.access_code,
        };
    }

    /**
     * Verify a Paystack transaction
     */
    static async verifyTransaction(reference: string): Promise<PaymentVerifyResult> {
        if (!paystack) {
            throw new Error('Payment service not configured. Set PAYSTACK_SECRET_KEY environment variable.');
        }

        const response = await paystack.transaction.verify(reference);

        if (!response || !response.status) {
            throw new Error(response?.message || 'Failed to verify payment');
        }

        const data = response.data as any;
        return {
            status: data.status === 'success' ? 'success' : data.status === 'abandoned' ? 'abandoned' : 'failed',
            reference: data.reference,
            amount: data.amount,
            currency: data.currency,
            paidAt: data.paid_at,
        };
    }

    /**
     * Verify Paystack webhook signature using HMAC SHA512
     */
    static verifyWebhookSignature(body: string, signature: string): boolean {
        if (!PAYSTACK_SECRET_KEY) return false;

        const hash = crypto
            .createHmac('sha512', PAYSTACK_SECRET_KEY)
            .update(body)
            .digest('hex');

        return hash === signature;
    }
}
