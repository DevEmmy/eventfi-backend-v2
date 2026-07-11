import crypto from 'crypto';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

if (!PAYSTACK_SECRET_KEY) {
    console.warn('WARNING: PAYSTACK_SECRET_KEY is not set. Payment features will be unavailable.');
}

export interface CustomerObject {
    email: string;
    name?: string;
    phone?: string;
}

export interface PaymentInitResult {
    paymentUrl: string;
    reference: string;
}

export interface PaymentVerifyResult {
    status: 'success' | 'failed' | 'abandoned';
    reference: string;
    amount: number;
    currency: string;
}

export class PaymentService {
    /**
     * Initialize a Paystack transaction and return the hosted checkout URL.
     * Amount is in NGN; Paystack expects kobo (NGN × 100).
     */
    static async initializeTransaction(
        amount: number,
        _currency: string,
        description: string,
        customer: CustomerObject,
        metadata?: Record<string, any>,
        callbackUrl?: string
    ): Promise<PaymentInitResult> {
        if (!PAYSTACK_SECRET_KEY) {
            throw new Error('Payment service not configured. Set PAYSTACK_SECRET_KEY environment variable.');
        }

        const payload: Record<string, any> = {
            email: customer.email,
            amount: Math.round(amount * 100), // NGN → kobo
            currency: 'NGN',
            metadata: {
                ...metadata,
                customer_name: customer.name,
                customer_phone: customer.phone,
                description,
            },
        };

        if (callbackUrl) payload.callback_url = callbackUrl;

        console.log('[Paystack] initialize payload:', JSON.stringify(payload, null, 2));

        const response = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json() as any;
        console.log('[Paystack] initialize response:', JSON.stringify(data, null, 2));

        if (!data.status || !data.data?.authorization_url) {
            throw new Error(data.message || 'Paystack did not return a payment URL');
        }

        return {
            paymentUrl: data.data.authorization_url,
            reference: data.data.reference,
        };
    }

    /**
     * Verify a Paystack transaction by reference.
     */
    static async verifyTransaction(reference: string): Promise<PaymentVerifyResult> {
        if (!PAYSTACK_SECRET_KEY) {
            throw new Error('Payment service not configured. Set PAYSTACK_SECRET_KEY environment variable.');
        }

        const response = await fetch(
            `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
            {
                headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
            }
        );

        const data = await response.json() as any;

        if (!data.status) {
            throw new Error(data.message || 'Failed to verify transaction');
        }

        const tx = data.data;
        return {
            status: tx.status === 'success' ? 'success' : tx.status === 'abandoned' ? 'abandoned' : 'failed',
            reference: tx.reference,
            amount: tx.amount / 100, // kobo → NGN
            currency: tx.currency,
        };
    }

    /**
     * Refund a previously-settled Paystack transaction (fully or partially).
     * Paystack processes refunds asynchronously — a 'status' of 'pending' or
     * 'processing' just means the request was accepted, not that funds moved yet.
     */
    static async refundTransaction(reference: string, amount: number): Promise<{ status: string }> {
        if (!PAYSTACK_SECRET_KEY) {
            throw new Error('Payment service not configured. Set PAYSTACK_SECRET_KEY environment variable.');
        }

        const response = await fetch('https://api.paystack.co/refund', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                transaction: reference,
                amount: Math.round(amount * 100), // NGN → kobo
            }),
        });

        const data = await response.json() as any;

        if (!data.status) {
            throw new Error(data.message || 'Failed to initiate refund');
        }

        return { status: data.data?.status ?? 'pending' };
    }

    /**
     * Verify a Paystack webhook signature.
     * Algorithm: HMAC-SHA512(rawBody, PAYSTACK_SECRET_KEY)
     * Header:    x-paystack-signature: {hex_digest}
     */
    static verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
        if (!PAYSTACK_SECRET_KEY) return false;

        const hash = crypto
            .createHmac('sha512', PAYSTACK_SECRET_KEY)
            .update(rawBody)
            .digest('hex');

        return hash === signatureHeader;
    }
}
