import OpenAI from 'openai';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface AIGeneratedEvent {
    title: string;
    description: string;
    category: 'MUSIC' | 'TECH' | 'BUSINESS' | 'ARTS' | 'SPORTS' | 'EDUCATION' | 'ENTERTAINMENT' | 'COMMUNITY' | 'WELLNESS' | 'FOOD_DRINK' | 'OTHER';
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    isOnline: boolean;
    venue: string;
    location: string;
    onlineLink: string;
    visibility: 'public' | 'private';
    tickets: Array<{
        name: string;
        price: string;
        quantity: number;
        description: string;
    }>;
    agenda: Array<{
        time: string;
        activity: string;
        description: string;
    }>;
    tags: string[];
}

const TODAY = new Date().toISOString().split('T')[0];

const SYSTEM_PROMPT = `You are an event planning assistant. Extract and structure event information from the provided input (text description, image, or document) into a JSON object.

Today's date is ${TODAY}.

Return ONLY a valid JSON object with these exact fields:
- title: Clear, concise event title (string)
- description: Well-written, engaging 2–4 paragraph event description written in second person ("Join us for...")
- category: Exactly one of: MUSIC, TECH, BUSINESS, ARTS, SPORTS, EDUCATION, ENTERTAINMENT, COMMUNITY, WELLNESS, FOOD_DRINK, OTHER
- startDate: YYYY-MM-DD. Resolve relative dates from today. Empty string if not found.
- startTime: HH:MM in 24h. Default "09:00" if not mentioned.
- endDate: YYYY-MM-DD. Default same as startDate if not mentioned. Empty string if startDate empty.
- endTime: HH:MM in 24h. Default "17:00" if not mentioned.
- isOnline: boolean. true only if virtual/online event.
- venue: Venue name string (empty if online)
- location: Full address string (empty if online)
- onlineLink: Meeting URL if present, otherwise empty string
- visibility: "public" or "private". Default "public".
- tickets: Array of ticket objects, each with: name (string), price (string number, "0" for free), quantity (number, default 100), description (string). Always at least one entry.
- agenda: Array of schedule items if found, each with: time (HH:MM), activity (string), description (string). Empty array if none.
- tags: Array of 3–6 relevant lowercase tags.

Rules:
- Always include at least one ticket entry. Free events use price "0".
- Do not invent details not present or clearly implied.
- For images: read all text visible on the flyer/poster to extract details.`;

function normalise(parsed: any): AIGeneratedEvent {
    if (!Array.isArray(parsed.tickets) || parsed.tickets.length === 0) {
        parsed.tickets = [{ name: 'General Admission', price: '0', quantity: 100, description: '' }];
    }
    if (!Array.isArray(parsed.agenda)) parsed.agenda = [];
    if (!Array.isArray(parsed.tags)) parsed.tags = [];
    parsed.isOnline = Boolean(parsed.isOnline);
    parsed.venue = parsed.venue || '';
    parsed.location = parsed.location || '';
    parsed.onlineLink = parsed.onlineLink || '';
    return parsed as AIGeneratedEvent;
}

export class AIService {
    // ── Plain text description ────────────────────────────────────────────────
    static async generateFromText(description: string): Promise<AIGeneratedEvent> {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: description }
            ],
            temperature: 0.4,
            max_tokens: 1500,
        });
        const raw = completion.choices[0]?.message?.content;
        if (!raw) throw new Error('No response from AI');
        return normalise(JSON.parse(raw));
    }

    // ── Image (event flyer / poster) ──────────────────────────────────────────
    static async generateFromImage(
        imageBuffer: Buffer,
        mimeType: string,
        extraDescription?: string
    ): Promise<AIGeneratedEvent> {
        const base64 = imageBuffer.toString('base64');
        const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
            {
                type: 'image_url',
                image_url: {
                    url: `data:${mimeType};base64,${base64}`,
                    detail: 'high'
                }
            }
        ];
        if (extraDescription?.trim()) {
            userContent.push({ type: 'text', text: `Additional context: ${extraDescription}` });
        } else {
            userContent.push({ type: 'text', text: 'Extract all event details from this image.' });
        }

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',  // Vision requires full gpt-4o
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userContent }
            ],
            temperature: 0.3,
            max_tokens: 1500,
        });
        const raw = completion.choices[0]?.message?.content;
        if (!raw) throw new Error('No response from AI');
        return normalise(JSON.parse(raw));
    }

    // ── PDF document ──────────────────────────────────────────────────────────
    static async generateFromPDF(pdfBuffer: Buffer, extraDescription?: string): Promise<AIGeneratedEvent> {
        const data = await pdfParse(pdfBuffer);
        const text = data.text.slice(0, 8000); // cap to avoid token limit
        const prompt = extraDescription?.trim()
            ? `Document content:\n${text}\n\nAdditional context: ${extraDescription}`
            : `Document content:\n${text}`;
        return AIService.generateFromText(prompt);
    }

    // ── DOCX document ─────────────────────────────────────────────────────────
    static async generateFromDocx(docxBuffer: Buffer, extraDescription?: string): Promise<AIGeneratedEvent> {
        const result = await mammoth.extractRawText({ buffer: docxBuffer });
        const text = result.value.slice(0, 8000);
        const prompt = extraDescription?.trim()
            ? `Document content:\n${text}\n\nAdditional context: ${extraDescription}`
            : `Document content:\n${text}`;
        return AIService.generateFromText(prompt);
    }

    // ── Unified entry point ───────────────────────────────────────────────────
    static async generate(
        description: string | undefined,
        file?: { buffer: Buffer; mimetype: string; originalname: string }
    ): Promise<AIGeneratedEvent> {
        if (!process.env.OPENAI_API_KEY) throw new Error('OpenAI API key not configured');

        if (file) {
            const mime = file.mimetype.toLowerCase();
            const name = file.originalname.toLowerCase();

            if (mime.startsWith('image/')) {
                return AIService.generateFromImage(file.buffer, mime, description);
            }
            if (mime === 'application/pdf' || name.endsWith('.pdf')) {
                return AIService.generateFromPDF(file.buffer, description);
            }
            if (
                mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
                mime === 'application/msword' ||
                name.endsWith('.docx') || name.endsWith('.doc')
            ) {
                return AIService.generateFromDocx(file.buffer, description);
            }
            throw new Error('Unsupported file type. Please upload an image, PDF, or Word document.');
        }

        if (!description || description.trim().length < 10) {
            throw new Error('Please provide a description or upload a file');
        }
        return AIService.generateFromText(description.trim());
    }
}
