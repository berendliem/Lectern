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

// A speaker name is a short run of name-ish words, at most five. Words start
// with an uppercase letter, except that a lowercase nobiliary particle may
// appear in the middle ("Dr. van Vos"). Shared by splitSpeaker's colon-prefix
// check and parseTimestampedText's turn-header checks, so "Remember this: "
// and "The lecture wrapped up around 1:15" are never mistaken for a speaker
// name — "this" and "lecture" are neither capitalised nor particles.
const NAME_WORD = "\\p{Lu}[\\p{L}\\p{M}'’.\\-]*";
const PARTICLE = "(?:van|de|der|den|von|la|le|du|di|dos|bin|al)";
const SPEAKER_NAME = new RegExp(
  `^${NAME_WORD}(?: (?:${NAME_WORD}|${PARTICLE})){0,4}$`,
  "u"
);

// "Speaker 1", "Participant 2" — the numbered placeholder Teams, Zoom and
// Otter give an unidentified participant. A trailing number is admitted only
// behind one of these words: allowing any word to be followed by a digit run
// would also read "Chapter 3: ..." and "Question 1: ..." as speakers.
const NUMBERED_SPEAKER =
  /^(?:speaker|spreker|participant|attendee|guest|student|presenter|interviewer|person|unknown)\s+\d{1,3}$/i;

function looksLikeSpeakerName(candidate: string): boolean {
  const trimmed = candidate.trim();
  return SPEAKER_NAME.test(trimmed) || NUMBERED_SPEAKER.test(trimmed);
}

