import { z } from 'zod';

export const importGoogleFormsSchema = z.object({
    ticketId: z.string().uuid('Invalid ticket ID'),
    nameColumn: z.string().min(1, 'Name column is required'),
    emailColumn: z.string().min(1, 'Email column is required'),
    phoneColumn: z.string().optional(),
    cityColumn: z.string().optional(),
    locationColumn: z.string().optional(),
    skipDuplicates: z.coerce.boolean().default(true),
});

export type ImportGoogleFormsInput = z.infer<typeof importGoogleFormsSchema>;
