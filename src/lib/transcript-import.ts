import type { TranscriptSegment } from "@/types";

/**
 * Parses a subtitle/transcript timecode into seconds. Accepts hh:mm:ss.mmm,
 * hh:mm:ss,mmm (SubRip), hh:mm:ss, and m:ss. Milliseconds optional.
 */
export function parseTimecode(raw: string): number {
  const cleaned = raw.trim().replace(",", ".");
  const parts = cleaned.split(":");
  if (parts.length < 2 || parts.length > 3) return NaN;
  // Each part must be a run of digits, with an optional decimal fraction
  // allowed only on the last (seconds) part — otherwise reject rather than
  // let Number("") silently coerce to 0.
  if (!parts.every((p, i) => (i === parts.length - 1 ? /^\d+(\.\d+)?$/ : /^\d+$/).test(p))) {
    return NaN;
  }
  const nums = parts.map(Number);
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

/** SubRip (Zoom exports, most players). */
export function parseSrt(content: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  for (const lines of toBlocks(content)) {
    const timingIndex = lines.findIndex((l) => l.includes("-->"));
    if (timingIndex === -1) continue;

    const [rawStart, rawEnd] = lines[timingIndex].split("-->");
    const start = parseTimecode(rawStart);
    const end = parseTimecode((rawEnd ?? "").trim().split(/\s+/)[0] ?? "");
    if (Number.isNaN(start) || Number.isNaN(end)) continue;

    const { speaker, text } = splitSpeaker(lines.slice(timingIndex + 1).join(" "));
    if (!text) continue;

    segments.push(speaker ? { start, end, text, speaker } : { start, end, text });
  }

  return segments;
}

// "Berend Liem   0:03" — a speaker name followed by a bare timecode, which is
// how Teams' Word export and several note apps open a turn.
const SPEAKER_THEN_TIME = /^(.{1,60}?)\s{1,}((?:\d{1,2}:)?\d{1,2}:\d{2})$/;
// "[00:00:10] Dr Vos: text" — timecode first, everything else on the same line.
const BRACKET_TIME = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]?\s+(.*)$/;

// Speech runs at roughly 2.5 words per second. Used only to give the final
// segment a plausible end, since these formats carry no end times.
const WORDS_PER_SECOND = 2.5;

/**
 * Timestamped plain text: Teams' Word export, Otter, Granola, hand-kept notes.
 * Segments have no end of their own, so each one runs up to the next segment's
 * start; the last is estimated from its word count.
 */
export function parseTimestampedText(content: string): TranscriptSegment[] {
  const open: { start: number; speaker?: string; parts: string[] }[] = [];

  for (const rawLine of content.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const turn = line.match(SPEAKER_THEN_TIME);
    if (turn) {
      const start = parseTimecode(turn[2]);
      if (!Number.isNaN(start)) {
        open.push({ start, speaker: turn[1].trim() || undefined, parts: [] });
        continue;
      }
    }

    const bracketed = line.match(BRACKET_TIME);
    if (bracketed) {
      const start = parseTimecode(bracketed[1]);
      if (!Number.isNaN(start)) {
        const { speaker, text } = splitSpeaker(bracketed[2]);
        open.push({ start, speaker, parts: text ? [text] : [] });
        continue;
      }
    }

    // A line that opens no turn is body text for whichever turn is open. Text
    // before the first timestamp has no time to attach to, so it is dropped.
    if (open.length > 0) open[open.length - 1].parts.push(line);
  }

  return open
    .filter((turn) => turn.parts.length > 0)
    .map((turn, i, kept) => {
      const text = turn.parts.join(" ").trim();
      const next = kept[i + 1];
      const end = next
        ? next.start
        : turn.start + Math.max(1, text.split(/\s+/).length / WORDS_PER_SECOND);
      return turn.speaker
        ? { start: turn.start, end, text, speaker: turn.speaker }
        : { start: turn.start, end, text };
    });
}
