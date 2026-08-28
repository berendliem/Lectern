import type { TranscriptSegment } from "@/types";

/**
 * Parses a subtitle/transcript timecode into seconds. Accepts hh:mm:ss.mmm,
 * hh:mm:ss,mmm (SubRip), hh:mm:ss, and m:ss. Milliseconds optional.
 */
export function parseTimecode(raw: string): number {
  const cleaned = raw.trim().replace(",", ".");
  const parts = cleaned.split(":");
  if (parts.length < 2 || parts.length > 3) return NaN;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n))) return NaN;
  return parts.length === 3
    ? nums[0] * 3600 + nums[1] * 60 + nums[2]
    : nums[0] * 60 + nums[1];
}

// A speaker prefix is a short run of name-ish characters before a colon.
// Every word must start with an uppercase letter (letters/marks/apostrophes/
// dots/hyphens allowed after that), at most five words. This keeps
// "Remember this: ..." from being mistaken for a speaker named
// "Remember this" (lowercase "this" fails the per-word capital check).
const SPEAKER_PREFIX = /^(\p{Lu}[\p{L}\p{M}'’.\-]*(?: \p{Lu}[\p{L}\p{M}'’.\-]*){0,4}):\s+(.*)$/u;

/** Pulls `<v Name>text</v>` or a `Name: text` prefix out of a cue payload. */
export function splitSpeaker(payload: string): { speaker?: string; text: string } {
  const voice = payload.match(/^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?\s*$/i);
  if (voice) return { speaker: voice[1].trim(), text: stripTags(voice[2]).trim() };

  const stripped = stripTags(payload).trim();
  const prefixed = stripped.match(SPEAKER_PREFIX);
  if (prefixed) return { speaker: prefixed[1].trim(), text: prefixed[2].trim() };

  return { text: stripped };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

/** Splits a cue file into blocks on blank lines, dropping empty ones. */
function toBlocks(content: string): string[][] {
  return content
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.split("\n").map((l) => l.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);
}

/** WebVTT (Teams Facilitator, Teams meeting transcripts). */
export function parseVtt(content: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  for (const lines of toBlocks(content)) {
    if (/^WEBVTT/i.test(lines[0]) || /^NOTE\b/i.test(lines[0])) continue;

    const timingIndex = lines.findIndex((l) => l.includes("-->"));
    if (timingIndex === -1) continue;

    const [rawStart, rawEnd] = lines[timingIndex].split("-->");
    // A cue's timing line can carry settings after the end time
    // ("00:00:04.000 align:start position:0%"); take the first token only.
    const start = parseTimecode(rawStart);
    const end = parseTimecode((rawEnd ?? "").trim().split(/\s+/)[0] ?? "");
    if (Number.isNaN(start) || Number.isNaN(end)) continue;

    const payload = lines.slice(timingIndex + 1).join(" ");
    const { speaker, text } = splitSpeaker(payload);
    if (!text) continue;

    segments.push(speaker ? { start, end, text, speaker } : { start, end, text });
  }

  return segments;
}
