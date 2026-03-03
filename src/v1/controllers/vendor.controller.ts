import { Request, Response } from 'express';
import { VendorService } from '../services/vendor.service';

export class VendorController {
    /**
     * POST /vendors - Create vendor profile
     */
    static async create(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const vendor = await VendorService.create({ ...req.body, userId });

            return res.status(201).json({
                status: 'success',
                data: vendor,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('already') ? 409 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to create vendor profile',
            });
        }
    }

    /**
     * PATCH /vendors/:id - Update vendor profile
     */
    static async update(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { id } = req.params;
            const vendor = await VendorService.update(id, userId, req.body);

            return res.status(200).json({
                status: 'success',
                data: vendor,
            });
        } catch (error: any) {
            const statusCode = error.message === 'Unauthorized' ? 403 :
                error.message.includes('not found') ? 404 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to update vendor',
            });
        }
    }

    /**
     * GET /vendors - List vendors
     */
    static async list(req: Request, res: Response) {
        try {
            const params = {
                page: parseInt(req.query.page as string) || 1,
                limit: parseInt(req.query.limit as string) || 12,
                search: req.query.search as string,
                category: req.query.category as any,
                location: req.query.location as string,
                minRating: req.query.minRating ? parseFloat(req.query.minRating as string) : undefined,
                availability: req.query.availability as any,
            };

            const result = await VendorService.list(params);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch vendors',
            });
        }
    }

    /**
     * GET /vendors/me - Get current user's vendor profile
     */
    static async getMyProfile(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const vendor = await VendorService.getByUserId(userId);

            if (!vendor) {
                return res.status(404).json({
                    status: 'error',
                    message: 'No vendor profile found',
                });
            }

            return res.status(200).json({
                status: 'success',
                data: vendor,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch vendor profile',
            });
        }
    }

    /**
     * GET /vendors/:id - Get vendor by ID
     */
    static async getById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const vendor = await VendorService.getById(id);

            return res.status(200).json({
                status: 'success',
                data: vendor,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to fetch vendor',
            });
        }
    }

    /**
     * DELETE /vendors/:id - Delete vendor profile
     */
    static async delete(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { id } = req.params;
            const result = await VendorService.delete(id, userId);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            const statusCode = error.message === 'Unauthorized' ? 403 :
                error.message.includes('not found') ? 404 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to delete vendor',
            });
        }
    }

    // ============ REVIEWS ============

    /**
     * GET /vendors/:id/reviews - Get vendor reviews
     */
    static async getReviews(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 10;

            const result = await VendorService.getReviews(id, page, limit);

            return res.status(200).json({
                status: 'success',
                data: result,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch reviews',
            });
        }
    }

    /**
     * POST /vendors/:id/reviews - Create vendor review
     */
    static async createReview(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { id } = req.params;
            const { rating, comment, photos } = req.body;

            const review = await VendorService.createReview(id, userId, rating, comment, photos);

            return res.status(201).json({
                status: 'success',
                data: review,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 :
                error.message.includes('cannot review') ? 400 :
                error.message.includes('Unique constraint') ? 409 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to create review',
            });
        }
    }

    // ============ BOOKINGS ============

    /**
     * POST /vendors/:id/bookings - Create booking request
     */
    static async createBooking(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { id } = req.params;

            const booking = await VendorService.createBooking({
                ...req.body,
                vendorId: id,
                userId,
                eventDate: new Date(req.body.eventDate),
            });

            return res.status(201).json({
                status: 'success',
                data: booking,
            });
        } catch (error: any) {
            const statusCode = error.message.includes('not found') ? 404 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to create booking',
            });
        }
    }

    /**
     * GET /vendors/:id/bookings - Get bookings for a vendor (vendor owner)
     */
    static async getVendorBookings(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { id } = req.params;
            const status = req.query.status as any;

            const bookings = await VendorService.getVendorBookings(id, userId, status);

            return res.status(200).json({
                status: 'success',
                data: bookings,
            });
        } catch (error: any) {
            const statusCode = error.message === 'Unauthorized' ? 403 :
                error.message.includes('not found') ? 404 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to fetch bookings',
            });
        }
    }

    /**
     * GET /vendors/me/bookings - Get bookings made by current user
     */
    static async getMyBookings(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const bookings = await VendorService.getUserBookings(userId);

            return res.status(200).json({
                status: 'success',
                data: bookings,
            });
        } catch (error: any) {
            return res.status(500).json({
                status: 'error',
                message: error.message || 'Failed to fetch bookings',
            });
        }
    }

    /**
     * PATCH /vendors/bookings/:bookingId/status - Update booking status
     */
    static async updateBookingStatus(req: Request, res: Response) {
        try {
            const userId = (req as any).user.id;
            const { bookingId } = req.params;
            const { status, declineReason } = req.body;

            const booking = await VendorService.updateBookingStatus(bookingId, userId, status, declineReason);

            return res.status(200).json({
                status: 'success',
                data: booking,
            });
        } catch (error: any) {
            const statusCode = error.message === 'Unauthorized' ? 403 :
                error.message.includes('not found') ? 404 : 500;
            return res.status(statusCode).json({
                status: 'error',
                message: error.message || 'Failed to update booking',
            });
        }
    }
}
