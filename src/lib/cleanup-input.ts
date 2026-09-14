import type { TranscriptSegment } from "@/types";
import { segmentsToRawText } from "@/lib/transcript-import";

/**
 * What the cleanup model reads, and who in it is teaching. Raw text carries no
 * speaker labels, so a diarized recording is rebuilt from its segments with a
 * label on every speaker change. The lecturer is decided once, over the whole
 * lecture, by word count: decided per chunk, a long Q&A stretch would make a
 * student look like the lecturer and get the lecturer's words cut instead.
 */
export function cleanupInput(
  rawText: string,
  segments: TranscriptSegment[]
): { text: string; lecturer?: string } {
  const words = new Map<string, number>();
  for (const segment of segments) {
    if (!segment.speaker) continue;
    words.set(segment.speaker, (words.get(segment.speaker) ?? 0) + segment.text.split(/\s+/).filter(Boolean).length);
  }
  if (words.size === 0) return { text: rawText };
  const lecturer = [...words.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
  return { text: segmentsToRawText(segments), lecturer };
}
