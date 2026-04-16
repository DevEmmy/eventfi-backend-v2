/**
 * One-off script: migrate a user's base64 avatar to Cloudinary.
 *
 * Usage:
 *   npx ts-node scripts/fix-base64-avatar.ts <userId>
 *
 * Example:
 *   npx ts-node scripts/fix-base64-avatar.ts clxyz1234567890abcdef
 *
 * The script will:
 *  1. Load the user from the database.
 *  2. Verify the avatar field is a base64 data URI.
 *  3. Upload it to Cloudinary under the `avatars/` folder with a stable
 *     public_id of `user_<userId>` so future re-uploads overwrite the same asset.
 *  4. Update the user's avatar field with the Cloudinary HTTPS URL.
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { CloudinaryService } from '../src/v1/utils/cloudinary.service';

const prisma = new PrismaClient();

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
    .finally(() => prisma.$disconnect());
