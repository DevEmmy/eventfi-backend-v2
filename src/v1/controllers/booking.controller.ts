import { Request, Response } from 'express';
import { BookingService } from '../services/booking.service';
import { PaymentService } from '../services/payment.service';

export class BookingController {
    /**
     * POST /bookings/initiate - Create new booking order
     */
    static async initiateOrder(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const { eventId, items, guestEmail } = req.body;

            if (!eventId || !items || !items.length) {
                return res.status(400).json({
                    status: 'error',
                    message: 'eventId and items are required',
                });
            }

            if (!userId && !guestEmail) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Please provide your email to book as a guest',
                });
            }

            const order = await BookingService.initiateOrder(userId, eventId, items, guestEmail);

            return res.status(201).json({
                status: 'success',
                data: order,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Not enough') || error.message.includes('Maximum') ? 400 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to create order',
            });
        }
    }

    /**
     * GET /bookings/:orderId - Get order details
     */
    static async getOrder(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const { orderId } = req.params;

            const order = await BookingService.getOrder(orderId, userId);

            return res.status(200).json({
                status: 'success',
                data: order,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to fetch order',
            });
        }
    }

    /**
     * PATCH /bookings/:orderId/attendees - Update attendee info
     */
    static async updateAttendees(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const { orderId } = req.params;
            const { attendees } = req.body;

            const order = await BookingService.updateAttendees(orderId, userId, attendees);

            return res.status(200).json({
                status: 'success',
                data: order,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to update attendees',
            });
        }
    }

    /**
     * POST /bookings/:orderId/promo - Apply promo code
     */
    static async applyPromoCode(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const { orderId } = req.params;
            const { promoCode } = req.body;

            const order = await BookingService.applyPromoCode(orderId, userId, promoCode);

            return res.status(200).json({
                status: 'success',
                data: order,
            });
        } catch (error: any) {
            return res.status(400).json({
                status: 'error',
                message: error.message || 'Failed to apply promo code',
            });
        }
    }

    /**
     * DELETE /bookings/:orderId - Cancel pending order
     */
    static async cancelOrder(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const { orderId } = req.params;

            const result = await BookingService.cancelOrder(orderId, userId);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Cannot cancel') ? 400 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to cancel order',
            });
        }
    }

    /**
     * POST /bookings/:orderId/pay - Initialize payment
     */
    static async initializePayment(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const { orderId } = req.params;
            const { paymentMethod, callbackUrl } = req.body;

            const result = await BookingService.initializePayment(orderId, userId, paymentMethod, callbackUrl);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            const message = error.message ?? error?.response?.data?.message ?? 'Failed to initialize payment';
            console.error('[initializePayment] error:', message, error);
            const statusCode = message.includes('not found') ? 404 :
                message.includes('free') ? 400 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message,
            });
        }
    }

    /**
     * POST /bookings/:orderId/confirm - Confirm order (free tickets)
     */
    static async confirmOrder(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const { orderId } = req.params;
            const { attendees } = req.body;

            const result = await BookingService.confirmOrder(orderId, userId, attendees);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Payment') ? 402 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to confirm order',
            });
        }
    }

    /**
     * POST /webhooks/payment - ZendFi payment webhook
     * Verifies HMAC-SHA256 signature before processing.
     * Header: x-zendfi-signature: t={timestamp},v1={signature}
     */
    static async paymentWebhook(req: Request, res: Response) {
        try {
            const signatureHeader = req.headers['x-zendfi-signature'] as string;
            if (!signatureHeader) {
                return res.status(401).json({ status: 'error', message: 'Missing webhook signature' });
            }

            // ZendFi requires the raw JSON body for signature verification
            const rawBody = JSON.stringify(req.body);
            const isValid = PaymentService.verifyWebhookSignature(rawBody, signatureHeader);
            if (!isValid) {
                return res.status(401).json({ status: 'error', message: 'Invalid webhook signature' });
            }

            const { event, payment } = req.body;
            const result = await BookingService.handlePaymentWebhook(event, payment);

            return res.status(200).json(result);
        } catch (error: any) {
            // Always return 200 to prevent ZendFi retry storms on internal errors
            console.error('Webhook processing error:', error.message);
            return res.status(200).json({ received: true });
        }
    }

    /**
     * GET /users/me/orders - Get user's orders
     */
    static async getUserOrders(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await BookingService.getUserOrders(userId, page, limit);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch orders',
            });
        }
    }

    /**
     * GET /users/me/tickets - Get user's tickets
     */
    static async getUserTickets(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const status = req.query.status as string;
            const upcoming = req.query.upcoming === 'true';
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await BookingService.getUserTickets(userId, status, upcoming, page, limit);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch tickets',
            });
        }
    }

    /**
     * GET /tickets/:ticketId - Get single ticket details
     */
    static async getTicketDetails(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            const { ticketId } = req.params;

            const ticket = await BookingService.getTicketDetails(ticketId, userId);

            return res.status(200).json({
                status: 'success',
                data: ticket,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('Unauthorized') ? 403 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to fetch ticket',
            });
        }
    }
}
