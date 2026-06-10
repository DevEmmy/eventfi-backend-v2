/**
 * Converts a string into a URL-friendly, lowercase, hyphen-separated slug.
 * e.g. "Founders Friday Nigeria!" -> "founders-friday-nigeria"
 */
export function slugify(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
