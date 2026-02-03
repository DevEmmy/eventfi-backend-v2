import { Request, Response } from 'express';
import { BookingService } from '../services/booking.service';

export class BookingController {
    /**
     * POST /bookings/initiate - Create new booking order
     */
    static async initiateOrder(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { eventId, items } = req.body;

            if (!eventId || !items || !items.length) {
                return res.status(400).json({
                    status: 'error',
                    message: 'eventId and items are required',
                });
            }

            const order = await BookingService.initiateOrder(userId, eventId, items);

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
            const userId = (req as any).user.id;
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
            const userId = (req as any).user.id;
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
            const userId = (req as any).user.id;
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
            const userId = (req as any).user.id;
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
            const userId = (req as any).user.id;
            const { orderId } = req.params;
            const { paymentMethod, callbackUrl } = req.body;

            const result = await BookingService.initializePayment(orderId, userId, paymentMethod, callbackUrl);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('free') ? 400 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to initialize payment',
            });
        }
    }

    /**
     * POST /bookings/:orderId/confirm - Confirm order (free tickets)
     */
    static async confirmOrder(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
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
     * POST /webhooks/payment - Payment gateway webhook
     */
    static async paymentWebhook(req: Request, res: Response) {
        try {
            // TODO: Verify webhook signature from payment provider
            const { reference, status } = req.body;

            const result = await BookingService.handlePaymentWebhook(reference, status);

            return res.status(200).json(result);
        } catch (error: any) {
            return res.status(400).json({
                status: 'error',
                message: error.message || 'Webhook processing failed',
            });
        }
    }

    /**
     * GET /users/me/orders - Get user's orders
     */
    static async getUserOrders(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
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
            const userId = (req as any).user.id;
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
            const userId = (req as any).user.id;
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
