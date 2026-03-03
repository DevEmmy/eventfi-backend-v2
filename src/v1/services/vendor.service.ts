import { prisma } from '../config/database';
import { VendorCategory, VendorAvailability, VendorBookingStatus } from '@prisma/client';

interface CreateVendorData {
    userId: string;
    name: string;
    category: VendorCategory;
    description: string;
    logo?: string;
    coverImage?: string;
    portfolio?: string[];
    specialties?: string[];
    location: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    priceMin?: number;
    priceMax?: number;
    yearsOfExperience?: number;
    availability?: VendorAvailability;
}

interface UpdateVendorData {
    name?: string;
    category?: VendorCategory;
    description?: string;
    logo?: string;
    coverImage?: string;
    portfolio?: string[];
    specialties?: string[];
    location?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    priceMin?: number;
    priceMax?: number;
    yearsOfExperience?: number;
    availability?: VendorAvailability;
}

interface VendorQueryParams {
    page?: number;
    limit?: number;
    search?: string;
    category?: VendorCategory;
    location?: string;
    minRating?: number;
    availability?: VendorAvailability;
}

interface CreateBookingData {
    vendorId: string;
    userId: string;
    eventName: string;
    eventDate: Date;
    eventTime: string;
    eventLocation: string;
    eventType: string;
    guestCount?: number;
    duration?: string;
    contactName: string;
    contactEmail: string;
    contactPhone: string;
    specialRequests?: string;
    estimatedPrice?: number;
}

export class VendorService {
    /**
     * Create a vendor profile
     */
    static async create(data: CreateVendorData) {
        // Check if user already has a vendor profile
        const existing = await prisma.vendor.findUnique({
            where: { userId: data.userId },
        });
        if (existing) throw new Error('You already have a vendor profile');

        const vendor = await prisma.vendor.create({
            data: {
                userId: data.userId,
                name: data.name,
                category: data.category,
                description: data.description,
                logo: data.logo,
                coverImage: data.coverImage,
                portfolio: data.portfolio || [],
                specialties: data.specialties || [],
                location: data.location,
                address: data.address,
                phone: data.phone,
                email: data.email,
                website: data.website,
                priceMin: data.priceMin,
                priceMax: data.priceMax,
                yearsOfExperience: data.yearsOfExperience || 0,
                availability: data.availability || 'AVAILABLE',
            },
            include: {
                user: { select: { id: true, displayName: true, avatar: true, isVerified: true } },
            },
        });

        // Add vendor role to user if not present
        const user = await prisma.user.findUnique({ where: { id: data.userId }, select: { roles: true } });
        if (user && !user.roles.includes('vendor')) {
            await prisma.user.update({
                where: { id: data.userId },
                data: { roles: { push: 'vendor' } },
            });
        }

        return vendor;
    }

    /**
     * Update a vendor profile
     */
    static async update(vendorId: string, userId: string, data: UpdateVendorData) {
        const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
        if (!vendor) throw new Error('Vendor not found');
        if (vendor.userId !== userId) throw new Error('Unauthorized');

        return prisma.vendor.update({
            where: { id: vendorId },
            data,
            include: {
                user: { select: { id: true, displayName: true, avatar: true, isVerified: true } },
            },
        });
    }

    /**
     * Get a vendor by ID
     */
    static async getById(vendorId: string) {
        const vendor = await prisma.vendor.findUnique({
            where: { id: vendorId },
            include: {
                user: { select: { id: true, displayName: true, avatar: true, isVerified: true } },
                reviews: {
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                },
            },
        });

        if (!vendor) throw new Error('Vendor not found');
        return vendor;
    }

    /**
     * Get vendor by user ID
     */
    static async getByUserId(userId: string) {
        return prisma.vendor.findUnique({
            where: { userId },
            include: {
                user: { select: { id: true, displayName: true, avatar: true, isVerified: true } },
            },
        });
    }

