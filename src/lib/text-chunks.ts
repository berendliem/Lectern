/**
 * Split long text into chunks of at most maxLen characters, preferring
 * paragraph breaks, then sentence ends, so no chunk cuts mid-thought.
 */
export function splitTextIntoChunks(text: string, maxLen: number): string[] {
  if (maxLen <= 0) throw new Error("maxLen must be positive");
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed ? [trimmed] : [];

  const chunks: string[] = [];
  let rest = trimmed;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    let cut = window.lastIndexOf("\n\n");
    if (cut < maxLen * 0.3) cut = window.lastIndexOf(". ") + 1;
    if (cut < maxLen * 0.3) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = maxLen;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
