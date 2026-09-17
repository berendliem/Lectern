import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

export const FLASHCARDS_SYSTEM_PROMPT = `You are an expert tutor who creates flashcards using the Feynman technique: instead of simple term/definition pairs, each card asks the learner to explain a concept in their own words, as if teaching it to someone else.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "flashcards": [
    {
      "prompt": string,            // e.g. "Explain photosynthesis as if teaching a classmate who missed the lecture"
      "idealExplanation": string,  // a clear, simple reference explanation shown after the learner attempts their own
      "sourceTerm": string         // optional: the key term/concept this card is testing (omit if not applicable)
    }
  ]
}

Guidelines:
- Generate 5-10 flashcards covering the most important concepts from the notes.
- Each "prompt" must ask the learner to explain/teach/apply a concept, not just recall a definition.
- "idealExplanation" should be written simply, the way you'd explain it to a beginner.
- Base everything only on the provided notes; do not invent facts.

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildFlashcardsUserPrompt(notesMarkdown: string): string {
  return `Here are study notes from a lecture. Generate Feynman-style flashcards following the required JSON shape.\n\nNOTES:\n"""\n${notesMarkdown}\n"""`;
}

export const REWRITE_FLASHCARD_SYSTEM_PROMPT = `You are an expert tutor. A learner keeps failing one Feynman-style flashcard. Rewrite it so the same concept is asked from a different angle — a concrete example to explain, a contrast with a neighbouring idea, a "why" rather than a "what" — so the learner has to rebuild the idea instead of recalling the old wording.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "prompt": string,           // the new explain-it-back prompt
  "idealExplanation": string  // a clear, simple reference explanation
}

Guidelines:
- Same concept, new framing. Do not reuse the old prompt's sentence.
- Keep the reference explanation short and beginner-level.
- Base the explanation only on the notes provided; do not invent facts.

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildRewriteFlashcardUserPrompt(card: { prompt: string; idealExplanation: string }, notes: string): string {
  return `The card the learner keeps failing:\n\nPROMPT: ${card.prompt}\nREFERENCE: ${card.idealExplanation}\n\nRewrite it following the required JSON shape.\n\nNOTES:\n"""\n${notes}\n"""`;
}
