# Lectern Phase 1 — Course Library and Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a course hold study material that is not a recorded lecture — syllabus, slide decks, readings — and let transcripts produced elsewhere (Teams, Zoom, Otter) be imported with their timings and speakers intact.

**Architecture:** A new course-scoped `Material` model stores extracted text alongside the existing `Page` (lecture) rows under a `Folder` (course). All file parsing happens in the browser and only text reaches the server, matching the existing `extractPdfText` trust model. Transcript parsing is a set of pure functions with no I/O so it can be tested directly, and it feeds the *existing* `/api/pages/from-text` route rather than adding a new endpoint.

**Tech Stack:** Next.js 16 (App Router, server components), React 19, Prisma 7 + better-sqlite3, Zod 4, Tailwind 4, `fflate` (new), `node --test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-28-lectern-course-library-design.md`

## Global Constraints

- Node v24.18.0. Next.js 16.2.9, App Router. All route handlers are `async` and take `params: Promise<{...}>`.
- **Exactly one new runtime dependency in this phase: `fflate`.** Nothing else may be added.
- **All file parsing happens client-side.** Original files are never uploaded or persisted. Only extracted text crosses to the server.
- Prisma client is generated to `src/generated/prisma` and imported via `@/lib/db`. After any schema edit run `npx prisma migrate dev --name <name>`, which regenerates the client.
- Route handlers validate bodies with a Zod schema from `src/lib/validation.ts` through `withValidation` from `src/lib/api-utils.ts`, returning `result.error` on failure. Never trust a request body directly.
- Server components that read the database declare `export const dynamic = "force-dynamic";` — without it Next freezes them as static HTML at build time.
- Tests use `node:test` + `node:assert/strict`. **Test files import with relative paths** (`./transcript-import.ts`), never the `@/` alias, so no path-alias resolution is involved.
- Tailwind only, no new CSS files. Reuse `Button`, `Input`, `Textarea`, `Modal` from `src/components/ui/`.
- User-facing vocabulary in anything you touch: **Course**, **Lecture**, **Material**. The Prisma models stay `Folder` and `Page` — do not rename them.

---

### Task 1: Test harness and the `speaker` field

Nothing in this repo runs tests today. This task adds the runner and the one type change every later task depends on.

**Files:**
- Modify: `package.json` (scripts)
- Modify: `src/types/index.ts`
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` runs every `src/lib/**/*.test.ts`. `TranscriptSegment` gains an optional `speaker?: string`.

- [ ] **Step 1: Write a failing test against an existing pure function**

Create `src/lib/format.test.ts`. Open `src/lib/format.ts` first and use whichever function it actually exports; the assertion below is written for `shortDate`, which `src/app/interview/page.tsx` imports.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shortDate } from "./format.ts";

test("shortDate renders a date without throwing", () => {
  const out = shortDate(new Date("2026-01-15T12:00:00Z"));
  assert.equal(typeof out, "string");
  assert.ok(out.length > 0);
});
```

- [ ] **Step 2: Run it and watch it fail because there is no runner**

Run: `npm test`
Expected: FAIL — npm reports a missing `test` script.

- [ ] **Step 3: Add the runner**

In `package.json`, add to `"scripts"`:

```json
"test": "node --import tsx --test \"src/lib/**/*.test.ts\""
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test`
Expected: PASS, 1 test. If `shortDate` is not the exported name, fix the import to match `src/lib/format.ts` rather than changing that file.

- [ ] **Step 5: Add `speaker` to the segment type**

In `src/types/index.ts`:

```ts
export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  // Present on transcripts imported from a source that labels speakers
  // (Teams, Zoom), and later on diarized recordings. Absent means unknown,
  // never "no speaker".
  speaker?: string;
  words?: { word: string; start: number; end: number; probability: number }[];
};
```

- [ ] **Step 6: Verify nothing broke**

Run: `npx tsc --noEmit`
Expected: no errors. The field is optional, so every existing producer and consumer still type-checks.

- [ ] **Step 7: Commit**

```bash
git add package.json src/types/index.ts src/lib/format.test.ts
git commit -m "test: add node:test runner; add optional speaker to TranscriptSegment"
```

---

### Task 2: Timecode and VTT parsing

**Files:**
- Create: `src/lib/transcript-import.ts`
- Test: `src/lib/transcript-import.test.ts`

**Interfaces:**
- Consumes: `TranscriptSegment` from Task 1.
- Produces: `parseTimecode(raw: string): number`, `parseVtt(content: string): TranscriptSegment[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/transcript-import.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimecode, parseVtt } from "./transcript-import.ts";

test("parseTimecode handles hh:mm:ss.mmm, comma millis, and m:ss", () => {
  assert.equal(parseTimecode("00:01:02.500"), 62.5);
  assert.equal(parseTimecode("00:01:02,500"), 62.5);
  assert.equal(parseTimecode("01:02"), 62);
  assert.equal(parseTimecode("01:00:00"), 3600);
});

test("parseVtt reads Teams voice tags", () => {
  const vtt = [
    "WEBVTT",
    "",
    "d1f2-1",
    "00:00:01.000 --> 00:00:04.000",
    "<v Berend Liem>Welcome to week one.</v>",
    "",
    "d1f2-2",
    "00:00:05.000 --> 00:00:07.000",
    "<v Dr Vos>Let us begin.</v>",
    "",
  ].join("\n");

  const segs = parseVtt(vtt);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].start, 1);
  assert.equal(segs[0].end, 4);
  assert.equal(segs[0].speaker, "Berend Liem");
  assert.equal(segs[0].text, "Welcome to week one.");
  assert.equal(segs[1].speaker, "Dr Vos");
});

test("parseVtt reads a colon speaker prefix and skips NOTE blocks", () => {
  const vtt = [
    "WEBVTT",
    "",
    "NOTE this is a comment",
    "",
    "00:00:02.000 --> 00:00:03.000",
    "Dr Vos: Photosynthesis converts light.",
    "",
  ].join("\n");

  const segs = parseVtt(vtt);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].speaker, "Dr Vos");
  assert.equal(segs[0].text, "Photosynthesis converts light.");
});

test("parseVtt leaves a sentence containing a colon alone", () => {
  const vtt = [
    "WEBVTT",
    "",
    "00:00:02.000 --> 00:00:03.000",
    "Remember this: the mitochondrion is the powerhouse.",
    "",
  ].join("\n");

  const segs = parseVtt(vtt);
  assert.equal(segs[0].speaker, undefined);
  assert.equal(segs[0].text, "Remember this: the mitochondrion is the powerhouse.");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './transcript-import.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/transcript-import.ts`:

