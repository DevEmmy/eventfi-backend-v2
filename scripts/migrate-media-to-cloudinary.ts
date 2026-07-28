/**
 * Backfill script: scan every model/field in the schema that can hold an
 * image (avatars, event covers/galleries, vendor logos/portfolios, community
 * logos/banners, review photos, community post images, etc.) and upload any
 * raw base64 data URI it finds to Cloudinary, replacing the stored value
 * with the resulting secure URL.
 *
 * Base64 media bloats every query/response that selects these fields, which
 * is a direct contributor to request latency. New writes already go through
 * CloudinaryService (see the service layer), but rows written before that
 * was wired up — or before a given field's write path was fixed — may still
 * hold raw base64.
 *
 * Usage:
 *   npx ts-node scripts/migrate-media-to-cloudinary.ts [--dry-run] [--list]
 *   npx ts-node scripts/migrate-media-to-cloudinary.ts --target=user-avatar,vendor-logo
 *   npx ts-node scripts/migrate-media-to-cloudinary.ts --limit=50 --concurrency=5
 */

import path from 'path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: path.resolve(__dirname, '../.env') });

import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { CloudinaryService, CloudinaryFolder } from '../src/v1/utils/cloudinary.service';

// ── Prisma setup ──────────────────────────────────────────────────────────────
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

// ── Terminal colour helpers ───────────────────────────────────────────────────
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function kb(str: string): string {
    return `${(Buffer.byteLength(str, 'utf8') / 1024).toFixed(1)}KB`;
}

// ── Target registry ───────────────────────────────────────────────────────────
// One entry per model/field pair in the schema that can hold an image.
// `isArray: true` targets are scanned in-memory (id + field projection only —
// Postgres can't index into base64 prefixes inside a text[] column cheaply).
interface MediaTarget {
    key: string;
    label: string;
    model: keyof PrismaClient;
    field: string;
    isArray: boolean;
    folder: CloudinaryFolder;
    publicIdPrefix: string;
}

