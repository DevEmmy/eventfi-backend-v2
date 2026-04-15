import { Router } from 'express';
import { requireAdmin } from '../middlewares/admin.middleware';
import {
    AdminAuthController,
    AdminDashboardController,
    AdminAccountsController,
    AdminEventsController,
    AdminTransactionsController,
    AdminVendorsController,
    AdminReportsController,
    AdminAIController,
} from '../controllers/admin.controller';

const router = Router();

// ─── Auth (no requireAdmin) ───────────────────────────────────────────────────
router.post('/auth/login', AdminAuthController.login);
router.get('/auth/me', requireAdmin, AdminAuthController.me);

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get('/dashboard/stats', requireAdmin, AdminDashboardController.getStats);
router.get('/dashboard/revenue-chart', requireAdmin, AdminDashboardController.getRevenueChart);
router.get('/dashboard/top-events', requireAdmin, AdminDashboardController.getTopEvents);
router.get('/dashboard/registrations-chart', requireAdmin, AdminDashboardController.getRegistrationsChart);

// ─── Accounts ────────────────────────────────────────────────────────────────
router.get('/accounts', requireAdmin, AdminAccountsController.list);
router.get('/accounts/:userId', requireAdmin, AdminAccountsController.getOne);
router.patch('/accounts/:userId/suspend', requireAdmin, AdminAccountsController.suspend);
router.patch('/accounts/:userId/activate', requireAdmin, AdminAccountsController.activate);
router.delete('/accounts/:userId', requireAdmin, AdminAccountsController.remove);

// ─── Events ──────────────────────────────────────────────────────────────────
router.get('/events', requireAdmin, AdminEventsController.list);
router.get('/events/:eventId', requireAdmin, AdminEventsController.getOne);
router.patch('/events/:eventId/status', requireAdmin, AdminEventsController.updateStatus);
router.patch('/events/:eventId/featured', requireAdmin, AdminEventsController.toggleFeatured);
router.delete('/events/:eventId', requireAdmin, AdminEventsController.remove);

// ─── Transactions ─────────────────────────────────────────────────────────────
router.get('/transactions', requireAdmin, AdminTransactionsController.list);
router.get('/transactions/stats', requireAdmin, AdminTransactionsController.stats);
router.get('/transactions/:txnId', requireAdmin, AdminTransactionsController.getOne);
router.post('/transactions/:txnId/refund', requireAdmin, AdminTransactionsController.refund);

// ─── Vendors ─────────────────────────────────────────────────────────────────
router.get('/vendors', requireAdmin, AdminVendorsController.list);
router.patch('/vendors/:vendorId/verified', requireAdmin, AdminVendorsController.setVerified);
router.delete('/vendors/:vendorId', requireAdmin, AdminVendorsController.remove);

// ─── Reports ─────────────────────────────────────────────────────────────────
router.get('/reports/revenue', requireAdmin, AdminReportsController.revenue);
router.get('/reports/attendance', requireAdmin, AdminReportsController.attendance);
router.get('/reports/organizers', requireAdmin, AdminReportsController.organizers);
router.get('/reports/export', requireAdmin, AdminReportsController.exportCSV);

// ─── AI / Insights ───────────────────────────────────────────────────────────
router.get('/ai/insights', requireAdmin, AdminAIController.getInsights);
router.get('/ai/forecast', requireAdmin, AdminAIController.getForecast);

export default router;
