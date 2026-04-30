/**
 * Test / backfill script: extract a colour palette from an event's cover image
 * and persist it to the colorPalette field in the database.
 *
 * Usage:
 *   npx ts-node scripts/seed-color-palette.ts <eventId>
 *   npx ts-node scripts/seed-color-palette.ts <eventId> --dry-run
 *
 * Options:
 *   --dry-run   Extract and display colours without writing to the database.
 *   --all       Process every event that has a coverImage (ignores <eventId>).
 *
 * Examples:
 *   npx ts-node scripts/seed-color-palette.ts abc123
 *   npx ts-node scripts/seed-color-palette.ts abc123 --dry-run
 *   npx ts-node scripts/seed-color-palette.ts --all
 *   npx ts-node scripts/seed-color-palette.ts --all --dry-run
 */

import path from 'path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: path.resolve(__dirname, '../.env') });

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ColorPaletteService, ColorPalette } from '../src/v1/utils/color-palette.service';

// ── Prisma setup (mirrors the app's database.ts) ─────────────────────────────
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isAll = args.includes('--all');
const eventId = args.find(a => !a.startsWith('--'));

// ── Terminal colour helpers ───────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim  = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan   = (s: string) => `\x1b[36m${s}\x1b[0m`;

/** Render a filled block in approximately the given hex colour (256-colour ANSI). */
function colourBlock(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    // Map to 6×6×6 colour cube (indices 16–231)
    const ri = Math.round(r / 255 * 5);
    const gi = Math.round(g / 255 * 5);
    const bi = Math.round(b / 255 * 5);
    const idx = 16 + 36 * ri + 6 * gi + bi;
    return `\x1b[48;5;${idx}m   \x1b[0m`;
}

function printPalette(palette: ColorPalette) {
    console.log(`    ${colourBlock(palette.background)} ${cyan('background')}  ${dim(palette.background)}`);
    console.log(`    ${colourBlock(palette.lightTone)}  ${cyan('lightTone')}   ${dim(palette.lightTone)}`);
    console.log(`    ${colourBlock(palette.textColor)}  ${cyan('textColor')}   ${dim(palette.textColor)}`);
}

// ── Core logic ────────────────────────────────────────────────────────────────

async function processEvent(id: string): Promise<boolean> {
    const event = await prisma.event.findUnique({
        where: { id },
        select: { id: true, title: true, coverImage: true, colorPalette: true },
    });

    if (!event) {
        console.log(red(`  ✗ Event not found: ${id}`));
        return false;
    }

    if (!event.coverImage) {
        console.log(yellow(`  ⚠ Event "${event.title}" has no coverImage — skipping`));
        return false;
    }

    console.log(`\n${bold(event.title)}`);
    console.log(dim(`  id: ${event.id}`));
    console.log(dim(`  image: ${event.coverImage.slice(0, 80)}${event.coverImage.length > 80 ? '…' : ''}`));

    if (event.colorPalette) {
        console.log(dim('  existing palette:'));
        printPalette(event.colorPalette as unknown as ColorPalette);
    }

    process.stdout.write('  extracting… ');
    const start = Date.now();

    const palette = await ColorPaletteService.extract(event.coverImage);

    if (!palette) {
        console.log(red('failed'));
        console.log(red('  ✗ Both vibrant and AI fallback returned nothing'));
        return false;
    }

    console.log(green(`done (${Date.now() - start}ms)`));
    console.log('  extracted palette:');
    printPalette(palette);

    if (isDryRun) {
        console.log(yellow('  ↳ dry-run: skipping DB write'));
        return true;
    }

    await prisma.event.update({
        where: { id: event.id },
        data: { colorPalette: palette as any },
    });

    console.log(green('  ✓ colorPalette saved'));
    return true;
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error(red('DATABASE_URL is not set. Make sure your .env file exists.'));
        process.exit(1);
    }

    console.log(bold('\n🎨  Color Palette Seeder'));
    if (isDryRun) console.log(yellow('  [dry-run mode — no DB writes]\n'));

    if (isAll) {
        const events = await prisma.event.findMany({
            where: { coverImage: { not: '' } },
            select: { id: true },
            orderBy: { createdAt: 'desc' },
        });

        console.log(`Found ${bold(String(events.length))} events with a coverImage\n`);

        let ok = 0, fail = 0;
        for (const { id } of events) {
            const success = await processEvent(id);
            success ? ok++ : fail++;
        }

        console.log(`\n${bold('Done.')}  ${green(`${ok} succeeded`)}  ${fail > 0 ? red(`${fail} failed`) : dim('0 failed')}\n`);

    } else {
        if (!eventId) {
            console.error(red('Usage: npx ts-node scripts/seed-color-palette.ts <eventId> [--dry-run]'));
            console.error(red('       npx ts-node scripts/seed-color-palette.ts --all [--dry-run]'));
            process.exit(1);
        }
        await processEvent(eventId);
        console.log();
    }
}

main()
    .catch(err => {
        console.error(red('\nFatal error:'), err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
