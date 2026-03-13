import { z } from 'zod';

const locationSchema = z.object({
    type: z.enum(['PHYSICAL', 'ONLINE', 'HYBRID']),
    address: z.string().optional(),
    venueName: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    postalCode: z.string().optional(),
    coordinates: z.object({
        lat: z.number(),
        lng: z.number(),
    }).optional(),
    onlineUrl: z.string().url().optional().or(z.literal('')),
    onlinePassword: z.string().optional(),
});

const scheduleSchema = z.object({
    startDate: z.string().min(1, 'Start date is required'),
    endDate: z.string().min(1, 'End date is required'),
    startTime: z.string().min(1, 'Start time is required'),
    endTime: z.string().min(1, 'End time is required'),
    timezone: z.string().optional(),
});

const ticketSchema = z.object({
    name: z.string().min(1, 'Ticket name is required'),
    description: z.string().optional(),
    type: z.enum(['FREE', 'PAID', 'DONATION']),
    price: z.number().min(0, 'Price cannot be negative'),
    currency: z.string().default('NGN'),
    quantity: z.number().int().min(1, 'Quantity must be at least 1'),
    maxPerUser: z.number().int().min(1).optional(),
    salesStart: z.string().optional(),
    salesEnd: z.string().optional(),
});

const mediaSchema = z.object({
    coverImage: z.string().optional().default(''),
    gallery: z.array(z.string()).optional(),
    videoUrl: z.string().url().optional().or(z.literal('')),
});

const scheduleItemSchema = z.object({
    time: z.string().min(1, 'Time is required'),
    activity: z.string().min(1, 'Activity is required'),
    description: z.string().optional(),
    order: z.number().int().optional(),
});

export const createEventSchema = z.object({
    title: z.string().min(1, 'Title is required').max(200),
    description: z.string().min(1, 'Description is required').max(5000),
    category: z.enum([
        'MUSIC', 'TECH', 'BUSINESS', 'ARTS', 'SPORTS',
        'EDUCATION', 'ENTERTAINMENT', 'COMMUNITY', 'WELLNESS', 'FOOD_DRINK', 'OTHER',
    ]),
    tags: z.array(z.string()).optional(),
    privacy: z.enum(['PUBLIC', 'PRIVATE', 'UNLISTED']).optional().default('PUBLIC'),
    location: locationSchema,
    schedule: scheduleSchema,
    tickets: z.array(ticketSchema).min(1, 'At least one ticket type is required'),
    media: mediaSchema.optional(),
    scheduleItems: z.array(scheduleItemSchema).optional(),
});

export const updateEventSchema = createEventSchema.partial();

export const reviewSchema = z.object({
    rating: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating cannot exceed 5'),
    title: z.string().max(200).optional(),
    comment: z.string().min(1, 'Comment is required').max(2000),
    photos: z.array(z.string().url()).optional(),
});
