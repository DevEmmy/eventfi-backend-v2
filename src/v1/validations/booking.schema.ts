import { z } from 'zod';

export const initiateBookingSchema = z.object({
    eventId: z.string().uuid('Invalid event ID'),
    items: z.array(z.object({
        ticketTypeId: z.string().uuid('Invalid ticket type ID'),
        quantity: z.number().int().min(1, 'Quantity must be at least 1').max(50, 'Maximum 50 tickets per item'),
    })).min(1, 'At least one item is required'),
    guestEmail: z.string().email('Invalid guest email').optional(),
});

export const updateAttendeesSchema = z.object({
    attendees: z.array(z.object({
        ticketTypeId: z.string().uuid('Invalid ticket type ID'),
        name: z.string().min(1, 'Name is required').max(100),
        email: z.string().email('Invalid email address'),
        phone: z.string().optional(),
    })).min(1, 'At least one attendee is required'),
});

export const applyPromoSchema = z.object({
    promoCode: z.string().min(1, 'Promo code is required').max(50),
});

export const initializePaymentSchema = z.object({
    paymentMethod: z.string().min(1, 'Payment method is required'),
    callbackUrl: z.string().url('Invalid callback URL'),
});

export const confirmOrderSchema = z.object({
    attendees: z.array(z.object({
        ticketTypeId: z.string().uuid('Invalid ticket type ID'),
        name: z.string().min(1, 'Name is required').max(100),
        email: z.string().email('Invalid email address'),
        phone: z.string().optional(),
    })).optional(),
});
