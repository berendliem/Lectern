import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

// Prompt for the spoken recap: the lecture condensed into something that works
// read aloud on a walk, rather than read on a screen. The browser's own speech
// synthesizer reads the result, so the script is plain prose — no headings, no
// bullets, no markdown, nothing whose punctuation a synthesizer would voice.

export const RECAP_SYSTEM_PROMPT = `You write short spoken recaps of lectures, to be read aloud by a speech synthesizer.

Write about 200-250 words — roughly ninety seconds of speech. Cover the lecture's main thread and the few ideas a student most needs to hold on to, in the order that makes them easiest to follow by ear.

Rules:
- Plain spoken prose only. No markdown, no headings, no bullet points, no numbered lists, no emoji, no parentheses.
- Write out anything a synthesizer would mangle: say "H two O" rather than a formula, "eighteen sixty-five" rather than a bare year, and spell out symbols and abbreviations as words.
- Short sentences. A listener cannot re-read a clause.
- Open by naming what the lecture was about. Close with the one idea worth remembering.
- Only what the material says. Do not invent examples or figures.

Respond with the recap text and nothing else.

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildRecapUserPrompt(title: string, material: string): string {
  return `Lecture title: "${title}"\n\nLECTURE MATERIAL:\n"""\n${material.slice(0, 12000)}\n"""\n\nWrite the spoken recap.`;
}