    /**
     * List vendors with filtering and pagination
     */
    static async list(params: VendorQueryParams) {
        const { page = 1, limit = 12, search, category, location, minRating, availability } = params;
        const skip = (page - 1) * limit;

        const where: any = {};

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                { specialties: { has: search } },
            ];
        }
        if (category) where.category = category;
        if (location) where.location = { contains: location, mode: 'insensitive' };
        if (minRating) where.averageRating = { gte: minRating };
        if (availability) where.availability = availability;

        const [total, vendors] = await prisma.$transaction([
            prisma.vendor.count({ where }),
            prisma.vendor.findMany({
                where,
                skip,
                take: limit,
                orderBy: [{ averageRating: 'desc' }, { reviewCount: 'desc' }],
                include: {
                    user: { select: { id: true, displayName: true, avatar: true, isVerified: true } },
                },
            }),
        ]);

        return {
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
            data: vendors,
        };
    }

    /**
     * Delete a vendor profile
     */
    static async delete(vendorId: string, userId: string) {
        const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
        if (!vendor) throw new Error('Vendor not found');
        if (vendor.userId !== userId) throw new Error('Unauthorized');

        await prisma.vendor.delete({ where: { id: vendorId } });

        // Remove vendor role from user
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { roles: true } });
        if (user) {
            await prisma.user.update({
                where: { id: userId },
                data: { roles: { set: user.roles.filter(r => r !== 'vendor') } },
            });
        }

        return { message: 'Vendor profile deleted' };
    }

    // ============ REVIEWS ============

    /**
     * Get reviews for a vendor
     */
    static async getReviews(vendorId: string, page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;

        const [total, reviews] = await prisma.$transaction([
            prisma.vendorReview.count({ where: { vendorId } }),
            prisma.vendorReview.findMany({
                where: { vendorId },
                skip,
                take: limit,
                orderBy: { createdAt: 'desc' },
            }),
        ]);

        return {
            meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
            data: reviews,
        };
    }

    /**
     * Create a review for a vendor
     */
    static async createReview(vendorId: string, userId: string, rating: number, comment: string, photos: string[] = []) {
        const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
        if (!vendor) throw new Error('Vendor not found');
        if (vendor.userId === userId) throw new Error('You cannot review your own vendor profile');

        const review = await prisma.vendorReview.create({
            data: { vendorId, userId, rating, comment, photos },
        });

        // Update vendor's average rating
        const stats = await prisma.vendorReview.aggregate({
            where: { vendorId },
            _avg: { rating: true },
            _count: { rating: true },
        });

        await prisma.vendor.update({
            where: { id: vendorId },
            data: {
                averageRating: Math.round((stats._avg.rating || 0) * 10) / 10,
                reviewCount: stats._count.rating,
            },
        });

        return review;
    }

    // ============ BOOKINGS ============

    /**
     * Create a booking request for a vendor
     */
    static async createBooking(data: CreateBookingData) {
        const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
        if (!vendor) throw new Error('Vendor not found');

        const booking = await prisma.vendorBooking.create({
            data: {
                vendorId: data.vendorId,
                userId: data.userId,
                eventName: data.eventName,
                eventDate: data.eventDate,
                eventTime: data.eventTime,
                eventLocation: data.eventLocation,
                eventType: data.eventType,
                guestCount: data.guestCount || 0,
                duration: data.duration,
                contactName: data.contactName,
                contactEmail: data.contactEmail,
                contactPhone: data.contactPhone,
                specialRequests: data.specialRequests,
                estimatedPrice: data.estimatedPrice,
            },
        });

        return booking;
    }

    /**
     * Get bookings for a vendor (vendor owner view)
     */
    static async getVendorBookings(vendorId: string, userId: string, status?: VendorBookingStatus) {
        const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
        if (!vendor) throw new Error('Vendor not found');
        if (vendor.userId !== userId) throw new Error('Unauthorized');

        const where: any = { vendorId };
        if (status) where.status = status;

        return prisma.vendorBooking.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Get bookings made by a user (requester view)
     */
    static async getUserBookings(userId: string) {
        return prisma.vendorBooking.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            include: {
                vendor: { select: { id: true, name: true, category: true, logo: true } },
            },
        });
    }

    /**
     * Update booking status (accept/decline)
     */
    static async updateBookingStatus(bookingId: string, userId: string, status: VendorBookingStatus, declineReason?: string) {
        const booking = await prisma.vendorBooking.findUnique({
            where: { id: bookingId },
            include: { vendor: true },
        });

        if (!booking) throw new Error('Booking not found');
        if (booking.vendor.userId !== userId) throw new Error('Unauthorized');

        const updated = await prisma.vendorBooking.update({
            where: { id: bookingId },
            data: {
                status,
                ...(declineReason && { declineReason }),
            },
        });

        // Update vendor booking count if accepted
        if (status === 'ACCEPTED') {
            await prisma.vendor.update({
                where: { id: booking.vendorId },
                data: { bookingCount: { increment: 1 } },
            });
        }

        return updated;
    }
}
