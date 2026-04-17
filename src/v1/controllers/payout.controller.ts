import { Response } from 'express';
import { AuthRequest } from '../middlewares/auth.middleware';
import { PayoutService } from '../services/payout.service';

export class PayoutController {
    // ─── Payout account ───────────────────────────────────────────────────────

    static async getAccount(req: AuthRequest, res: Response) {
        try {
            const account = await PayoutService.getAccount(req.user.id);
            if (!account) return res.status(404).json({ status: 'error', message: 'No payout account found' });
            res.json({ status: 'success', data: account });
        } catch (e: any) {
            res.status(400).json({ status: 'error', message: e.message });
        }
    }

    static async registerAccount(req: AuthRequest, res: Response) {
        try {
            const { bankName, bankCode, accountNumber, accountName } = req.body;
            if (!bankName || !bankCode || !accountNumber || !accountName) {
                return res.status(400).json({
                    status: 'error',
                    message: 'bankName, bankCode, accountNumber, and accountName are all required.',
                });
            }
            // Basic format check: Nigerian account numbers are 10 digits
            if (!/^\d{10}$/.test(accountNumber)) {
                return res.status(400).json({
                    status: 'error',
                    message: 'accountNumber must be exactly 10 digits.',
                });
            }
            const account = await PayoutService.registerAccount(req.user.id, {
                bankName,
                bankCode,
                accountNumber,
                accountName,
            });
            res.status(201).json({ status: 'success', data: account });
        } catch (e: any) {
            res.status(400).json({ status: 'error', message: e.message });
        }
    }

    /**
     * Called after the frontend has confirmed the bank account name via Paystack's
     * Resolve Account API.  The frontend passes back the verified name; this endpoint
     * cross-checks it against the stored accountName and marks the account verified.
     */
    static async verifyAccount(req: AuthRequest, res: Response) {
        try {
            const { verifiedName } = req.body;
            if (!verifiedName?.trim()) {
                return res.status(400).json({ status: 'error', message: 'verifiedName is required.' });
            }
            const account = await PayoutService.verifyAccount(req.user.id, verifiedName);
            res.json({ status: 'success', data: account });
        } catch (e: any) {
            res.status(400).json({ status: 'error', message: e.message });
        }
    }

    // ─── Balance ──────────────────────────────────────────────────────────────

    static async getBalance(req: AuthRequest, res: Response) {
        try {
            const { eventId } = req.query as { eventId?: string };
            const balance = await PayoutService.getBalance(req.user.id, eventId);
            res.json({ status: 'success', data: balance });
        } catch (e: any) {
            const status = e.message === 'Unauthorized' ? 403 : 400;
            res.status(status).json({ status: 'error', message: e.message });
        }
    }

    // ─── Payout requests ──────────────────────────────────────────────────────

    static async requestPayout(req: AuthRequest, res: Response) {
        try {
            const { eventId } = req.body;
            if (!eventId) {
                return res.status(400).json({ status: 'error', message: 'eventId is required.' });
            }
            const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                ?? req.socket.remoteAddress;
            const payout = await PayoutService.requestPayout(req.user.id, eventId, ip);
            res.status(201).json({ status: 'success', data: payout });
        } catch (e: any) {
            res.status(400).json({ status: 'error', message: e.message });
        }
    }

    static async cancelPayout(req: AuthRequest, res: Response) {
        try {
            const payout = await PayoutService.cancelPayout(req.params.payoutId, req.user.id);
            res.json({ status: 'success', data: payout });
        } catch (e: any) {
            const status = e.message === 'Unauthorized' ? 403 : 400;
            res.status(status).json({ status: 'error', message: e.message });
        }
    }

    static async getMyPayouts(req: AuthRequest, res: Response) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
            const result = await PayoutService.getMyPayouts(req.user.id, page, limit);
            res.json({ status: 'success', ...result });
        } catch (e: any) {
            res.status(400).json({ status: 'error', message: e.message });
        }
    }
}

// ─── Admin controller ─────────────────────────────────────────────────────────

export class AdminPayoutController {
    static async list(req: AuthRequest, res: Response) {
        try {
            const { status } = req.query as { status?: string };
            const page = parseInt(req.query.page as string) || 1;
            const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
            const result = await PayoutService.adminListPayouts(status, page, limit);
            res.json({ status: 'success', ...result });
        } catch (e: any) {
            res.status(400).json({ status: 'error', message: e.message });
        }
    }

    static async approve(req: AuthRequest, res: Response) {
        try {
            const { note } = req.body;
            const payout = await PayoutService.adminApprovePayout(
                req.params.payoutId,
                req.user.id,
                note
            );
            res.json({ status: 'success', data: payout });
        } catch (e: any) {
            res.status(400).json({ status: 'error', message: e.message });
        }
    }

    static async reject(req: AuthRequest, res: Response) {
        try {
            const { reason } = req.body;
            const payout = await PayoutService.adminRejectPayout(
                req.params.payoutId,
                req.user.id,
                reason
            );
            res.json({ status: 'success', data: payout });
        } catch (e: any) {
            res.status(400).json({ status: 'error', message: e.message });
        }
    }

    static async complete(req: AuthRequest, res: Response) {
        try {
            const { paymentReference } = req.body;
            const payout = await PayoutService.adminCompletePayout(
                req.params.payoutId,
                req.user.id,
                paymentReference
            );
            res.json({ status: 'success', data: payout });
        } catch (e: any) {
            res.status(400).json({ status: 'error', message: e.message });
        }
    }
}
