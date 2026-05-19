import { prisma } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { ManageService } from './manage.service';
import { ImportGoogleFormsInput } from '../validations/import.schema';

const BATCH_SIZE = 50;
const MAX_ROWS = 5000;

export interface ImportRow {
    name: string;
    email: string;
    phone?: string;
    city?: string;
    location?: string;
}

export interface ImportResult {
    total: number;
    created: number;
    skipped: number;
    errors: Array<{ row: number; reason: string }>;
    headers: string[];
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

function parseCSVRow(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < line.length) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"' && line[i + 1] === '"') {
                current += '"';
                i += 2;
            } else if (ch === '"') {
                inQuotes = false;
                i++;
            } else {
                current += ch;
                i++;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
                i++;
            } else if (ch === ',') {
                fields.push(current.trim());
                current = '';
                i++;
            } else {
                current += ch;
                i++;
            }
        }
    }
    fields.push(current.trim());
    return fields;
}

function parseCSV(buffer: Buffer): string[][] {
    const text = buffer.toString('utf-8');
    // Strip UTF-8 BOM (common in Excel/Sheets exports)
    const content = text.startsWith('﻿') ? text.slice(1) : text;
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    const rows: string[][] = [];
    for (const line of lines) {
        if (line.trim() === '') continue;
        rows.push(parseCSVRow(line));
    }
    return rows;
}

// ─── User Resolution ──────────────────────────────────────────────────────────

async function resolveImportUserId(email: string, displayName: string): Promise<string> {
    const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
    });
    if (existing) return existing.id;

    const base = email.split('@')[0].replace(/[^a-z0-9]/gi, '').toLowerCase().substring(0, 16);
    const suffix = Math.random().toString(36).substring(2, 7);
    const username = `${base}_${suffix}`;

    const guest = await prisma.user.create({
        data: {
            email,
            username,
            displayName: displayName || email.split('@')[0],
            passwordHash: '',
        },
        select: { id: true },
    });
    return guest.id;
}

// ─── Import Service ───────────────────────────────────────────────────────────

export class ImportService {
    /**
     * Returns the column headers of a CSV so the frontend can build the field-mapping UI.
     */
    static parseHeaders(buffer: Buffer): string[] {
        const rows = parseCSV(buffer);
        if (rows.length === 0) throw new Error('CSV file is empty');
        return rows[0];
    }