```ts
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
// Requiring letters/marks/apostrophes/dots/hyphens only, at most five words,
// keeps "Remember this: ..." from being mistaken for a speaker named
// "Remember this".
const SPEAKER_PREFIX = /^([\p{L}][\p{L}\p{M}'’.\-]*(?: [\p{L}][\p{L}\p{M}'’.\-]*){0,4}):\s+(.*)$/u;

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/transcript-import.ts src/lib/transcript-import.test.ts
git commit -m "feat: parse WebVTT transcripts with speaker attribution"
```

---

### Task 3: SRT and timestamped-text parsing

**Files:**
- Modify: `src/lib/transcript-import.ts`
- Modify: `src/lib/transcript-import.test.ts`

**Interfaces:**
- Consumes: `parseTimecode`, `splitSpeaker` from Task 2.
- Produces: `parseSrt(content: string): TranscriptSegment[]`, `parseTimestampedText(content: string): TranscriptSegment[]`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/transcript-import.test.ts` (and extend the import at the top of the file to include `parseSrt` and `parseTimestampedText`):

```ts
test("parseSrt reads numbered cues with comma millis", () => {
  const srt = [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "Dr Vos: Good morning.",
    "",
    "2",
    "00:00:04,000 --> 00:00:06,500",
    "Today we cover enzymes.",
    "",
  ].join("\n");

  const segs = parseSrt(srt);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].speaker, "Dr Vos");
  assert.equal(segs[0].text, "Good morning.");
  assert.equal(segs[1].end, 6.5);
});

test("parseTimestampedText reads the Teams Word export shape", () => {
  const txt = [
    "Berend Liem   0:03",
    "Are we recording?",
    "Dr Vos   0:09",
    "Yes. Let us start with enzymes.",
    "They lower activation energy.",
  ].join("\n");

  const segs = parseTimestampedText(txt);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].speaker, "Berend Liem");
  assert.equal(segs[0].start, 3);
  assert.equal(segs[0].text, "Are we recording?");
  assert.equal(segs[1].speaker, "Dr Vos");
  assert.equal(segs[1].text, "Yes. Let us start with enzymes. They lower activation energy.");
  // A segment with no end of its own runs up to the next segment's start.
  assert.equal(segs[0].end, 9);
});

test("parseTimestampedText reads the bracketed inline shape", () => {
  const txt = ["[00:00:10] Dr Vos: Enzymes are catalysts.", "[00:00:20] And they are reusable."].join("\n");

  const segs = parseTimestampedText(txt);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].start, 10);
  assert.equal(segs[0].speaker, "Dr Vos");
  assert.equal(segs[0].text, "Enzymes are catalysts.");
  assert.equal(segs[1].start, 20);
});

