/**
 * One-off migration script: upload any base64-encoded event images to Cloudinary
 * and replace them with the returned HTTPS URL in the database.
 *
 * Covers:
 *   - Event.coverImage  (String)
 *   - Event.gallery     (String[])
 *
 * Usage:
 *   npx ts-node scripts/fix-base64-event-images.ts [--dry-run]
 *
 * Options:
 *   --dry-run   Scan and report without writing any changes to the DB or Cloudinary.
 *
 * Examples:
 *   npx ts-node scripts/fix-base64-event-images.ts --dry-run
 *   npx ts-node scripts/fix-base64-event-images.ts
 */

import path from 'path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: path.resolve(__dirname, '../.env') });

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { CloudinaryService } from '../src/v1/utils/cloudinary.service';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 50; // events per page

// ── Counters ──────────────────────────────────────────────────────────────────

const stats = {
    totalEvents: 0,
    eventsScanned: 0,
    eventsWithBase64: 0,
    imagesFixed: 0,
    imagesFailed: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, len = 80): string {
    return s.length > len ? s.slice(0, len) + '…' : s;
}

/**
 * Upload a single base64 value, returning the Cloudinary URL.
 * Returns null on failure (logs the error and increments imagesFailed).
 */
async function uploadOne(
    base64: string,
    publicId: string,
    label: string,
): Promise<string | null> {
    if (DRY_RUN) {
        console.log(`    [DRY-RUN] would upload ${label} → public_id: ${publicId}`);
        return `https://dry-run.example.com/${publicId}`;
    }
    try {
        const url = await CloudinaryService.upload(base64, 'events', publicId);
        console.log(`    ✓ Uploaded ${label} → ${url}`);
        stats.imagesFixed++;
        return url;
    } catch (err: any) {
        console.error(`    ✗ Failed to upload ${label}: ${err.message}`);
        stats.imagesFailed++;
        return null;
    }
}

// ── Core logic ────────────────────────────────────────────────────────────────

async function processEvent(event: {
    id: string;
    title: string;
    coverImage: string;
    gallery: string[];
}): Promise<void> {
    let newCoverImage: string | null = null;
    const newGallery: string[] = [...event.gallery];
    let dirty = false;

    // ── coverImage ─────────────────────────────────────────────────────────────
    if (CloudinaryService.isBase64DataUri(event.coverImage)) {
        console.log(`  coverImage is base64 (${truncate(event.coverImage, 60)})`);
        const url = await uploadOne(
            event.coverImage,
            `event_${event.id}_cover`,
            'coverImage',
        );
        if (url) {
            newCoverImage = url;
            dirty = true;
        }
    }

    // ── gallery ────────────────────────────────────────────────────────────────
    for (let i = 0; i < event.gallery.length; i++) {
        const item = event.gallery[i];
        if (CloudinaryService.isBase64DataUri(item)) {
            console.log(`  gallery[${i}] is base64 (${truncate(item, 60)})`);
            const url = await uploadOne(
                item,
                `event_${event.id}_gallery_${i}`,
                `gallery[${i}]`,
            );
            if (url) {
                newGallery[i] = url;
                dirty = true;
            }
        }
    }

    if (!dirty) return;

    stats.eventsWithBase64++;

    if (DRY_RUN) {
        console.log(`  [DRY-RUN] would update event ${event.id} in DB`);
        return;
    }

    // Build update payload — only include fields that actually changed
    const updateData: { coverImage?: string; gallery?: string[] } = {};
    if (newCoverImage !== null) updateData.coverImage = newCoverImage;
    // Only write gallery if at least one item changed
    if (event.gallery.some((img, i) => newGallery[i] !== img)) {
        updateData.gallery = newGallery;
    }

    await prisma.event.update({
        where: { id: event.id },
        data: updateData,
    });

    console.log(`  ✓ DB updated for event "${event.title}" (${event.id})`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('='.repeat(60));
    console.log(' EventFi — Base64 Event Image Migration');
    console.log(DRY_RUN ? ' MODE: DRY-RUN (no writes)' : ' MODE: LIVE (will write to DB + Cloudinary)');
    console.log('='.repeat(60));
    console.log();

    // Count total events for progress display
    stats.totalEvents = await prisma.event.count();
    console.log(`Total events in DB: ${stats.totalEvents}`);

    if (stats.totalEvents === 0) {
        console.log('No events found — nothing to do.');
        return;
    }

    // Cursor-based batching to avoid loading all events into memory
    let cursor: string | undefined = undefined;

    while (true) {
        const batch: Array<{ id: string; title: string; coverImage: string; gallery: string[] }> = await prisma.event.findMany({
            take: BATCH_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: 'asc' },
            select: {
                id: true,
                title: true,
                coverImage: true,
                gallery: true,
            },
        });

        if (batch.length === 0) break;

        for (const event of batch) {
            stats.eventsScanned++;
            const hasBase64Cover = CloudinaryService.isBase64DataUri(event.coverImage);
            const hasBase64Gallery = event.gallery.some((img: string) =>
                CloudinaryService.isBase64DataUri(img),
            );

            if (hasBase64Cover || hasBase64Gallery) {
                console.log(
                    `\n[${stats.eventsScanned}/${stats.totalEvents}] "${event.title}" (${event.id})`,
                );
                await processEvent(event);
            }
        }

        cursor = batch[batch.length - 1]!.id;
        if (batch.length < BATCH_SIZE) break;
    }

    // ── Summary ────────────────────────────────────────────────────────────────
    console.log();
    console.log('='.repeat(60));
    console.log(' Summary');
    console.log('='.repeat(60));
    console.log(`  Events scanned:        ${stats.eventsScanned}`);
    console.log(`  Events with base64:    ${stats.eventsWithBase64}`);
    if (!DRY_RUN) {
        console.log(`  Images migrated:       ${stats.imagesFixed}`);
        console.log(`  Images failed:         ${stats.imagesFailed}`);
    }
    if (stats.eventsWithBase64 === 0) {
        console.log('\n  All event images are already Cloudinary URLs.');
    } else if (DRY_RUN) {
        console.log('\n  Re-run without --dry-run to apply these changes.');
    } else if (stats.imagesFailed > 0) {
        console.log('\n  Some images failed to upload — re-run to retry.');
        process.exitCode = 1;
    } else {
        console.log('\n  Migration complete.');
    }
}

main()
    .catch((err) => {
        console.error('\nFatal error:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
