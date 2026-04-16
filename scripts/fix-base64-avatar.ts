/**
 * One-off script: migrate a user's base64 avatar to Cloudinary.
 *
 * Usage:
 *   npx ts-node scripts/fix-base64-avatar.ts <userId>
 *
 * Example:
 *   npx ts-node scripts/fix-base64-avatar.ts 2d55b352-c488-4386-addc-1a29a291b27b
 */

// ── dotenv must be loaded as executable code (not an import side-effect)
// so it runs BEFORE the pg.Pool is constructed below.
import path from 'path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: path.resolve(__dirname, '../.env') });

// ── DB — self-contained so we don't inherit any cached module state
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Pool is created here (after loadEnv), so DATABASE_URL is guaranteed to be set
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ── Cloudinary
import { CloudinaryService } from '../src/v1/utils/cloudinary.service';

async function main() {
    const userId = process.argv[2];

    if (!userId) {
        console.error('Error: userId argument is required.');
        console.error('Usage: npx ts-node scripts/fix-base64-avatar.ts <userId>');
        process.exit(1);
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, avatar: true },
    });

    if (!user) {
        console.error(`Error: No user found with id "${userId}"`);
        process.exit(1);
    }

    console.log(`Found user: ${user.email} (${user.id})`);

    if (!user.avatar) {
        console.log('User has no avatar set — nothing to do.');
        process.exit(0);
    }

    if (!CloudinaryService.isBase64DataUri(user.avatar)) {
        console.log(`Avatar is already a remote URL:\n  ${user.avatar}`);
        console.log('Nothing to migrate.');
        process.exit(0);
    }

    console.log('Avatar is a base64 data URI. Uploading to Cloudinary...');

    const cloudinaryUrl = await CloudinaryService.upload(
        user.avatar,
        'avatars',
        `user_${userId}`,
    );

    await prisma.user.update({
        where: { id: userId },
        data: { avatar: cloudinaryUrl },
    });

    console.log(`Done! Avatar updated to:\n  ${cloudinaryUrl}`);
}

main()
    .catch((err) => {
        console.error('Script failed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
