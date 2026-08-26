import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

export const CHAPTERS_SYSTEM_PROMPT = `You segment a timestamped lecture transcript into named chapters (topic sections), like YouTube chapters.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "chapters": [ { "title": string, "startSec": number } ]
}

Rules:
- 3 to 12 chapters, in chronological order. The first chapter starts at the first timestamp.
- Place a chapter boundary only where the topic genuinely shifts.
- "startSec" must be one of the timestamps shown in the transcript (the number in [brackets]).
- Titles are short and specific (max 6 words), in the lecture's language. No numbering — the app numbers them.
- If the transcript is too short or single-topic for chapters, return exactly one chapter covering it.

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildChaptersUserPrompt(outline: string): string {
  return `Here is a lecture transcript as "[seconds] text" lines. Divide it into chapters following the required JSON shape.\n\nTRANSCRIPT:\n"""\n${outline}\n"""`;
}
