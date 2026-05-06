import OpenAI from 'openai';

export interface ColorPalette {
    background: string;  // 93 % white — very light page tint
    lightTone: string;   // 75 % white — card / surface tint
    accent: string;      // Vibrant hue — replaces brand primary on the event page
    textColor: string;   // #111111 or #f8f9fa — high-contrast body text
}

// ── Colour math ───────────────────────────────────────────────────────────────

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
    const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function lighten(r: number, g: number, b: number, f: number): [number, number, number] {
    return [255 * f + r * (1 - f), 255 * f + g * (1 - f), 255 * f + b * (1 - f)];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const r1 = r / 255, g1 = g / 255, b1 = b / 255;
    const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l * 100];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === r1) h = ((g1 - b1) / d + (g1 < b1 ? 6 : 0)) / 6;
    else if (max === g1) h = ((b1 - r1) / d + 2) / 6;
    else h = ((r1 - g1) / d + 4) / 6;
    return [h * 360, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    h /= 360; s /= 100; l /= 100;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (t: number) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 0.5)   return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [Math.round(hue2rgb(h + 1 / 3) * 255), Math.round(hue2rgb(h) * 255), Math.round(hue2rgb(h - 1 / 3) * 255)];
}

function deriveFromRgb(r: number, g: number, b: number): ColorPalette {
    const [bgR, bgG, bgB] = lighten(r, g, b, 0.93);
    const [ltR, ltG, ltB] = lighten(r, g, b, 0.75);

    // Accent: take the dominant hue, boost saturation to ≥ 55 %, clamp lightness
    // to 40–52 % so it works as a button colour with white text.
    const [h, s, l] = rgbToHsl(r, g, b);
    const [acR, acG, acB] = hslToRgb(h, Math.max(s, 55), Math.min(Math.max(l, 40), 52));

    return {
        background: rgbToHex(bgR, bgG, bgB),
        lightTone:  rgbToHex(ltR, ltG, ltB),
        accent:     rgbToHex(acR, acG, acB),
        textColor:  relativeLuminance(bgR, bgG, bgB) > 0.35 ? '#111111' : '#f8f9fa',
    };
}

// ── Primary: Cloudinary colours ───────────────────────────────────────────────

export function fromCloudinaryColors(colors: [string, number][]): ColorPalette | null {
    if (!colors || colors.length === 0) return null;

    const midtone = colors.find(([hex]) => {
        const rgb = hexToRgb(hex);
        if (!rgb) return false;
        const lum = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
        return lum > 25 && lum < 225;
    }) ?? colors[0];

    const rgb = hexToRgb(midtone[0]);
    return rgb ? deriveFromRgb(...rgb) : null;
}

// ── Primary: GPT-4o vision ────────────────────────────────────────────────────

const AI_PROMPT = `You are a UI/UX designer building a themed event page (similar to lu.ma).
Analyze this event poster/image and return a color palette JSON. Think like a designer — consider the event's mood, brand identity, and visual hierarchy, not just dominant pixel counts.

Return exactly these keys:

"background"  — Page background. Must be VERY LIGHT — the image's ambient hue mixed with ~92% white. Barely visible tint that sets the mood without overpowering. Example: "#f0f2e8", "#fdf4f0", "#f0f4ff".

"lightTone"   — Card/surface background. Same hue family, ~25% more saturated than background (still light). Used for ticket cards, info boxes. Example: "#e8ece0", "#fce8e4", "#e4eaff".

"accent"      — The event's primary brand color. Vibrant and saturated — this becomes the button color, selected states, links. Must contrast well with white text (not too light, not too dark). Think: what is the strongest, most memorable color in this design? Example: "#2563eb", "#dc2626", "#7c3aed", "#059669".

"textColor"   — Body text color. Return "#111111" for light backgrounds (almost always), "#f8f9fa" only if background is genuinely dark.

Rules:
- background and lightTone must be light enough to read dark text on them
- accent must be the most visually dominant brand color — do not pick a muted or washed version
- If the poster has a strong dominant color (e.g. deep blue, vivid red), that should be the accent
- Return ONLY the JSON object`;

export async function extractFromAI(source: string): Promise<ColorPalette | null> {
    if (!process.env.OPENAI_API_KEY) return null;
    try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            response_format: { type: 'json_object' },
            messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: source, detail: 'high' } },
                    { type: 'text', text: AI_PROMPT },
                ],
            }],
            max_tokens: 150,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) return null;
        const parsed = JSON.parse(content);
        if (!parsed.background || !parsed.lightTone || !parsed.accent) return null;
        // Clamp textColor — only two valid values; AI occasionally hallucinates a hue here
        const lum = hexToRgb(parsed.background);
        const textColor = lum && (0.299 * lum[0] + 0.587 * lum[1] + 0.114 * lum[2]) < 128
            ? '#f8f9fa' : '#111111';
        return { background: parsed.background, lightTone: parsed.lightTone, accent: parsed.accent, textColor };
    } catch {
        return null;
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export class ColorPaletteService {
    /**
     * Extract palette from an existing Cloudinary URL.
     * Used by seed script and update path when no upload response is available.
     */
    static async extract(cloudinaryUrl: string): Promise<ColorPalette | null> {
        if (!cloudinaryUrl) return null;
        try { return await extractFromAI(cloudinaryUrl); } catch { return null; }
    }
}
