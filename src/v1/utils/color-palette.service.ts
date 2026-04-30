import OpenAI from 'openai';

export interface ColorPalette {
    background: string;  // Very light page-background tint
    lightTone: string;   // Medium-light surface/card tint
    textColor: string;   // High-contrast text for readability on background
}

// ── Colour math helpers ───────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b]
        .map(v => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0'))
        .join('')}`;
}

function relativeLuminance(r: number, g: number, b: number): number {
    const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Mix a colour toward white: fraction=0 → original, fraction=1 → pure white
function lighten(r: number, g: number, b: number, fraction: number): [number, number, number] {
    return [255 * fraction + r * (1 - fraction), 255 * fraction + g * (1 - fraction), 255 * fraction + b * (1 - fraction)];
}

function deriveFromRgb(r: number, g: number, b: number): ColorPalette {
    const [bgR, bgG, bgB] = lighten(r, g, b, 0.93); // 93 % white → Luma-style page tint
    const [ltR, ltG, ltB] = lighten(r, g, b, 0.75); // 75 % white → surface / card tint

    const background = rgbToHex(bgR, bgG, bgB);
    const lightTone  = rgbToHex(ltR, ltG, ltB);
    const textColor  = relativeLuminance(bgR, bgG, bgB) > 0.35 ? '#111111' : '#f8f9fa';

    return { background, lightTone, textColor };
}

// ── Primary: Cloudinary colours ───────────────────────────────────────────────

/**
 * Convert Cloudinary's `colors` upload field ([[hex, pct], ...]) to a palette.
 * Picks the most dominant mid-tone colour (skips near-black / near-white).
 * Returns null when the array is empty or unusable.
 */
export function fromCloudinaryColors(colors: [string, number][]): ColorPalette | null {
    if (!colors || colors.length === 0) return null;

    // Prefer the most dominant colour that isn't near-black or near-white
    const midtone = colors.find(([hex]) => {
        const rgb = hexToRgb(hex);
        if (!rgb) return false;
        const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
        return lum > 25 && lum < 225;
    }) ?? colors[0]; // fall back to most dominant if all are extreme

    const rgb = hexToRgb(midtone[0]);
    if (!rgb) return null;

    return deriveFromRgb(...rgb);
}

// ── Fallback: GPT-4o-mini vision ──────────────────────────────────────────────

async function extractFromAI(source: string): Promise<ColorPalette | null> {
    if (!process.env.OPENAI_API_KEY) return null;

    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: source, detail: 'low' } },
                    {
                        type: 'text',
                        text: `Analyze this event image. Return a JSON with exactly these keys:
- "background": A very light hex color for the page background, heavily desaturated (e.g. "#f0f2e8"). Derived from the dominant tone.
- "lightTone": A slightly richer hex for card/surface backgrounds, same hue family but ~25% less washed out.
- "textColor": Either "#111111" (dark) or "#f8f9fa" (light), whichever reads best on the background.

Return only the JSON object, no explanation.`,
                    },
                ],
            }],
            max_tokens: 100,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) return null;

        const parsed = JSON.parse(content);
        if (!parsed.background || !parsed.lightTone || !parsed.textColor) return null;

        return { background: parsed.background, lightTone: parsed.lightTone, textColor: parsed.textColor };
    } catch {
        return null;
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export class ColorPaletteService {
    /**
     * Extract a palette from an existing Cloudinary URL (used by the seed
     * script and update path when no Cloudinary upload response is available).
     * Falls back to GPT-4o-mini vision. Returns null if both fail.
     */
    static async extract(cloudinaryUrl: string): Promise<ColorPalette | null> {
        if (!cloudinaryUrl) return null;

        try {
            return await extractFromAI(cloudinaryUrl);
        } catch {
            return null;
        }
    }
}
