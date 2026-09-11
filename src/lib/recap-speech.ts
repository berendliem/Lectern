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
    for (const piece of capLength(sentence)) {
      const last = chunks[chunks.length - 1];
      if (last && last.length + piece.length + 1 <= MAX_CHUNK) {
        chunks[chunks.length - 1] = `${last} ${piece}`;
      } else {
        chunks.push(piece);
      }
    }
  }
  return chunks;
}

/**
 * Breaking a sentence mid-clause costs prosody — the synthesizer reads each
 * piece as a finished statement. Letting one run past the budget costs the
 * words themselves, because that is the truncation this module exists to
 * avoid. Losing the cadence beats losing the content, so an over-long sentence
 * is split at word boundaries as a last resort.
 */
function capLength(sentence: string): string[] {
  if (sentence.length <= MAX_CHUNK) return [sentence];

  const pieces: string[] = [];
  let current = "";
  for (const word of sentence.split(" ")) {
    if (current === "") {
      current = word;
    } else if (current.length + word.length + 1 <= MAX_CHUNK) {
      current = `${current} ${word}`;
    } else {
      pieces.push(current);
      current = word;
    }
  }
  if (current !== "") pieces.push(current);
  return pieces;
}
