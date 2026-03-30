import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface AIGeneratedEvent {
    title: string;
    description: string;
    category: 'MUSIC' | 'TECH' | 'BUSINESS' | 'ARTS' | 'SPORTS' | 'EDUCATION' | 'ENTERTAINMENT' | 'COMMUNITY' | 'WELLNESS' | 'FOOD_DRINK' | 'OTHER';
    startDate: string;    // YYYY-MM-DD
    startTime: string;    // HH:MM (24h)
    endDate: string;      // YYYY-MM-DD
    endTime: string;      // HH:MM (24h)
    isOnline: boolean;
    venue: string;
    location: string;     // full address
    onlineLink: string;
    visibility: 'public' | 'private';
    tickets: Array<{
        name: string;
        price: string;    // "0" for free
        quantity: number;
        description: string;
    }>;
    agenda: Array<{
        time: string;     // HH:MM
        activity: string;
        description: string;
    }>;
    tags: string[];
}

const SYSTEM_PROMPT = `You are an event planning assistant. Given a natural language description of an event, extract and structure the information into a JSON object.

Today's date is ${new Date().toISOString().split('T')[0]}.

Return ONLY a JSON object with these fields:
- title: Clear, concise event title (string)
- description: Well-written, engaging event description expanding on what the user provided (string, 2-4 paragraphs)
- category: One of: MUSIC, TECH, BUSINESS, ARTS, SPORTS, EDUCATION, ENTERTAINMENT, COMMUNITY, WELLNESS, FOOD_DRINK, OTHER
- startDate: YYYY-MM-DD format. If relative (e.g. "next Saturday"), compute from today's date.
- startTime: HH:MM in 24h format. Default "09:00" if not mentioned.
- endDate: YYYY-MM-DD format. Default to same as startDate if not mentioned.
- endTime: HH:MM in 24h format. Default "17:00" if not mentioned.
- isOnline: boolean. true if virtual/online event.
- venue: Venue name (empty string if online)
- location: Full address string (empty string if online)
- onlineLink: Online meeting URL if mentioned, otherwise empty string
- visibility: "public" or "private". Default "public".
- tickets: Array of ticket objects. If free event, one entry with price "0". If paid, extract price. Each has: name, price (string number), quantity (number, default 100), description (string).
- agenda: Array of schedule items if mentioned. Each has: time (HH:MM), activity (string), description (string). Empty array if not mentioned.
- tags: Array of relevant lowercase tags (3-6 tags)

Rules:
- Always generate at least one ticket entry
- If the event sounds free, set price to "0"
- Keep the description professional and engaging, written in second person ("Join us for...")
- Do not invent details not mentioned or clearly implied
- If a date is not mentioned, leave startDate/endDate as empty strings`;

export class AIService {
    static async generateEvent(description: string): Promise<AIGeneratedEvent> {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OpenAI API key not configured');
        }

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

        const parsed = JSON.parse(raw) as AIGeneratedEvent;

        // Normalise — ensure required arrays exist
        if (!Array.isArray(parsed.tickets) || parsed.tickets.length === 0) {
            parsed.tickets = [{ name: 'General Admission', price: '0', quantity: 100, description: '' }];
        }
        if (!Array.isArray(parsed.agenda)) parsed.agenda = [];
        if (!Array.isArray(parsed.tags)) parsed.tags = [];

        return parsed;
    }
}