test("parseTimestampedText estimates an end for the final segment", () => {
  const segs = parseTimestampedText("Dr Vos   0:05\nOne two three four five six.");
  assert.equal(segs.length, 1);
  assert.ok(segs[0].end > segs[0].start, "final segment must have a positive duration");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `parseSrt is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/transcript-import.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/transcript-import.ts src/lib/transcript-import.test.ts
git commit -m "feat: parse SRT and timestamped-text transcripts"
```

---

### Task 4: Same-speaker merging and the format dispatcher

Teams emits one short cue per line. Left unmerged, summaries and flashcards are built from fragments instead of paragraphs. `mergeSameSpeaker` is exported on its own because Phase 4's diarization alignment reuses it — recorded and imported transcripts must segment identically.

**Files:**
- Modify: `src/lib/transcript-import.ts`
- Modify: `src/lib/transcript-import.test.ts`

**Interfaces:**
- Consumes: `parseVtt`, `parseSrt`, `parseTimestampedText` from Tasks 2-3.
- Produces:
  - `mergeSameSpeaker(segments: TranscriptSegment[], windowSec?: number): TranscriptSegment[]`
  - `segmentsToRawText(segments: TranscriptSegment[]): string`
  - `parseExternalTranscript(filename: string, content: string): ParsedTranscript`
  - `type ParsedTranscript = { segments: TranscriptSegment[]; speakers: string[]; format: "vtt" | "srt" | "text" }`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/transcript-import.test.ts` (extend the top-level import with `mergeSameSpeaker`, `segmentsToRawText`, `parseExternalTranscript`):

```ts
test("mergeSameSpeaker joins adjacent cues from one speaker inside the window", () => {
  const merged = mergeSameSpeaker(
    [
      { start: 0, end: 2, text: "Enzymes are catalysts.", speaker: "Dr Vos" },
      { start: 2, end: 4, text: "They lower activation energy.", speaker: "Dr Vos" },
      { start: 4, end: 6, text: "Any questions?", speaker: "Berend Liem" },
    ],
    15
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[0].text, "Enzymes are catalysts. They lower activation energy.");
  assert.equal(merged[0].start, 0);
  assert.equal(merged[0].end, 4);
  assert.equal(merged[1].speaker, "Berend Liem");
});

test("mergeSameSpeaker breaks when the gap exceeds the window", () => {
  const merged = mergeSameSpeaker(
    [
      { start: 0, end: 2, text: "Before the break.", speaker: "Dr Vos" },
      { start: 100, end: 102, text: "After the break.", speaker: "Dr Vos" },
    ],
    15
  );
  assert.equal(merged.length, 2);
});

test("mergeSameSpeaker merges unlabelled segments too", () => {
  const merged = mergeSameSpeaker(
    [
      { start: 0, end: 2, text: "One." },
      { start: 2, end: 4, text: "Two." },
    ],
    15
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, "One. Two.");
});

test("segmentsToRawText prefixes each speaker change", () => {
  const raw = segmentsToRawText([
    { start: 0, end: 2, text: "Good morning.", speaker: "Dr Vos" },
    { start: 2, end: 4, text: "Morning.", speaker: "Berend Liem" },
    { start: 4, end: 6, text: "No label here." },
  ]);
  assert.equal(raw, "Dr Vos: Good morning.\n\nBerend Liem: Morning.\n\nNo label here.");
});

test("parseExternalTranscript sniffs content when the extension lies", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Dr Vos>Hello.</v>\n";
  const parsed = parseExternalTranscript("meeting.txt", vtt);
  assert.equal(parsed.format, "vtt");
  assert.deepEqual(parsed.speakers, ["Dr Vos"]);
  assert.equal(parsed.segments.length, 1);
});

test("parseExternalTranscript returns nothing for text with no timestamps", () => {
  const parsed = parseExternalTranscript("notes.txt", "Just some prose with no times at all.");
  assert.equal(parsed.segments.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `mergeSameSpeaker is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/transcript-import.ts`:

```ts
export type ParsedTranscript = {
  segments: TranscriptSegment[];
  speakers: string[];
  format: "vtt" | "srt" | "text";
};

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
      if (prev.words && segment.words) prev.words = [...prev.words, ...segment.words];
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

  const segments = mergeSameSpeaker(parsed);
  const speakers = [...new Set(segments.map((s) => s.speaker).filter((s): s is string => !!s))];

  return { segments, speakers, format };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/transcript-import.ts src/lib/transcript-import.test.ts
git commit -m "feat: merge same-speaker cues and dispatch transcript formats"
```

---

### Task 5: Office XML text extraction

Kept separate from the unzip step so it is testable without building a zip file. Task 6 supplies the real archives.

**Files:**
- Create: `src/lib/office-xml.ts`
- Test: `src/lib/office-xml.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `slideXmlToText(xml: string): string`, `docxXmlToText(xml: string): string`, `sortSlideEntries(names: string[]): string[]`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/office-xml.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { slideXmlToText, docxXmlToText, sortSlideEntries } from "./office-xml.ts";

test("slideXmlToText joins the text runs on a slide", () => {
  const xml =
    '<p:sld><a:t>Enzyme kinetics</a:t><a:t>Michaelis</a:t><a:t>Menten</a:t></p:sld>';
  assert.equal(slideXmlToText(xml), "Enzyme kinetics Michaelis Menten");
});

test("slideXmlToText decodes entities and ignores empty runs", () => {
  const xml = '<p:sld><a:t>Rate &amp; yield</a:t><a:t></a:t><a:t>k &lt; 1</a:t></p:sld>';
  assert.equal(slideXmlToText(xml), "Rate & yield k < 1");
});

test("docxXmlToText puts a newline at each paragraph break", () => {
  const xml =
    "<w:body><w:p><w:r><w:t>Dr Vos   0:09</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Yes.</w:t></w:r><w:r><w:t> Let us start.</w:t></w:r></w:p></w:body>";
  assert.equal(docxXmlToText(xml), "Dr Vos   0:09\nYes. Let us start.");
});

test("docxXmlToText keeps significant whitespace in xml:space runs", () => {
  const xml = '<w:p><w:r><w:t xml:space="preserve">Berend   </w:t></w:r><w:r><w:t>0:03</w:t></w:r></w:p>';
  assert.equal(docxXmlToText(xml), "Berend   0:03");
});

test("sortSlideEntries orders numerically, not lexically", () => {
  const sorted = sortSlideEntries([
    "ppt/slides/slide10.xml",
    "ppt/slides/slide2.xml",
    "ppt/slides/slide1.xml",
    "ppt/slides/_rels/slide1.xml.rels",
    "docProps/core.xml",
  ]);
  assert.deepEqual(sorted, [
    "ppt/slides/slide1.xml",
    "ppt/slides/slide2.xml",
    "ppt/slides/slide10.xml",
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './office-xml.ts'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/office-xml.ts`:

```ts
// Pure string transforms over Office Open XML parts. No zip handling and no
// browser APIs live here, so these are directly testable; the unzip step lives
// in office-extract.ts.

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    // Ampersand last, or a doubly-encoded "&amp;lt;" would decode twice.
    .replace(/&amp;/g, "&");
}

/** Visible text of one `ppt/slides/slideN.xml` part, runs joined by spaces. */
export function slideXmlToText(xml: string): string {
  const runs = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
    .map((m) => decodeEntities(m[1]).trim())
    .filter(Boolean);
  return runs.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Visible text of `word/document.xml`. Paragraph boundaries become newlines,
 * which is what the timestamped-text transcript parser keys off, so runs
 * inside one paragraph must not be split.
 */
export function docxXmlToText(xml: string): string {
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((m) => {
    const runs = [...m[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((r) =>
      decodeEntities(r[1])
    );
    return runs.join("").replace(/[ \t]+$/g, (tail) => tail);
  });

  return paragraphs
    .map((p) => p.replace(/\s+$/, "").replace(/^\s+/, ""))
    .filter((p) => p.length > 0)
    .join("\n");
}

/** Slide parts in presentation order — slide10 sorts after slide2, not before. */
export function sortSlideEntries(names: string[]): string[] {
  return names
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
}

function slideNumber(name: string): number {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 20 tests. The `xml:space` test is the one most likely to fail — if it does, the fix is in `docxXmlToText`'s trimming, not in the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/office-xml.ts src/lib/office-xml.test.ts
git commit -m "feat: extract text from pptx and docx xml parts"
```

---

### Task 6: Browser-side pptx/docx unzipping

**Files:**
- Create: `src/lib/office-extract.ts`
- Modify: `package.json` (add `fflate`)

**Interfaces:**
- Consumes: `slideXmlToText`, `docxXmlToText`, `sortSlideEntries` from Task 5.
- Produces:
  - `extractPptxText(file: File): Promise<{ text: string; slideCount: number }>`
  - `extractDocxText(file: File): Promise<string>`

- [ ] **Step 1: Install the dependency**

Run: `npm install fflate`
Expected: `fflate` appears under `"dependencies"` in `package.json`. This is the only new runtime dependency permitted in Phase 1.

- [ ] **Step 2: Write the implementation**

Create `src/lib/office-extract.ts`:

```ts
"use client";

// pptx/docx are zip archives of XML parts. Unzipping in the browser keeps the
// original file off the server entirely — only the extracted text is uploaded,
// matching how pdf-extract.ts already works.

import { unzipSync, strFromU8 } from "fflate";
import { slideXmlToText, docxXmlToText, sortSlideEntries } from "@/lib/office-xml";

async function unzip(file: File): Promise<Record<string, Uint8Array>> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  try {
    return unzipSync(buffer);
  } catch {
    throw new Error("That file isn't a readable Office document.");
  }
}

/**
 * Slide text, one `Slide N: …` block per slide so retrieval can cite a slide
 * number. Slides with no text (image-only) are skipped but still counted.
 */
export async function extractPptxText(file: File): Promise<{ text: string; slideCount: number }> {
  const entries = await unzip(file);
  const slides = sortSlideEntries(Object.keys(entries));

  const blocks: string[] = [];
  slides.forEach((name, index) => {
    const text = slideXmlToText(strFromU8(entries[name]));
    if (text) blocks.push(`Slide ${index + 1}: ${text}`);
  });

  return { text: blocks.join("\n\n").trim(), slideCount: slides.length };
}

/** Document body text, paragraphs separated by newlines. */
export async function extractDocxText(file: File): Promise<string> {
  const entries = await unzip(file);
  const document = entries["word/document.xml"];
  if (!document) throw new Error("That .docx has no document body.");
  return docxXmlToText(strFromU8(document));
}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify the build still passes**

Run: `npm run build`
Expected: build succeeds. `fflate` is isomorphic, but `office-extract.ts` is marked `"use client"` so it is never evaluated during SSR.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/office-extract.ts
git commit -m "feat: unzip pptx and docx in the browser via fflate"
```

---

### Task 7: The `Material` model

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_material/migration.sql` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `db.material` with fields `id`, `folderId`, `kind` (`SYLLABUS | SLIDES | READING | OTHER`), `title`, `sourceFileName`, `text`, `slideCount`, `createdAt`, `updatedAt`, and `folder.materials`.

- [ ] **Step 1: Add the enum and model**

In `prisma/schema.prisma`, add the enum beside the other enums:

```prisma
enum MaterialKind {
  SYLLABUS
  SLIDES
  READING
  OTHER
}
```

Add the model after `Folder`:

```prisma
model Material {
  id             String       @id @default(cuid())
  folderId       String
  kind           MaterialKind
  title          String
  sourceFileName String?
  text           String
  slideCount     Int?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  folder Folder @relation(fields: [folderId], references: [id], onDelete: Cascade)

  @@index([folderId, kind])
}
```

Add the back-relation to `Folder`, next to its existing `pages Page[]`:

```prisma
  materials Material[]
```

- [ ] **Step 2: Create and apply the migration**

Run: `npx prisma migrate dev --name material`
Expected: a new folder under `prisma/migrations/`, the migration applied to `prisma/dev.db`, and the client regenerated into `src/generated/prisma`.

- [ ] **Step 3: Verify the client has the model**

Run: `npx tsx -e "import {db} from './src/lib/db.ts'; db.material.count().then(n => console.log('materials:', n))"`
Expected: `materials: 0`. If the import fails on the alias, run the same statement with a relative import path.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/generated/prisma
git commit -m "feat: add course-scoped Material model"
```

---

### Task 8: Materials API

**Files:**
- Modify: `src/lib/validation.ts`
- Create: `src/app/api/folders/[id]/materials/route.ts`
- Create: `src/app/api/materials/[id]/route.ts`

**Interfaces:**
- Consumes: `db.material` from Task 7; `withValidation`, `jsonError` from `src/lib/api-utils.ts`.
- Produces:
  - `createMaterialSchema` in `src/lib/validation.ts`
  - `POST /api/folders/[id]/materials` → `{ material }`, 201
  - `GET /api/folders/[id]/materials` → `{ materials }` (no `text`; list view only)
  - `DELETE /api/materials/[id]` → `{ ok: true }`

- [ ] **Step 1: Add the schema**

In `src/lib/validation.ts`, after `createPageFromTextSchema`:

```ts
export const createMaterialSchema = z.object({
  kind: z.enum(["SYLLABUS", "SLIDES", "READING", "OTHER"]),
  title: z.string().trim().min(1).max(300),
  // Same ceiling as an imported lecture body; a slide deck's text is far
  // smaller than this in practice.
  text: z.string().trim().min(1).max(500_000),
  sourceFileName: z.string().trim().max(300).optional(),
  slideCount: z.number().int().min(0).max(10_000).optional(),
});
```

- [ ] **Step 2: Write the collection route**

Create `src/app/api/folders/[id]/materials/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createMaterialSchema } from "@/lib/validation";
import { jsonError, withValidation } from "@/lib/api-utils";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // `text` is deliberately not selected: the list view never shows it and a
  // course's decks together can run to megabytes.
  const materials = await db.material.findMany({
    where: { folderId: id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      kind: true,
      title: true,
      sourceFileName: true,
      slideCount: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ materials });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(createMaterialSchema, body);
  if ("error" in result) return result.error;

  const folder = await db.folder.findUnique({ where: { id }, select: { id: true } });
  if (!folder) return jsonError("Course not found", 404);

  const material = await db.material.create({
    data: { folderId: id, ...result.data },
  });

  return NextResponse.json({ material: { ...material, text: undefined } }, { status: 201 });
}
```

- [ ] **Step 3: Write the item route**

Create `src/app/api/materials/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.material.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Exercise both routes against the running app**

Run in one terminal: `npm run dev`

Then, substituting a real course id from `npx prisma studio` or the URL of any course page:

```bash
FOLDER=<a real folder id>
curl -s -X POST localhost:3000/api/folders/$FOLDER/materials \
  -H 'Content-Type: application/json' \
  -d '{"kind":"SYLLABUS","title":"Test syllabus","text":"Week 1: enzymes"}'
curl -s localhost:3000/api/folders/$FOLDER/materials
curl -s -X POST localhost:3000/api/folders/does-not-exist/materials \
  -H 'Content-Type: application/json' \
  -d '{"kind":"SYLLABUS","title":"x","text":"y"}'
curl -s -X POST localhost:3000/api/folders/$FOLDER/materials \
  -H 'Content-Type: application/json' -d '{"kind":"NOPE","title":"x","text":"y"}'
```

Expected: 201 with a material; a list containing it and **no `text` field**; `{"error":"Course not found"}` with status 404; and a 422 validation error for the bad `kind`.

- [ ] **Step 5: Clean up the test row and commit**

Delete the test material with `curl -s -X DELETE localhost:3000/api/materials/<id>`, then:

```bash
git add src/lib/validation.ts src/app/api/folders src/app/api/materials
git commit -m "feat: materials API for course-scoped study material"
```

---

### Task 9: Material upload UI

**Files:**
- Create: `src/components/dashboard/MaterialUploadButton.tsx`
- Create: `src/components/dashboard/MaterialList.tsx`

**Interfaces:**
- Consumes: `extractPptxText` (Task 6), `extractPdfText` from `src/lib/pdf-extract.ts`, `POST /api/folders/[id]/materials` and `DELETE /api/materials/[id]` (Task 8).
- Produces: `<MaterialUploadButton folderId={string} />`, `<MaterialList materials={MaterialSummary[]} />` where `MaterialSummary = { id: string; kind: string; title: string; sourceFileName: string | null; slideCount: number | null; createdAt: Date }`.

- [ ] **Step 1: Write the upload button**

Create `src/components/dashboard/MaterialUploadButton.tsx`. It mirrors `ImportButton.tsx`, which is the established pattern for client-side extraction in this codebase — read that file first.

```tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { extractPdfText } from "@/lib/pdf-extract";
import { extractPptxText } from "@/lib/office-extract";

const KINDS = [
  { value: "SYLLABUS", label: "Syllabus" },
  { value: "SLIDES", label: "Slides" },
  { value: "READING", label: "Reading" },
  { value: "OTHER", label: "Other" },
] as const;

type Kind = (typeof KINDS)[number]["value"];

export function MaterialUploadButton({ folderId }: { folderId: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("SLIDES");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [slideCount, setSlideCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const isPptx = /\.pptx$/i.test(file.name);
      const extracted = isPptx ? await extractPptxText(file) : { text: await extractPdfText(file), slideCount: null };

      if (!extracted.text) {
        setError(
          isPptx
            ? "That deck has no selectable text — image-only slides aren't supported."
            : "Couldn't find any selectable text in that PDF (scanned images aren't supported)."
        );
        return;
      }

      setText(extracted.text);
      setSlideCount(extracted.slideCount);
      setSourceFileName(file.name);
      if (!title.trim()) setTitle(file.name.replace(/\.(pptx|pdf)$/i, ""));
      if (isPptx) setKind("SLIDES");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/folders/${folderId}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          text,
          sourceFileName: sourceFileName ?? undefined,
          slideCount: slideCount ?? undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save that material.");
        return;
      }
      setOpen(false);
      setTitle("");
      setText("");
      setSourceFileName(null);
      setSlideCount(null);
      router.refresh();
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" strokeWidth={2} />
        Add material
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add course material">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex gap-1 rounded-lg border border-zinc-200 p-0.5 text-[12.5px] font-medium">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className={
                  kind === k.value
                    ? "flex-1 rounded-md bg-brand-soft px-2 py-1 text-brand"
                    : "flex-1 rounded-md px-2 py-1 text-zinc-500 hover:text-zinc-700"
                }
              >
                {k.label}
              </button>
            ))}
          </div>

          <Input
            autoFocus
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 px-4 py-3 text-[13px] text-zinc-500 transition-colors hover:border-brand-border hover:bg-brand-soft/40"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-brand" strokeWidth={2} />
            ) : (
              <FileText className="h-4 w-4 text-brand" strokeWidth={2} />
            )}
            {busy ? "Extracting text…" : "Choose a PDF or PowerPoint"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />

          {text && (
            <p className="text-[12.5px] text-zinc-500">
              {slideCount !== null ? `${slideCount} slides · ` : ""}
              {text.length.toLocaleString()} characters extracted in your browser. The file itself is
              never uploaded.
            </p>
          )}

          {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={submitting || !title.trim() || !text.trim()}>
              {submitting ? "Saving…" : "Save material"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 2: Write the list**

Create `src/components/dashboard/MaterialList.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Presentation, ScrollText, Trash2 } from "lucide-react";
import { shortDate } from "@/lib/format";

export type MaterialSummary = {
  id: string;
  kind: string;
  title: string;
  sourceFileName: string | null;
  slideCount: number | null;
  createdAt: Date;
};

const ICONS: Record<string, typeof FileText> = {
  SYLLABUS: ScrollText,
  SLIDES: Presentation,
  READING: FileText,
  OTHER: FileText,
};

export function MaterialList({ materials }: { materials: MaterialSummary[] }) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const router = useRouter();

  async function remove(id: string) {
    setDeleting(id);
    try {
      await fetch(`/api/materials/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setDeleting(null);
    }
  }

  if (materials.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-14 text-center text-sm text-zinc-400">
        No materials yet. Add the syllabus and the lecturer&apos;s slides so this course knows what it
        covers.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {materials.map((material) => {
        const Icon = ICONS[material.kind] ?? FileText;
        return (
          <li
            key={material.id}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Icon className="h-4 w-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-zinc-900">{material.title}</p>
              <p className="truncate text-[12.5px] text-zinc-400">
                {material.kind.toLowerCase()}
                {material.slideCount !== null ? ` · ${material.slideCount} slides` : ""}
                {` · ${shortDate(material.createdAt)}`}
              </p>
            </div>
            <button
              onClick={() => remove(material.id)}
              disabled={deleting === material.id}
              aria-label={`Delete ${material.title}`}
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `shortDate` does not accept a `Date`, match its real signature rather than changing it.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/MaterialUploadButton.tsx src/components/dashboard/MaterialList.tsx
git commit -m "feat: upload and list course materials"
```

---

### Task 10: Course page tabs

**Files:**
- Modify: `src/app/folders/[folderId]/page.tsx`

**Interfaces:**
- Consumes: `MaterialUploadButton`, `MaterialList` (Task 9); `PageTabs` from `src/components/page-detail/PageTabs.tsx`.
- Produces: a tabbed course page — Lectures and Materials.

- [ ] **Step 1: Rewrite the course page**

Replace `src/app/folders/[folderId]/page.tsx` with:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { db } from "@/lib/db";
import { PageList } from "@/components/dashboard/PageList";
import { NewPageButton } from "@/components/dashboard/NewPageButton";
import { ImportButton } from "@/components/dashboard/ImportButton";
import { FolderHeader } from "@/components/dashboard/FolderHeader";
import { PageTabs } from "@/components/page-detail/PageTabs";
import { MaterialUploadButton } from "@/components/dashboard/MaterialUploadButton";
import { MaterialList } from "@/components/dashboard/MaterialList";

export const dynamic = "force-dynamic";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) notFound();

  const [pages, quizCount, materials] = await Promise.all([
    db.page.findMany({
      where: { folderId },
      orderBy: { updatedAt: "desc" },
      include: {
        folder: true,
        tags: { include: { tag: true } },
        _count: { select: { flashcards: true, quizQuestions: true } },
      },
    }),
    db.quizQuestion.count({ where: { page: { folderId } } }),
    db.material.findMany({
      where: { folderId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        kind: true,
        title: true,
        sourceFileName: true,
        slideCount: true,
        createdAt: true,
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight text-gradient">{folder.name}</h1>
        <div className="flex items-center gap-2">
          {quizCount > 0 && (
            <Link
              href={`/folders/${folder.id}/cram`}
              className="inline-flex items-center gap-1.5 rounded-lg grad-brand px-3 py-2 text-sm font-medium text-white shadow-brand transition-opacity hover:opacity-95"
            >
              <GraduationCap className="h-4 w-4" strokeWidth={2} />
              Exam cram
            </Link>
          )}
          <NewPageButton folderId={folder.id} />
          <FolderHeader folderId={folder.id} name={folder.name} />
        </div>
      </div>

      <PageTabs
        tabs={[
          {
            id: "lectures",
            label: `Lectures (${pages.length})`,
            content: (
              <div className="flex flex-col gap-4">
                <div className="flex justify-end">
                  <ImportButton folderId={folder.id} />
                </div>
                <PageList pages={pages} />
              </div>
            ),
          },
          {
            id: "materials",
            label: `Materials (${materials.length})`,
            content: (
              <div className="flex flex-col gap-4">
                <div className="flex justify-end">
                  <MaterialUploadButton folderId={folder.id} />
                </div>
                <MaterialList materials={materials} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify in the browser**

Run: `npm run dev`, then open a course page.
Expected: two tabs. Materials starts on the empty state; adding a PowerPoint through **Add material** shows it in the list with its slide count; the delete button removes it. The Lectures tab still lists lectures exactly as before.

- [ ] **Step 3: Commit**

```bash
git add "src/app/folders/[folderId]/page.tsx"
git commit -m "feat: tab the course page into lectures and materials"
```

---

### Task 11: Import an external transcript into a lecture

**Files:**
- Modify: `src/lib/validation.ts`
- Modify: `src/app/api/pages/from-text/route.ts`
- Create: `src/components/dashboard/TranscriptImportButton.tsx`
- Modify: `src/app/folders/[folderId]/page.tsx` (place the button in the Lectures tab)

**Interfaces:**
- Consumes: `parseExternalTranscript`, `segmentsToRawText` (Task 4); `extractDocxText` (Task 6).
- Produces: `createPageFromTextSchema` gains optional `segments` and `source`; `POST /api/pages/from-text` persists real segments.

- [ ] **Step 1: Extend the schema**

In `src/lib/validation.ts`, replace `createPageFromTextSchema` with:

```ts
const transcriptSegmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().trim().min(1).max(10_000),
  speaker: z.string().trim().max(120).optional(),
});

export const createPageFromTextSchema = z.object({
  title: z.string().trim().min(1).max(300),
  text: z.string().trim().min(1).max(500_000),
  folderId: z.string().trim().min(1).optional(),
  // Present when the text came from a timestamped transcript rather than a
  // paste or a PDF. Storing the segments is what makes chapters, subtitle
  // export, and timestamped navigation work on an imported meeting.
  segments: z.array(transcriptSegmentSchema).max(20_000).optional(),
  // Provenance, recorded in Transcript.modelUsed. Constrained because it is
  // written to a column other code reads back.
  source: z.enum(["teams", "zoom", "otter", "subtitles", "import"]).optional(),
});
```

- [ ] **Step 2: Persist the segments**

In `src/app/api/pages/from-text/route.ts`, replace the destructuring and the `transcript.create` call:

```ts
  const { title, text, folderId, segments, source } = result.data;

  const page = await db.page.create({
    data: { title, folderId, status: "TRANSCRIBED" },
  });

  await db.transcript.create({
    data: {
      pageId: page.id,
      rawText: text,
      segments: JSON.stringify(segments ?? []),
      modelUsed: source ? `import:${source}` : "import",
    },
  });
```

Leave the `upsertSearchIndex(page.id)` call and the response exactly as they are.

- [ ] **Step 3: Write the import button**

Create `src/components/dashboard/TranscriptImportButton.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileAudio, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { extractDocxText } from "@/lib/office-extract";
import { parseExternalTranscript, segmentsToRawText } from "@/lib/transcript-import";

export function TranscriptImportButton({ folderId }: { folderId?: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [parsed, setParsed] = useState<ReturnType<typeof parseExternalTranscript> | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const content = /\.docx$/i.test(file.name) ? await extractDocxText(file) : await file.text();
      const result = parseExternalTranscript(file.name, content);

      if (result.segments.length === 0) {
        setError(
          "No timestamped lines found in that file. Teams, Zoom, and Otter exports work; a plain paste should use Import instead."
        );
        return;
      }

      setParsed(result);
      if (!title.trim()) setTitle(file.name.replace(/\.(vtt|srt|docx|txt)$/i, ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !parsed) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pages/from-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          text: segmentsToRawText(parsed.segments),
          folderId,
          segments: parsed.segments,
          source: parsed.format === "text" ? "import" : "subtitles",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not import that transcript.");
        return;
      }
      router.push(`/pages/${data.page.id}`);
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <FileAudio className="h-4 w-4" strokeWidth={2} />
        Import transcript
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Import a transcript">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            autoFocus
            placeholder="Lecture title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-300 px-4 py-3 text-[13px] text-zinc-500 transition-colors hover:border-brand-border hover:bg-brand-soft/40"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin text-brand" strokeWidth={2} />
            ) : (
              <FileAudio className="h-4 w-4 text-brand" strokeWidth={2} />
            )}
            {busy ? "Reading…" : "Choose a .vtt, .srt, .docx or .txt transcript"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".vtt,.srt,.docx,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />

          {parsed && (
            <p className="text-[12.5px] text-zinc-500">
              {parsed.segments.length} segments
              {parsed.speakers.length > 0 ? ` · ${parsed.speakers.join(", ")}` : " · no speaker labels"}
            </p>
          )}

          {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="brand" disabled={submitting || !title.trim() || !parsed}>
              {submitting ? "Importing…" : "Import"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 4: Put the button on the course page**

In `src/app/folders/[folderId]/page.tsx`, import it:

```tsx
import { TranscriptImportButton } from "@/components/dashboard/TranscriptImportButton";
```

and in the Lectures tab, replace the single-button row with:

```tsx
                <div className="flex justify-end gap-2">
                  <TranscriptImportButton folderId={folder.id} />
                  <ImportButton folderId={folder.id} />
                </div>
```

- [ ] **Step 5: Verify end to end with a real Teams-shaped file**

Save this as `/tmp/lecture.vtt`:

```
WEBVTT

c1
00:00:01.000 --> 00:00:04.000
<v Dr Vos>Enzymes are biological catalysts.</v>

c2
00:00:04.500 --> 00:00:07.000
<v Dr Vos>They lower the activation energy of a reaction.</v>

c3
00:00:30.000 --> 00:00:33.000
<v Berend Liem>Does that change the equilibrium?</v>

c4
00:00:33.500 --> 00:00:37.000
<v Dr Vos>No. Only the rate.</v>
```

Run `npm run dev`, open a course, and import it.
Expected: the modal reports **3 segments · Dr Vos, Berend Liem** — three, not four, because Dr Vos's first two cues merge. The new lecture page opens showing timestamped lines. The transcript tab shows no audio player and does not crash.

- [ ] **Step 6: Commit**

```bash
git add src/lib/validation.ts src/app/api/pages/from-text/route.ts src/components/dashboard/TranscriptImportButton.tsx "src/app/folders/[folderId]/page.tsx"
git commit -m "feat: import Teams, Zoom and Otter transcripts with timings and speakers"
```

---

### Task 12: Show speakers, and render segments with no audio

An imported transcript has segments but no audio file. `TranscriptTab` already falls through to `TranscriptView` in that case, but `TranscriptView` drops the speaker, and the chapter button is gated correctly — this task confirms the first and fixes the second.

**Files:**
- Modify: `src/components/page-detail/TranscriptView.tsx`

**Interfaces:**
- Consumes: `TranscriptSegment.speaker` (Task 1).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Render the speaker on change**

Replace the mapping body in `src/components/page-detail/TranscriptView.tsx`:

```tsx
import type { TranscriptSegment } from "@/types";

export function TranscriptView({
  rawText,
  segments,
}: {
  rawText: string;
  segments: TranscriptSegment[];
}) {
  if (segments.length === 0) {
    return <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">{rawText}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {segments.map((segment, i) => {
        // Label only when the speaker changes: a name on every line of a
        // 400-cue Teams transcript is noise, not information.
        const showSpeaker = !!segment.speaker && segment.speaker !== segments[i - 1]?.speaker;
        return (
          <div key={i} className="flex flex-col gap-0.5">
            {showSpeaker && (
              <span className="pl-[4.25rem] text-[12.5px] font-semibold text-brand">
                {segment.speaker}
              </span>
            )}
            <div className="flex gap-3 text-sm leading-6">
              <span className="w-14 shrink-0 font-mono text-xs text-zinc-400">
                {formatTimestamp(segment.start)}
              </span>
              <span className="text-zinc-700">{segment.text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 2: Verify chapters work on an imported transcript**

On the lecture imported in Task 11, open the Transcript tab.
Expected: speaker names appear above the first line of each turn. The **Detect chapters** button is hidden, because that import produced only 3 segments and the button requires 4 — import a longer Teams file to see it appear and succeed.

- [ ] **Step 3: Verify subtitle export works on an imported transcript**

Run: `curl -s "localhost:3000/api/pages/<imported page id>/export/subtitles?format=srt" | head -8`
Expected: valid SubRip output with the imported timings — not the 422 "no timestamped segments" error, which is what a flat-text import would have produced.

- [ ] **Step 4: Commit**

```bash
git add src/components/page-detail/TranscriptView.tsx
git commit -m "feat: show speaker labels on imported transcripts"
```

---

### Task 13: Vocabulary pass

**Files:**
- Modify: `src/components/dashboard/FolderSidebar.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/dashboard/FolderHeader.tsx`
- Modify: any other file surfaced by the grep in Step 1

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. User-facing strings only — no model, route, component, or variable is renamed.

- [ ] **Step 1: Find every user-facing "folder"**

Run: `grep -rn "[Ff]older" src --include=*.tsx | grep -v "folderId\|folderName\|FolderIcon\|FolderSidebar\|FolderHeader\|folder\.\|folder?\.\|folders/\|@/lib/folder-colors\|folderFamily\|FOLDER_ICON"`
Expected: a short list of display strings — the sidebar's "Folders" heading, the new-folder modal's title and placeholder, empty-state copy.

- [ ] **Step 2: Replace only the display strings**

Change each to "Course" / "Courses" (for example: the sidebar heading "Folders" → "Courses"; "New folder" → "New course"; the placeholder "Folder name" → "Course name"). **Do not** rename `Folder` in Prisma, the `/folders` routes, the `FolderSidebar` / `FolderHeader` components, or any `folderId` variable — the spec fixes the model name deliberately.

- [ ] **Step 3: Say what a course is on the dashboard**

In `src/app/page.tsx`, change the subtitle under "Library" to:

```tsx
          <p className="mt-0.5 text-[13px] text-zinc-500">Every lecture you&apos;ve captured, filed by course.</p>
```

- [ ] **Step 4: Verify the routes still work**

Run: `npm run build`
Expected: build succeeds. Then with `npm run dev`, confirm the sidebar creates a course, the course page loads, and both tabs work.

- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor: say course, not folder, in user-facing copy"
```

---

### Task 14: Phase acceptance

**Files:** none.

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS, 20 tests, no failures.

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all three clean.

- [ ] **Step 3: Walk the acceptance criteria**

With `npm run dev`, on one course:

1. Upload a syllabus PDF → appears under Materials as `syllabus`.
2. Upload a `.pptx` deck → appears with its slide count; open `npx prisma studio` and confirm its `text` contains `Slide 1: …` blocks.
3. Import a Teams `.vtt` → a lecture appears with speaker-labelled, timestamped lines.
4. On a transcript with ≥4 segments, **Detect chapters** succeeds.
5. `GET /api/pages/<id>/export/subtitles?format=srt` returns real cues.
6. Delete a material → it disappears and the count in the tab label drops.

Expected: all six. Any failure is a bug in this phase, not a Phase 2 concern.

- [ ] **Step 4: Commit anything outstanding**

```bash
git status
```

Expected: clean. The phase is complete.
