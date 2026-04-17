import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { PayoutController } from '../controllers/payout.controller';

const router = Router();

// All payout endpoints require authentication
router.use(authenticate);

// ─── Payout account ───────────────────────────────────────────────────────────
// GET    /payouts/account          → retrieve saved account (masked)
// POST   /payouts/account          → register / update bank account
// POST   /payouts/account/verify   → confirm bank name after frontend verification

router.get('/account', PayoutController.getAccount);
router.post('/account', PayoutController.registerAccount);
router.post('/account/verify', PayoutController.verifyAccount);

// ─── Balance enquiry ─────────────────────────────────────────────────────────
// GET    /payouts/balance?eventId=  → available payout balance

router.get('/balance', PayoutController.getBalance);

// ─── Payout requests ─────────────────────────────────────────────────────────
// GET    /payouts               → list own payout history
// POST   /payouts               → submit new payout request
// DELETE /payouts/:payoutId     → cancel a PENDING request

router.get('/', PayoutController.getMyPayouts);
router.post('/', PayoutController.requestPayout);
router.delete('/:payoutId', PayoutController.cancelPayout);

export default router;