/** Pulls `<v Name>text</v>` or a `Name: text` prefix out of a cue payload. */
export function splitSpeaker(payload: string): { speaker?: string; text: string } {
  const voice = payload.match(/^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?\s*$/i);
  if (voice) return { speaker: voice[1].trim(), text: stripTags(voice[2]).trim() };

  const stripped = stripTags(payload).trim();
  const prefixed = stripped.match(/^([^:]+):\s+(.*)$/);
  if (prefixed && looksLikeSpeakerName(prefixed[1])) {
    return { speaker: prefixed[1].trim(), text: prefixed[2].trim() };
  }

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
// how Teams' Word export and several note apps open a turn. The captured
// name is content-blind on its own (it'd also match "The lecture wrapped up
// around   1:15"), so callers must additionally check it with
// looksLikeSpeakerName before treating it as a turn header.
const SPEAKER_THEN_TIME = /^(.{1,60}?)\s{1,}((?:\d{1,2}:)?\d{1,2}:\d{2})$/;
// "[00:00:10] Dr Vos: text" — a genuinely bracketed timecode, everything else
// on the same line. Always safe to open a turn: the brackets are the signal.
const BRACKETED_TIME = /^\[((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]\s+(.*)$/;
// "0:12 Dr Vos: text" — a bare, unbracketed timecode. On its own this also
// matches ordinary prose ("12:30 is when we broke for lunch"), so callers
// must additionally require the remainder to carry a speaker prefix.
const UNBRACKETED_TIME = /^((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s+(.*)$/;

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
    if (turn && looksLikeSpeakerName(turn[1])) {
      const start = parseTimecode(turn[2]);
      if (!Number.isNaN(start)) {
        open.push({ start, speaker: turn[1].trim(), parts: [] });
        continue;
      }
    }

    const bracketed = line.match(BRACKETED_TIME);
    if (bracketed) {
      const start = parseTimecode(bracketed[1]);
      if (!Number.isNaN(start)) {
        const { speaker, text } = splitSpeaker(bracketed[2]);
        open.push({ start, speaker, parts: text ? [text] : [] });
        continue;
      }
    } else {
      const unbracketed = line.match(UNBRACKETED_TIME);
      if (unbracketed) {
        const { speaker, text } = splitSpeaker(unbracketed[2]);
        if (speaker) {
          const start = parseTimecode(unbracketed[1]);
          if (!Number.isNaN(start)) {
            open.push({ start, speaker, parts: text ? [text] : [] });
            continue;
          }
        }
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

export type ParsedTranscript = {
  segments: TranscriptSegment[];
  speakers: string[];
  format: "vtt" | "srt" | "text";
  /** Cues dropped as unusable, so the caller can say so rather than stay silent. */
  skipped: number;
};

// Mirrors the ceiling on transcriptSegmentSchema.speaker in validation.ts. The
// schema stays the trust boundary; clamping here just keeps one malformed cue
// from taking a whole import down with it.
const MAX_SPEAKER_CHARS = 120;

// ponytail: 15s same-speaker merge window and a 1500-char cap, both tuned by
// eye on Teams exports. Promote to env values if a lecturer's cadence fights
// them.
const MERGE_WINDOW_SEC = 15;
const MERGE_MAX_CHARS = 1500;

/**
 * Joins consecutive segments that share a speaker and sit close together in
 * time, keeping the original span. Phase 4's diarization alignment calls this
 * with the same defaults so imported and recorded transcripts segment alike.
 */
export function mergeSameSpeaker(
  segments: TranscriptSegment[],
  windowSec: number = MERGE_WINDOW_SEC
): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];

  for (const segment of segments) {
    const prev = out[out.length - 1];
    const joinable =
      prev &&
      prev.speaker === segment.speaker &&
      segment.start - prev.end <= windowSec &&
      prev.text.length + segment.text.length + 1 <= MERGE_MAX_CHARS;

    if (joinable) {
      prev.text = `${prev.text} ${segment.text}`.trim();
      prev.end = segment.end;
      // Keep whatever timings either side carries — dropping them when only
      // one side has words would lose real data on a partly-timed transcript.
      if (prev.words || segment.words) {
        prev.words = [...(prev.words ?? []), ...(segment.words ?? [])];
      }
      continue;
    }
    out.push({ ...segment });
  }

  return out;
}

/**
 * Flattens segments into the transcript body stored in `Transcript.rawText`.
 * A speaker label is written only when it changes, so the summarize/flashcard
 * prompts see attribution without a name repeated on every line.
 */
export function segmentsToRawText(segments: TranscriptSegment[]): string {
  let lastSpeaker: string | undefined;
  return segments
    .map((segment) => {
      const showLabel = segment.speaker && segment.speaker !== lastSpeaker;
      lastSpeaker = segment.speaker;
      return showLabel ? `${segment.speaker}: ${segment.text}` : segment.text;
    })
    .join("\n\n")
    .trim();
}

/**
 * Picks a parser by content first and extension second, so a Teams .vtt saved
 * as .txt still parses. Returns empty segments rather than throwing when the
 * content matches nothing — the caller decides what to tell the user.
 */
export function parseExternalTranscript(filename: string, content: string): ParsedTranscript {
  const head = content.slice(0, 2000);
  const extension = filename.toLowerCase().split(".").pop() ?? "";

  let format: ParsedTranscript["format"];
  if (/^﻿?\s*WEBVTT/i.test(head)) format = "vtt";
  else if (/^\s*\d+\s*\n\s*\d{1,2}:\d{2}:\d{2},\d{3}\s*-->/m.test(head)) format = "srt";
  else if (head.includes("-->")) format = extension === "srt" ? "srt" : "vtt";
  else format = "text";

  const parsed =
    format === "vtt" ? parseVtt(content) : format === "srt" ? parseSrt(content) : parseTimestampedText(content);

  // The parsers already skip cues they cannot read; these two survive parsing
  // but would be rejected by the schema, failing the entire import over one
  // bad cue. Apply the same skip-the-bad-one policy at the seam instead.
  const usable = parsed.filter((segment) => segment.end >= segment.start);
  const clamped = usable.map((segment) =>
    segment.speaker && segment.speaker.length > MAX_SPEAKER_CHARS
      ? { ...segment, speaker: segment.speaker.slice(0, MAX_SPEAKER_CHARS) }
      : segment
  );

  const segments = mergeSameSpeaker(clamped);
  const speakers = [...new Set(segments.map((s) => s.speaker).filter((s): s is string => !!s))];

  return { segments, speakers, format, skipped: parsed.length - usable.length };
}
