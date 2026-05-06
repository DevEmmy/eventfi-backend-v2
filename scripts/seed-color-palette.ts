/**
 * Test / backfill script: extract a colour palette from an event's cover image
 * and persist it to the colorPalette field in the database.
 *
 * Extraction order (for existing Cloudinary URLs):
 *   1. Cloudinary admin API  — free, uses existing credentials, no extra cost
 *   2. GPT-4o-mini vision    — fallback if Cloudinary API fails
 *
 * Usage:
 *   npx ts-node scripts/seed-color-palette.ts <eventId>
 *   npx ts-node scripts/seed-color-palette.ts <eventId> --dry-run
 *   npx ts-node scripts/seed-color-palette.ts --all [--dry-run]
 */

import path from 'path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: path.resolve(__dirname, '../.env') });

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';
import { fromCloudinaryColors, extractFromAI, ColorPaletteService, ColorPalette } from '../src/v1/utils/color-palette.service';

// ── Prisma setup ──────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

// ── Cloudinary setup ──────────────────────────────────────────────────────────
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true,
});

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isAll    = args.includes('--all');
const eventId  = args.find(a => !a.startsWith('--'));

// ── Terminal colour helpers ───────────────────────────────────────────────────
const bold   = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim    = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan   = (s: string) => `\x1b[36m${s}\x1b[0m`;

function colourBlock(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const idx = 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
    return `\x1b[48;5;${idx}m   \x1b[0m`;
}

function printPalette(palette: ColorPalette) {
    console.log(`    ${colourBlock(palette.background)} ${cyan('background')}  ${dim(palette.background)}`);
    console.log(`    ${colourBlock(palette.lightTone)}  ${cyan('lightTone')}   ${dim(palette.lightTone)}`);
    console.log(`    ${colourBlock(palette.textColor)}  ${cyan('textColor')}   ${dim(palette.textColor)}`);
}

// ── Cloudinary public_id extraction ──────────────────────────────────────────
// e.g. https://res.cloudinary.com/cloud/image/upload/v123/events/foo.webp → events/foo
function extractPublicId(url: string): string | null {
    const m = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[^./]+)?$/);
    return m ? m[1] : null;
}

// ── Primary: Cloudinary admin API colours ─────────────────────────────────────
async function extractViaCloudinary(imageUrl: string): Promise<ColorPalette | null> {
    const publicId = extractPublicId(imageUrl);
    if (!publicId) throw new Error(`Could not parse public_id from URL: ${imageUrl}`);

    const resource = await (cloudinary.api as any).resource(publicId, { colors: true });
    const colors: [string, number][] = resource.colors ?? [];

    if (colors.length === 0) throw new Error('Cloudinary returned no colours for this resource');
    return fromCloudinaryColors(colors);
}

// ── Core per-event logic ──────────────────────────────────────────────────────
async function processEvent(id: string): Promise<boolean> {
    const event = await prisma.event.findUnique({
        where:  { id },
        select: { id: true, title: true, coverImage: true, colorPalette: true },
    });

    if (!event) { console.log(red(`  ✗ Event not found: ${id}`)); return false; }
    if (!event.coverImage) { console.log(yellow(`  ⚠ "${event.title}" has no coverImage — skipping`)); return false; }

    console.log(`\n${bold(event.title)}`);
    console.log(dim(`  id:    ${event.id}`));
    console.log(dim(`  image: ${event.coverImage.slice(0, 90)}${event.coverImage.length > 90 ? '…' : ''}`));

    if (event.colorPalette) {
        console.log(dim('  existing palette:'));
        printPalette(event.colorPalette as unknown as ColorPalette);
    }

    process.stdout.write('  extracting… ');
    const t0 = Date.now();

    let palette: ColorPalette | null = null;
    let method = '';

    // 1. GPT-4o vision — understands design intent
    if (!process.env.OPENAI_API_KEY) {
        console.log(yellow('OpenAI key not set — skipping to Cloudinary fallback'));
    } else {
        try {
            palette = await extractFromAI(event.coverImage);
            if (palette) method = 'openai (gpt-4o)';
        } catch (err: any) {
            console.log(yellow(`AI failed (${err?.message ?? err}), trying Cloudinary…`));
        }
    }

    // 2. Cloudinary admin API — pixel-based fallback
    if (!palette) {
        process.stdout.write('  trying Cloudinary fallback… ');
        try {
            palette = await extractViaCloudinary(event.coverImage);
            if (palette) method = 'cloudinary';
        } catch (err: any) {
            console.log(red(`cloudinary failed (${err?.message ?? err})`));
        }
    }

    if (!palette) {
        console.log(red('failed'));
        console.log(red('  ✗ Both Cloudinary and AI returned nothing'));
        return false;
    }

    console.log(green(`done via ${method} (${Date.now() - t0}ms)`));
    console.log('  extracted palette:');
    printPalette(palette);

    if (isDryRun) { console.log(yellow('  ↳ dry-run: skipping DB write')); return true; }

    await prisma.event.update({
        where: { id: event.id },
        data:  { colorPalette: palette as any },
    });

    console.log(green('  ✓ colorPalette saved'));
    return true;
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
    if (!process.env.DATABASE_URL) {
        console.error(red('DATABASE_URL not set. Check your .env file.'));
        process.exit(1);
    }
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        console.warn(yellow('⚠  Cloudinary env vars missing — will skip to AI fallback'));
    }

    console.log(bold('\n🎨  Color Palette Seeder'));
    console.log(dim(`  Cloudinary: ${process.env.CLOUDINARY_CLOUD_NAME ? '✓' : '✗ not configured'}`));
    console.log(dim(`  OpenAI:     ${process.env.OPENAI_API_KEY     ? '✓' : '✗ not configured'}`));
    if (isDryRun) console.log(yellow('  [dry-run — no DB writes]\n'));

    if (isAll) {
        const events = await prisma.event.findMany({
            where:   { coverImage: { not: '' } },
            select:  { id: true },
            orderBy: { createdAt: 'desc' },
        });

        console.log(`\nFound ${bold(String(events.length))} events with a coverImage\n`);
        let ok = 0, fail = 0;
        for (const { id } of events) {
            (await processEvent(id)) ? ok++ : fail++;
        }
        console.log(`\n${bold('Done.')}  ${green(`${ok} succeeded`)}  ${fail > 0 ? red(`${fail} failed`) : dim('0 failed')}\n`);
    } else {
        if (!eventId) {
            console.error(red('Usage: npx ts-node scripts/seed-color-palette.ts <eventId> [--dry-run]'));
            process.exit(1);
        }
        await processEvent(eventId);
        console.log();
    }
}

main()
    .catch(err => { console.error(red('\nFatal error:'), err); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
