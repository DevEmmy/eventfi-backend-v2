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
- "accent": A vibrant, saturated hex derived from the dominant hue — suitable as a button/link colour with white text (e.g. "#3a7bd5", "#b5451b"). Should NOT be near-white or near-black.
- "textColor": Either "#111111" (dark) or "#f8f9fa" (light), whichever reads best on the background.

Return only the JSON object, no explanation.`,
                    },
                ],
            }],
            max_tokens: 120,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) return null;
        const parsed = JSON.parse(content);
        if (!parsed.background || !parsed.lightTone || !parsed.accent || !parsed.textColor) return null;
        return { background: parsed.background, lightTone: parsed.lightTone, accent: parsed.accent, textColor: parsed.textColor };
    } catch {
        return null;
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

export class ColorPaletteService {
    static async extract(cloudinaryUrl: string): Promise<ColorPalette | null> {
        if (!cloudinaryUrl) return null;
        try { return await extractFromAI(cloudinaryUrl); } catch { return null; }
    }
}
