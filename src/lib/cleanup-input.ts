import type { TranscriptSegment } from "@/types";
import { segmentsToRawText } from "@/lib/transcript-import";
import { splitTextIntoChunks } from "@/lib/text-chunks";

/**
 * What the cleanup model reads, chunked, and who in it is teaching. Raw text
 * carries no speaker labels, so a diarized recording is rebuilt from its
 * segments with a label on every speaker change. The lecturer is decided once,
 * over the whole lecture, by word count: decided per chunk, a long Q&A stretch
 * would make a student look like the lecturer and get the lecturer's words cut
 * instead.
 *
 * Chunks are cut between segments, never inside one, and each chunk is
 * rendered on its own so it opens with the speaker's label: a chunk that
 * started mid-run would otherwise reach the model with no one named, and the
 * prompt reads an unnamed speaker as a student.
 */
export function cleanupInput(
  rawText: string,
  segments: TranscriptSegment[],
  maxChars: number
): { chunks: string[]; lecturer?: string } {
  const words = new Map<string, number>();
  for (const segment of segments) {
    if (!segment.speaker) continue;
    words.set(segment.speaker, (words.get(segment.speaker) ?? 0) + segment.text.split(/\s+/).filter(Boolean).length);
  }
  if (words.size === 0) return { chunks: splitTextIntoChunks(rawText, maxChars) };
  const lecturer = [...words.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];

  const chunks: string[] = [];
  let group: TranscriptSegment[] = [];
  let size = 0;
  for (const segment of segments) {
    // Label plus separator, generously: over-estimating only makes chunks shorter.
    const cost = segment.text.length + (segment.speaker?.length ?? 0) + 4;
    if (group.length > 0 && size + cost > maxChars) {
      chunks.push(segmentsToRawText(group));
      group = [];
      size = 0;
    }
    group.push(segment);
    size += cost;
  }
  if (group.length > 0) chunks.push(segmentsToRawText(group));
  return { chunks: chunks.filter(Boolean), lecturer };
}
