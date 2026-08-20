import { db } from "@/lib/db";

// Keep the biasing prompt short: whisper's hotwords share the model's prompt
// budget, so only the most recent terms are sent.
const MAX_HOTWORD_TERMS = 50;

export type DictionaryEntry = { term: string; hint: string | null };

export async function getDictionaryEntries(): Promise<DictionaryEntry[]> {
  const rows = await db.dictionaryTerm.findMany({
    orderBy: { createdAt: "desc" },
    take: MAX_HOTWORD_TERMS,
    select: { term: true, hint: true },
  });
  return rows;
}

/**
 * Space-separated personal-dictionary terms for faster-whisper's `hotwords`
 * parameter, which biases decoding toward these spellings. Empty string when
 * the dictionary is empty (callers should omit the field then).
 */
export async function getDictionaryHotwords(): Promise<string> {
  const entries = await getDictionaryEntries();
  return entries.map((e) => e.term).join(" ");
}

/**
 * A "respect these spellings" block for summarization prompts, so notes keep
 * names/acronyms/jargon spelled the way the user taught the app.
 */
export function buildSpellingGuide(entries: DictionaryEntry[]): string {
  if (entries.length === 0) return "";
  const lines = entries.map((e) => `- ${e.term}${e.hint ? ` (${e.hint})` : ""}`);
  return `\n\nThe user's personal dictionary (correct spellings of names, acronyms and jargon — use these exact spellings if the transcript garbled them; do not force terms that aren't discussed into the notes):\n${lines.join("\n")}`;
}
