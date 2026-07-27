import { z } from 'zod';

export const addAttendeeSchema = z.object({
    ticketTypeId: z.string().uuid('Invalid ticket type ID'),
    name: z.string().min(1, 'Name is required').max(100),
    email: z.string().email('Invalid email address'),
    phone: z.string().optional(),
});
