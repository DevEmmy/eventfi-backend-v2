import { prisma } from '../config/database';

export class ReviewService {
    static async getReviews(eventId: string, page: number = 1, limit: number = 10) {
        const skip = (page - 1) * limit;

        const [total, reviews] = await prisma.$transaction([
            prisma.review.count({ where: { eventId } }),
            prisma.review.findMany({
                where: { eventId },
                include: {
                    user: {
                        select: {
                            id: true,
                            displayName: true,
                            avatar: true,
                        }
                    }
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            })
        ]);

        return {
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
            data: reviews.map(r => ({
                id: r.id,
                eventId: r.eventId,
                userId: r.userId,
                userName: r.user.displayName || 'Anonymous',
                userAvatar: r.user.avatar,
                rating: r.rating,
                title: r.title,
                comment: r.comment,
                createdAt: r.createdAt.toISOString(),
                helpfulCount: r.helpfulCount,
                photos: r.photos,
            }))
        };
    }

    static async getStats(eventId: string) {
        const reviews = await prisma.review.findMany({
            where: { eventId },
            select: { rating: true }
        });

        const totalReviews = reviews.length;
        if (totalReviews === 0) {
            return {
                averageRating: 0,
                totalReviews: 0,
                ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
            };
        }

        const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
        const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        reviews.forEach(r => {
            if (r.rating >= 1 && r.rating <= 5) {
                distribution[r.rating as 1 | 2 | 3 | 4 | 5]++;
            }
        });

        return {
            averageRating: parseFloat((sum / totalReviews).toFixed(1)),
            totalReviews,
            ratingDistribution: distribution
        };
    }

    static async createReview(eventId: string, userId: string, data: { rating: number; title?: string; comment: string; photos?: string[] }) {
        // Check if user already reviewed
        const existing = await prisma.review.findFirst({
            where: { eventId, userId }
        });
        if (existing) {
            throw new Error('You have already reviewed this event');
        }

        const review = await prisma.review.create({
            data: {
                eventId,
                userId,
                rating: data.rating,
                title: data.title,
                comment: data.comment,
                photos: data.photos || [],
            },
            include: {
                user: {
                    select: {
                        displayName: true,
                        avatar: true,
                    }
                }
            }
        });

        return {
            id: review.id,
            eventId: review.eventId,
            userId: review.userId,
            userName: review.user.displayName || 'Anonymous',
            userAvatar: review.user.avatar,
            rating: review.rating,
            title: review.title,
            comment: review.comment,
            createdAt: review.createdAt.toISOString(),
            helpfulCount: review.helpfulCount,
            photos: review.photos,
        };
    }
}
