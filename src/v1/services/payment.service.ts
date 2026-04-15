import { ZendFiClient, type Currency, type PaymentToken } from '@zendfi/sdk';
import crypto from 'crypto';

export interface CustomerObject {
    email: string;
    name?: string;
    phone?: string;
}

const ZENDFI_API_KEY = process.env.ZENDFI_API_KEY;
const ZENDFI_WEBHOOK_SECRET = process.env.ZENDFI_WEBHOOK_SECRET;

if (!ZENDFI_API_KEY) {
    console.warn('WARNING: ZENDFI_API_KEY is not set. Payment features will be unavailable.');
}

const zendfi = ZENDFI_API_KEY ? new ZendFiClient({ apiKey: ZENDFI_API_KEY }) : null;

/**
 * Convert an amount from a source currency to USD using live rates.
 * Falls back to a hardcoded NGN rate if the fetch fails.
 */
async function toUSD(amount: number, fromCurrency: string): Promise<number> {
    if (fromCurrency === 'USD') return amount;

    try {
        const res = await fetch(`https://open.er-api.com/v6/latest/USD`);
        const data = await res.json() as { rates: Record<string, number> };
        const rate = data.rates[fromCurrency];
        if (!rate) throw new Error(`No rate found for ${fromCurrency}`);
        const usdAmount = parseFloat((amount / rate).toFixed(2));
        console.log(`[ZendFi] Converted ${amount} ${fromCurrency} → $${usdAmount} USD (rate: ${rate})`);
        return usdAmount;
    } catch (err) {
        console.error('[ZendFi] Exchange rate fetch failed, using fallback NGN rate:', err);
        // Fallback: approximate NGN/USD rate — update periodically or wire up a paid FX API
        const fallbackNGNRate = 1600;
        return parseFloat((amount / fallbackNGNRate).toFixed(2));
    }
}

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
        customer: CustomerObject,
        metadata?: Record<string, any>
    ): Promise<PaymentInitResult> {
        if (!zendfi) {
            throw new Error('Payment service not configured. Set ZENDFI_API_KEY environment variable.');
        }

        // Convert NGN (or any unsupported currency) to USD for the `amount` field
        const usdAmount = await toUSD(amount, currency);

        const payload = {
            amount: usdAmount,
            currency: 'USD' as Currency,
            token: 'USDC' as PaymentToken,
            description,
            onramp: true,         // enable NGN fiat on-ramp
            amount_ngn: amount,   // original NGN amount shown to the customer
            customer,             // pre-fills checkout — skips info collection step
            metadata,
        };
        console.log('[ZendFi] createPayment payload:', JSON.stringify(payload, null, 2));

        const payment = await (zendfi as any).createPayment(payload);

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
