/**
 * Chrome stops speaking a long utterance after roughly fifteen seconds and
 * reports no error, so a recap handed to speechSynthesis in one piece dies
 * mid-sentence. Queueing several short utterances instead keeps it talking,
 * and gives the player something to count for progress.
 *
 * Chunks break at sentence ends so the synthesizer keeps its own prosody —
 * splitting mid-clause makes it read each fragment as a finished statement.
 */
const MAX_CHUNK = 200;

export function splitForSpeech(script: string): string[] {
  const sentences = script
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.length > 0);

  const chunks: string[] = [];
  for (const sentence of sentences) {
    const last = chunks[chunks.length - 1];
    // A sentence longer than the budget still goes out whole: a synthesizer
    // reading half a clause is worse than one reading a long one.
    if (last && last.length + sentence.length + 1 <= MAX_CHUNK) {
      chunks[chunks.length - 1] = `${last} ${sentence}`;
    } else {
      chunks.push(sentence);
    }
  }
  return chunks;
}
