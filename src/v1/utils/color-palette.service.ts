import Vibrant from 'node-vibrant';
import OpenAI from 'openai';

export interface ColorPalette {
    background: string;  // Very light page-background tint
    lightTone: string;   // Medium-light surface/card tint
    textColor: string;   // High-contrast text for readability on background
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rgbToHex(r: number, g: number, b: number): string {
    return `#${[r, g, b]
        .map(v => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0'))
        .join('')}`;
}

// WCAG relative luminance (0 = black, 1 = white)
function relativeLuminance(r: number, g: number, b: number): number {
    const toLinear = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// Blend a colour toward white by `whiteFraction` (0=original, 1=pure white)
function lighten(r: number, g: number, b: number, whiteFraction: number): [number, number, number] {
    const w = whiteFraction;
    return [
        255 * w + r * (1 - w),
        255 * w + g * (1 - w),
        255 * w + b * (1 - w),
    ];
}

function deriveFromRgb(r: number, g: number, b: number): ColorPalette {
    // Background: 93% white → very faint tint (Luma-style)
    const [bgR, bgG, bgB] = lighten(r, g, b, 0.93);
    // Light tone: 75% white → slightly richer surface colour
    const [ltR, ltG, ltB] = lighten(r, g, b, 0.75);

    const background = rgbToHex(bgR, bgG, bgB);
    const lightTone = rgbToHex(ltR, ltG, ltB);

    // Almost always dark text since bg is so light, but handle dark images
    const lum = relativeLuminance(bgR, bgG, bgB);
    const textColor = lum > 0.35 ? '#111111' : '#f8f9fa';

    return { background, lightTone, textColor };
}

// ── Primary extraction via node-vibrant ──────────────────────────────────────

async function extractFromBuffer(buffer: Buffer): Promise<ColorPalette> {
    const palette = await Vibrant.from(buffer).getPalette();

    // Prefer Muted (desaturated, best for UI backgrounds), then Vibrant
    const swatch = palette.Muted ?? palette.Vibrant ?? palette.LightMuted ?? palette.DarkMuted;
    if (!swatch) {
        // No usable swatch — return a neutral default
        return { background: '#f8f9fa', lightTone: '#e9ecef', textColor: '#111111' };
    }

    const [r, g, b] = swatch.rgb;
    return deriveFromRgb(r, g, b);
}

// ── AI fallback via GPT-4o ────────────────────────────────────────────────────

async function extractFromAI(imageSource: string): Promise<ColorPalette | null> {
    if (!process.env.OPENAI_API_KEY) return null;

    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const imageUrl = imageSource.startsWith('data:') ? imageSource : imageSource;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image_url',
                            image_url: { url: imageUrl, detail: 'low' },
                        },
                        {
                            type: 'text',
                            text: `Analyze this event image. Return a JSON with exactly these keys:
- "background": A very light hex color for the page background, heavily desaturated (e.g. "#f0f2e8"). Derived from the dominant tone.
- "lightTone": A slightly richer hex for card/surface backgrounds, same hue family but ~25% less washed out.
- "textColor": Either "#111111" (dark) or "#f8f9fa" (light), whichever reads best on the background.

Return only the JSON object, no explanation.`,
                        },
                    ],
                },
            ],
            max_tokens: 100,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) return null;

        const parsed = JSON.parse(content);
        if (!parsed.background || !parsed.lightTone || !parsed.textColor) return null;

        return {
            background: parsed.background,
            lightTone: parsed.lightTone,
            textColor: parsed.textColor,
        };
    } catch {
        return null;
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export class ColorPaletteService {
    /**
     * Extracts a 3-colour palette (background, lightTone, textColor) from a
     * cover image. Accepts a base64 data URI or a remote Cloudinary URL.
     *
     * Strategy: node-vibrant (fast, no AI cost) → GPT-4o-mini vision fallback.
     * Returns null if both fail so callers can store nothing and move on.
     */
    static async extract(source: string): Promise<ColorPalette | null> {
        if (!source) return null;

        // ── Primary: pixel-level extraction ─────────────────────────────────
        try {
            let buffer: Buffer;

            if (source.startsWith('data:image/')) {
                const base64 = source.replace(/^data:image\/\w+;base64,/, '');
                buffer = Buffer.from(base64, 'base64');
            } else {
                // Remote URL — fetch the image bytes
                const response = await fetch(source);
                if (!response.ok) throw new Error(`fetch ${response.status}`);
                buffer = Buffer.from(await response.arrayBuffer());
            }

            return await extractFromBuffer(buffer);
        } catch (err) {
            console.warn('[ColorPalette] vibrant extraction failed, falling back to AI:', err);
        }

        // ── Fallback: AI vision ──────────────────────────────────────────────
        try {
            return await extractFromAI(source);
        } catch (err) {
            console.warn('[ColorPalette] AI fallback also failed:', err);
            return null;
        }
    }
}