const TARGETS: MediaTarget[] = [
    { key: 'user-avatar', label: 'User.avatar', model: 'user', field: 'avatar', isArray: false, folder: 'avatars', publicIdPrefix: 'user' },
    { key: 'speaker-avatar', label: 'EventSpeaker.avatar', model: 'eventSpeaker', field: 'avatar', isArray: false, folder: 'avatars', publicIdPrefix: 'speaker' },
    { key: 'event-cover', label: 'Event.coverImage', model: 'event', field: 'coverImage', isArray: false, folder: 'events', publicIdPrefix: 'event_cover' },
    { key: 'event-gallery', label: 'Event.gallery', model: 'event', field: 'gallery', isArray: true, folder: 'gallery', publicIdPrefix: 'event_gallery' },
    { key: 'event-review-photos', label: 'Review.photos', model: 'review', field: 'photos', isArray: true, folder: 'reviews', publicIdPrefix: 'event_review' },
    { key: 'vendor-logo', label: 'Vendor.logo', model: 'vendor', field: 'logo', isArray: false, folder: 'vendors', publicIdPrefix: 'vendor_logo' },
    { key: 'vendor-cover', label: 'Vendor.coverImage', model: 'vendor', field: 'coverImage', isArray: false, folder: 'vendors', publicIdPrefix: 'vendor_cover' },
    { key: 'vendor-portfolio', label: 'Vendor.portfolio', model: 'vendor', field: 'portfolio', isArray: true, folder: 'vendors', publicIdPrefix: 'vendor_portfolio' },
    { key: 'vendor-review-photos', label: 'VendorReview.photos', model: 'vendorReview', field: 'photos', isArray: true, folder: 'reviews', publicIdPrefix: 'vendor_review' },
    { key: 'community-logo', label: 'Community.logo', model: 'community', field: 'logo', isArray: false, folder: 'communities', publicIdPrefix: 'community_logo' },
    { key: 'community-banner', label: 'Community.bannerImage', model: 'community', field: 'bannerImage', isArray: false, folder: 'communities', publicIdPrefix: 'community_banner' },
    { key: 'community-post-images', label: 'CommunityPost.images', model: 'communityPost', field: 'images', isArray: true, folder: 'community-posts', publicIdPrefix: 'community_post' },
];

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isList = args.includes('--list');
const limitArg = args.find(a => a.startsWith('--limit='));
const concurrencyArg = args.find(a => a.startsWith('--concurrency='));
const targetArg = args.find(a => a.startsWith('--target='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : undefined;
const concurrency = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 5;
const selectedKeys = targetArg ? targetArg.split('=')[1].split(',') : null;

const activeTargets = selectedKeys
    ? TARGETS.filter(t => selectedKeys.includes(t.key))
    : TARGETS;

// Runs `items` through `worker` with at most `concurrency` in flight at once.
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<'ok' | 'failed'>) {
    let ok = 0, failed = 0;
    let cursor = 0;

    async function next(): Promise<void> {
        const index = cursor++;
        if (index >= items.length) return;
        const result = await worker(items[index]);
        if (result === 'ok') ok++; else failed++;
        return next();
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
    return { ok, failed };
}

// ── Scalar field targets ───────────────────────────────────────────────────────
async function findScalarRows(target: MediaTarget): Promise<{ id: string; value: string }[]> {
    const delegate = (prisma as any)[target.model];
    const rows = await delegate.findMany({
        where: { [target.field]: { startsWith: 'data:image' } },
        select: { id: true, [target.field]: true },
        ...(limit ? { take: limit } : {}),
    });
    return rows.map((r: any) => ({ id: r.id, value: r[target.field] }));
}

async function processScalarRow(target: MediaTarget, row: { id: string; value: string }): Promise<'ok' | 'failed'> {
    console.log(`  → ${dim(row.id)} ${dim(`[${kb(row.value)}]`)}`);

    if (isDryRun) {
        console.log(`    ${yellow('dry-run: would upload + update')}`);
        return 'ok';
    }

    try {
        const url = await CloudinaryService.upload(row.value, target.folder, `${target.publicIdPrefix}_${row.id}`);
        const delegate = (prisma as any)[target.model];
        await delegate.update({ where: { id: row.id }, data: { [target.field]: url } });
        console.log(`    ${green('✓')} ${url}`);
        return 'ok';
    } catch (err: any) {
        console.log(`    ${red('✗ failed')}: ${err?.message ?? err}`);
        return 'failed';
    }
}

// ── Array field targets ─────────────────────────────────────────────────────────
// No cheap DB-side filter for "array contains a base64 element", so we project
// just id + field and filter in memory. --limit still caps how many rows are
// *scanned*, not how many actually need migrating.
async function findArrayRows(target: MediaTarget): Promise<{ id: string; values: string[] }[]> {
    const delegate = (prisma as any)[target.model];
    const rows = await delegate.findMany({
        select: { id: true, [target.field]: true },
        ...(limit ? { take: limit } : {}),
    });
    return rows
        .map((r: any) => ({ id: r.id, values: (r[target.field] as string[]) || [] }))
        .filter((r: any) => r.values.some((v: string) => CloudinaryService.isBase64DataUri(v)));
}

async function processArrayRow(target: MediaTarget, row: { id: string; values: string[] }): Promise<'ok' | 'failed'> {
    const base64Indices = row.values
        .map((v, i) => (CloudinaryService.isBase64DataUri(v) ? i : -1))
        .filter(i => i >= 0);

    console.log(`  → ${dim(row.id)} ${dim(`[${base64Indices.length}/${row.values.length} base64]`)}`);

    if (isDryRun) {
        console.log(`    ${yellow('dry-run: would upload + update')}`);
        return 'ok';
    }

    try {
        const updated = [...row.values];
        for (const i of base64Indices) {
            updated[i] = await CloudinaryService.upload(row.values[i], target.folder, `${target.publicIdPrefix}_${row.id}_${i}`);
        }
        const delegate = (prisma as any)[target.model];
        await delegate.update({ where: { id: row.id }, data: { [target.field]: updated } });
        console.log(`    ${green('✓')} updated ${base64Indices.length} item(s)`);
        return 'ok';
    } catch (err: any) {
        console.log(`    ${red('✗ failed')}: ${err?.message ?? err}`);
        return 'failed';
    }
}

// ── Per-target runner ────────────────────────────────────────────────────────────
async function runTarget(target: MediaTarget): Promise<{ ok: number; failed: number }> {
    console.log(`\n${bold(cyan(target.label))} ${dim(`(${target.key})`)}`);

    if (target.isArray) {
        const rows = await findArrayRows(target);
        console.log(dim(`  ${rows.length} row(s) with base64 entries`));
        if (rows.length === 0) return { ok: 0, failed: 0 };
        return runPool(rows, concurrency, r => processArrayRow(target, r));
    } else {
        const rows = await findScalarRows(target);
        console.log(dim(`  ${rows.length} row(s) with a base64 value`));
        if (rows.length === 0) return { ok: 0, failed: 0 };
        return runPool(rows, concurrency, r => processScalarRow(target, r));
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
    if (isList) {
        console.log(bold('\nAvailable targets:\n'));
        for (const t of TARGETS) console.log(`  ${cyan(t.key.padEnd(24))} ${t.label}`);
        console.log();
        return;
    }

    if (!process.env.DATABASE_URL) {
        console.error(red('DATABASE_URL not set. Check your .env file.'));
        process.exit(1);
    }
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
        console.error(red('Cloudinary env vars missing (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET).'));
        process.exit(1);
    }
    if (selectedKeys && activeTargets.length === 0) {
        console.error(red(`No targets matched --target=${selectedKeys.join(',')}. Run with --list to see valid keys.`));
        process.exit(1);
    }

    console.log(bold('\n🖼  Media → Cloudinary Migration'));
    if (isDryRun) console.log(yellow('  [dry-run — no uploads, no DB writes]'));
    console.log(dim(`  targets: ${activeTargets.map(t => t.key).join(', ')}`));
    console.log(dim(`  concurrency: ${concurrency}${limit ? `, limit: ${limit} rows/target` : ''}`));

    let totalOk = 0, totalFailed = 0;
    for (const target of activeTargets) {
        const { ok, failed } = await runTarget(target);
        totalOk += ok;
        totalFailed += failed;
    }

    console.log(`\n${bold('Done.')}  ${green(`${totalOk} succeeded`)}  ${totalFailed > 0 ? red(`${totalFailed} failed`) : dim('0 failed')}\n`);
    if (totalFailed > 0) process.exitCode = 1;
}

main()
    .catch(err => { console.error(red('\nFatal error:'), err); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); await pool.end(); });