    /**
     * Import Google Forms registrations into an event as Attendee + BookingOrder records.
     */
    static async importFromCSV(
        eventId: string,
        organizerId: string,
        buffer: Buffer,
        options: ImportGoogleFormsInput,
    ): Promise<ImportResult> {
        // 1. Verify organizer has manage access
        await ManageService.checkEventAccess(organizerId, eventId, 'canManageAttendees');

        // 2. Verify ticket belongs to this event
        const ticket = await prisma.ticket.findFirst({
            where: { id: options.ticketId, eventId },
        });
        if (!ticket) throw new Error('Ticket not found for this event');

        // 3. Parse CSV
        const rows = parseCSV(buffer);
        if (rows.length < 2) throw new Error('CSV has no data rows');
        if (rows.length - 1 > MAX_ROWS) {
            throw new Error(`Import limited to ${MAX_ROWS} rows. Split your file and import in batches.`);
        }

        const headers = rows[0];
        const dataRows = rows.slice(1);

        // 4. Resolve column indices
        const nameIdx = headers.indexOf(options.nameColumn);
        const emailIdx = headers.indexOf(options.emailColumn);
        const phoneIdx = options.phoneColumn ? headers.indexOf(options.phoneColumn) : -1;
        const cityIdx = options.cityColumn ? headers.indexOf(options.cityColumn) : -1;
        const locationIdx = options.locationColumn ? headers.indexOf(options.locationColumn) : -1;

        if (nameIdx === -1) throw new Error(`Column "${options.nameColumn}" not found in CSV`);
        if (emailIdx === -1) throw new Error(`Column "${options.emailColumn}" not found in CSV`);

        // 5. Validate rows
        const validRows: ImportRow[] = [];
        const errors: ImportResult['errors'] = [];
        const emailsSeen = new Set<string>();

        for (let i = 0; i < dataRows.length; i++) {
            const row = dataRows[i];
            const name = row[nameIdx]?.trim();
            const email = row[emailIdx]?.trim().toLowerCase();

            if (!name || !email) {
                errors.push({ row: i + 2, reason: 'Missing name or email' });
                continue;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                errors.push({ row: i + 2, reason: `Invalid email: ${email}` });
                continue;
            }
            if (emailsSeen.has(email)) {
                errors.push({ row: i + 2, reason: `Duplicate email within CSV: ${email}` });
                continue;
            }
            emailsSeen.add(email);

            validRows.push({
                name,
                email,
                phone: phoneIdx >= 0 ? row[phoneIdx]?.trim() || undefined : undefined,
                city: cityIdx >= 0 ? row[cityIdx]?.trim() || undefined : undefined,
                location: locationIdx >= 0 ? row[locationIdx]?.trim() || undefined : undefined,
            });
        }

        // 6. Skip existing attendees if requested
        let toImport = validRows;
        let skipped = 0;

        if (options.skipDuplicates && validRows.length > 0) {
            const existing = await prisma.attendee.findMany({
                where: {
                    email: { in: validRows.map(r => r.email) },
                    order: { eventId },
                },
                select: { email: true },
            });
            const existingEmails = new Set(existing.map(a => a.email.toLowerCase()));
            toImport = validRows.filter(r => !existingEmails.has(r.email));
            skipped = validRows.length - toImport.length;
        }

        if (toImport.length === 0) {
            return { total: dataRows.length, created: 0, skipped, errors, headers };
        }

        // 7. Process in batches
        let created = 0;

        for (let b = 0; b < toImport.length; b += BATCH_SIZE) {
            const batch = toImport.slice(b, b + BATCH_SIZE);

            // Resolve / create User accounts outside the transaction to keep it short
            const userIds = await Promise.all(
                batch.map(row => resolveImportUserId(row.email, row.name)),
            );

            await prisma.$transaction(
                async (tx) => {
                    for (let j = 0; j < batch.length; j++) {
                        const row = batch[j];
                        const userId = userIds[j];
                        const ticketCode = `EVF-TKT-${uuidv4().substring(0, 8).toUpperCase()}`;

                        // Create a confirmed order for this attendee
                        const order = await tx.bookingOrder.create({
                            data: {
                                userId,
                                eventId,
                                subtotal: ticket.price,
                                serviceFee: 0,
                                total: ticket.price,
                                currency: ticket.currency,
                                status: 'CONFIRMED',
                                paymentStatus: 'COMPLETED',
                                paymentMethod: 'imported',
                                paymentReference: `gforms_import_${uuidv4().substring(0, 8)}`,
                                paidAt: new Date(),
                                confirmedAt: new Date(),
                                items: {
                                    create: {
                                        ticketId: ticket.id,
                                        ticketName: ticket.name,
                                        quantity: 1,
                                        unitPrice: ticket.price,
                                        totalPrice: ticket.price,
                                    },
                                },
                            },
                            select: { id: true },
                        });

                        await tx.attendee.create({
                            data: {
                                orderId: order.id,
                                ticketId: ticket.id,
                                name: row.name,
                                email: row.email,
                                phone: row.phone ?? null,
                                city: row.city ?? null,
                                location: row.location ?? null,
                                ticketCode,
                                status: 'valid',
                            },
                        });

                        await tx.userTicket.create({
                            data: {
                                userId,
                                ticketId: ticket.id,
                                eventId,
                                quantity: 1,
                                status: 'valid',
                                qrCode: ticketCode,
                            },
                        });
                    }

                    await tx.event.update({
                        where: { id: eventId },
                        data: { attendeesCount: { increment: batch.length } },
                    });
                },
                { maxWait: 30_000, timeout: 60_000 },
            );

            created += batch.length;
        }

        return { total: dataRows.length, created, skipped, errors, headers };
    }
}
