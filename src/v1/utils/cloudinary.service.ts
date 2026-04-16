import { v2 as cloudinary } from 'cloudinary';

// Configure once on module load — throws early if env vars are missing
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
    console.warn('[Cloudinary] Missing env vars: CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET');
}

cloudinary.config({
    cloud_name: CLOUD_NAME,
    api_key: API_KEY,
    api_secret: API_SECRET,
    secure: true,
});

export type CloudinaryFolder = 'avatars' | 'events' | 'gallery';

export class CloudinaryService {
    /**
     * Returns true when the string is a base64 data URI (e.g. data:image/png;base64,...)
     */
    static isBase64DataUri(value: string): boolean {
        return /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(value);
    }

    /**
     * Upload a base64 data URI or a remote URL to Cloudinary.
     * Returns the secure HTTPS URL of the uploaded asset.
     *
     * @param source  - base64 data URI **or** a remote image URL
     * @param folder  - Cloudinary folder to organise the upload
     * @param publicId - optional stable public ID (e.g. `user_<id>`) so re-uploads overwrite the same asset
     */
    static async upload(
        source: string,
        folder: CloudinaryFolder,
        publicId?: string,
    ): Promise<string> {
        const result = await cloudinary.uploader.upload(source, {
            folder,
            ...(publicId ? { public_id: publicId, overwrite: true, invalidate: true } : {}),
            resource_type: 'image',
            // Automatically convert to a compressed WebP for better performance
            transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        });

        return result.secure_url;
    }

    /**
     * Convenience helper: only upload when the value is a base64 data URI.
     * If it is already a remote URL, return it unchanged.
     * This is the safe guard called before persisting any image field.
     */
    static async ensureCloudinaryUrl(
        value: string,
        folder: CloudinaryFolder,
        publicId?: string,
    ): Promise<string> {
        if (!value) return value;

        if (this.isBase64DataUri(value)) {
            return this.upload(value, folder, publicId);
        }

        // Already a remote URL — return as-is
        return value;
    }
}
