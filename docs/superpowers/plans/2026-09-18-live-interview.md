# Live Interview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hands-free spoken interview (Viva, Protégé, Debate). The tutor corrects mistakes with worked examples from the course material, captions highlight each word as it is spoken, and a transcript with a "What to fix" study sheet appears at the end.

**Architecture:** The server streams the tutor's reply as NDJSON from a new `live-turn` route; the reply ends in a hidden `@@GRADE` JSON line that the server strips out and stores. The client cuts the stream into sentences with `Intl.Segmenter`, speaks each one through the existing Kokoro `say()`, and estimates word timings from each sentence's audio duration. A mic hook with an energy-based voice detector ends the student's turn after silence and handles barge-in. The student's words are transcribed by the existing Whisper/mac-speech route, and Chrome's `SpeechRecognition` shows them live as interim captions.

**Tech Stack:** Next.js 16 route handlers, Prisma (SQLite), React 19 client components, Web Audio API, MediaRecorder, Web Speech API, Kokoro (existing `src/lib/speech.ts`), OpenRouter/Ollama through `src/lib/llm.ts`, `node --test` with tsx.

**Spec:** `docs/superpowers/specs/2026-09-18-live-interview-design.md`

## Global Constraints

- No new npm dependencies.
- Tests: `npm test` (runs `node --import tsx --test "src/lib/**/*.test.ts"`). Test files import the module under test with a relative `./name.ts` path, as `src/lib/debate.test.ts` does.
- Type check: `npx tsc --noEmit`. Lint the files you touched: `npx eslint <files>`.
- Timings: silence ends a turn after **1200 ms**; barge-in needs **300 ms** of sustained speech; speech onset while listening is **150 ms**.
- The tutor gets **one** retry per missed question. It should keep each reply under about **120** spoken words.
- Debate voices: Proponent `am_michael`, Skeptic `bf_emma`. The Viva/Protégé tutor uses the student's read-aloud voice (`lectern.readAloud` prefs).
- Every new prompt keeps `UNTRUSTED_CONTENT_CLAUSE`.
- Per-browser live settings live in `localStorage` key `lectern.live`. Every read and write is wrapped in try/catch.
- **The migration is applied by the human, not an agent.** `npm run db:migrate` backs up the real database first. Agents write the SQL file and run `npx prisma generate` only.
- Commits use conventional prefixes (`feat:`, `fix:`, `refactor:`, `docs:`) and end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Match the repo's comment style: short comments that explain *why*. Leave no dead code or unused imports.

## Adjustments to the spec made while planning

These follow the code as it exists. They are recorded here so reviewers don't flag them as drift:

1. **Entry point.** Live mode is turned on by a "Talk it through" button on the session page, and turned off by "Switch to typing" (`PATCH /api/interview/[id]` with `{ live }`), not by a choice on the start form. Five components create sessions, and one button on the page covers all of them.
2. **Stream framing.** Both routes send NDJSON events, the same pattern as `folders/[id]/study-plan`, instead of `text/plain`.
3. **Debate.** A new `debate/live` route streams **one agent per request** instead of a `live` flag on `debate/advance`. This way a barge-in never produces an utterance the student didn't hear.
4. **Reducer.** Barge-in goes straight from `speaking` to `listening`; there is no separate `interrupted` phase.
5. **Debate interjections** don't record the transcript source. The existing interject route and schema stay unchanged.

## File map

| File | Responsibility |
|---|---|
| `src/lib/stream-lines.ts` (new) | NDJSON and SSE framing over fetch bodies |
| `src/lib/live-text.ts` (new) | Streaming sentence splitter, `@@GRADE` trailer filter, word timing, spoken offsets |
| `src/lib/live-interview.ts` (new) | Zod schemas, `LiveFeedback`, retry policy, voice detector, turn reducer, end command, event types |
| `src/lib/live-transcript.ts` (new) | Transcript lines, "What to fix" cards, Markdown export |
| `src/lib/course-grounding.ts` (new) | `searchCourse` wrapper that degrades to no grounding |
| `src/lib/interview-grade.ts` (new) | Grading and next-question calls, extracted from the answer route |
| `src/lib/prompts/live.ts` (new) | Live tutor prompts |
| `src/lib/prompts/shared.ts` | Add `LIVE_TUTOR_RULES` |
| `src/lib/prompts/interview.ts` | Export `describeContext` |
| `src/lib/prompts/debate.ts` | Export `renderSources`; add the live system prompt and live options |
| `src/lib/debate.ts` | Add `toDebateTurns`, `debateTexts` |
| `src/lib/openrouter.ts`, `src/lib/ollama.ts`, `src/lib/llm.ts` | Streaming calls |
| `src/lib/speech.ts` | `onWord` callback on `say()` |
| `prisma/schema.prisma` + migration | `live`, `spoken`, `interruptedAt`, `retryOf` |
| `src/app/api/interview/[id]/route.ts` | `PATCH` live toggle |
| `src/app/api/interview/[id]/answer/route.ts` | Use `interview-grade.ts` |
| `src/app/api/interview/[id]/live-turn/route.ts` (new) | Streamed Viva/Protégé turn |
| `src/app/api/interview/[id]/live-turn/interrupt/route.ts` (new) | Record the barge-in offset |
| `src/app/api/interview/[id]/debate/live/route.ts` (new) | Streamed single debate agent |
| `src/app/api/interview/[id]/debate/advance/route.ts`, `.../interject/route.ts` | Use the shared debate helpers |
| `src/components/recording/useMediaRecorder.ts` | Export `pickSupportedMimeType` |
| `src/components/page-detail/ReadAloudBar.tsx` | Export `readPrefs` |
| `src/components/interview/live/useLiveMic.ts` (new) | Open mic, level meter, voice detection, per-utterance recorder |
| `src/components/interview/live/useBrowserRecognition.ts` (new) | Chrome interim captions |
| `src/components/interview/live/useSpeechQueue.ts` (new) | Sentence queue over `say()`, caption state, interrupt offset |
| `src/components/interview/live/CaptionStrip.tsx` (new) | Word-highlight captions |
| `src/components/interview/live/LiveControls.tsx` (new) | Phase, CC toggle, sensitivity, End, Switch to typing |
| `src/components/interview/live/LiveSession.tsx` (new) | Viva/Protégé live loop |
| `src/components/interview/live/LiveDebate.tsx` (new) | Debate live loop |
| `src/components/interview/live/LiveTranscript.tsx` (new) | End-of-session transcript |
| `src/components/interview/GoLiveButton.tsx` (new) | "Talk it through" toggle |
| `src/app/interview/[id]/page.tsx` | Choose the live, transcript, or typed view |
| `README.md` | Document live mode |

---

### Task 1: Stream framing (`stream-lines.ts`)

**Files:**
- Create: `src/lib/stream-lines.ts`
- Test: `src/lib/stream-lines.test.ts`

**Interfaces:**
- Produces: `createNdjsonReader(): { push(chunk: string): unknown[]; flush(): unknown[] }`, `createSseReader(): { push(chunk: string): string[]; flush(): string[] }`, `ndjsonEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown>`, `sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string>`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/stream-lines.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createNdjsonReader, createSseReader, ndjsonEvents, sseData } from "./stream-lines.ts";

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

test("ndjson: a line split across chunks arrives once, whole", () => {
  const r = createNdjsonReader();
  assert.deepEqual(r.push('{"a":1}\n{"b"'), [{ a: 1 }]);
  assert.deepEqual(r.push(':2}\n'), [{ b: 2 }]);
  assert.deepEqual(r.flush(), []);
});

test("ndjson: a garbled line is dropped, not thrown", () => {
  const r = createNdjsonReader();
  assert.deepEqual(r.push('nope\n{"ok":true}\n'), [{ ok: true }]);
});

test("ndjson: flush returns an unterminated last line", () => {
  const r = createNdjsonReader();
  assert.deepEqual(r.push('{"x":1}'), []);
  assert.deepEqual(r.flush(), [{ x: 1 }]);
});

test("sse: data payloads only, without [DONE] or comments, CRLF tolerated", () => {
  const r = createSseReader();
  assert.deepEqual(r.push(": keep-alive\r\ndata: {\"a\":1}\r\n\r\ndata: [DO"), ['{"a":1}']);
  assert.deepEqual(r.push("NE]\n"), []);
});

test("ndjsonEvents reads a fetch body", async () => {
  const out: unknown[] = [];
  for await (const e of ndjsonEvents(bodyOf(['{"a":1}\n{"b"', ':2}\n']))) out.push(e);
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
});

test("sseData reads a fetch body", async () => {
  const out: string[] = [];
  for await (const d of sseData(bodyOf(["data: one\n", "data: two\ndata: [DONE]\n"]))) out.push(d);
  assert.deepEqual(out, ["one", "two"]);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --import tsx --test src/lib/stream-lines.test.ts`
Expected: FAIL, "Cannot find module ... stream-lines.ts".

- [ ] **Step 3: Implement**

```ts
// src/lib/stream-lines.ts
/**
 * Line framing for streamed responses. A network chunk can end mid-line, so
 * each reader keeps the unfinished tail until the next chunk completes it.
 */
function createLineSplitter() {
  let tail = "";
  return {
    push(chunk: string): string[] {
      tail += chunk;
      const lines = tail.split("\n");
      tail = lines.pop() ?? "";
      return lines;
    },
    flush(): string[] {
      const rest = tail;
      tail = "";
      return rest.trim() ? [rest] : [];
    },
  };
}

/** Newline-delimited JSON. A garbled line is dropped: one bad event must not end the stream. */
export function createNdjsonReader() {
  const lines = createLineSplitter();
  const parse = (batch: string[]): unknown[] =>
    batch.flatMap((line) => {
      const trimmed = line.trim();
      if (!trimmed) return [];
      try {
        return [JSON.parse(trimmed) as unknown];
      } catch {
        return [];
      }
    });
  return { push: (chunk: string) => parse(lines.push(chunk)), flush: () => parse(lines.flush()) };
}

/** Server-sent events: the `data:` payloads, without OpenRouter's `[DONE]` sentinel or its comment lines. */
export function createSseReader() {
  const lines = createLineSplitter();
  const data = (batch: string[]): string[] =>
    batch.flatMap((line) => {
      const trimmed = line.replace(/\r$/, "");
      if (!trimmed.startsWith("data:")) return [];
      const payload = trimmed.slice(5).trim();
      return payload && payload !== "[DONE]" ? [payload] : [];
    });
  return { push: (chunk: string) => data(lines.push(chunk)), flush: () => data(lines.flush()) };
}

async function* decodeChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

export async function* ndjsonEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = createNdjsonReader();
  for await (const chunk of decodeChunks(body)) yield* reader.push(chunk);
  yield* reader.flush();
}

export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = createSseReader();
  for await (const chunk of decodeChunks(body)) yield* reader.push(chunk);
  yield* reader.flush();
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --import tsx --test src/lib/stream-lines.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stream-lines.ts src/lib/stream-lines.test.ts
git commit -m "feat: NDJSON and SSE readers for streamed responses

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Live text utilities (`live-text.ts`)

**Files:**
- Create: `src/lib/live-text.ts`
- Test: `src/lib/live-text.test.ts`

**Interfaces:**
- Produces:
  - `splitSentences(text: string): string[]`, where each sentence is trimmed and has internal whitespace collapsed to single spaces
  - `normalizeSpoken(text: string): string`, which is `splitSentences(text).join(" ")`; the server stores `spoken` in this form
  - `createSentenceSplitter(): { push(delta: string): string[]; flush(): string[] }`, which yields the same sentences as `splitSentences` however the text is chunked
  - `GRADE_MARKER = "@@GRADE"`
  - `createTrailerFilter(marker?: string): { push(delta: string): string; finish(): { rest: string; spoken: string; trailer: string | null } }`
  - `parseGradeTrailer(trailer: string | null): unknown`, which returns `null` when there is no JSON
  - `type WordSpan = { start: number; end: number }`; `wordSchedule(text: string, durationSec: number): WordSpan[]`
  - `wordIndexAt(schedule: WordSpan[], t: number): number`
  - `charToWordIndex(text: string, charIndex: number): number`
  - `spokenOffset(sentences: string[], sentenceIndex: number, wordIndex: number): number`, the character offset in `sentences.join(" ")` just past word `wordIndex` of sentence `sentenceIndex`
  - `questionFromSpoken(spoken: string): string | null`, the last sentence ending in `?`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/live-text.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRADE_MARKER,
  charToWordIndex,
  createSentenceSplitter,
  createTrailerFilter,
  normalizeSpoken,
  parseGradeTrailer,
  questionFromSpoken,
  splitSentences,
  spokenOffset,
  wordIndexAt,
  wordSchedule,
} from "./live-text.ts";

const TEXT =
  'Hello there. How are you? e.g. this works. pi is 3.14 today. He said "stop." Then we left.\nNew line here. Done';

test("splitSentences follows the platform's rules", () => {
  assert.deepEqual(splitSentences(TEXT), [
    "Hello there.",
    "How are you?",
    // Intl.Segmenter only breaks before a capital, so "pi" joins the sentence before it.
    "e.g. this works. pi is 3.14 today.",
    'He said "stop."',
    "Then we left.",
    "New line here.",
    "Done",
  ]);
});

test("the streaming splitter matches splitSentences however the text is chunked", () => {
  const splitter = createSentenceSplitter();
  const out: string[] = [];
  for (const ch of TEXT) out.push(...splitter.push(ch));
  out.push(...splitter.flush());
  assert.deepEqual(out, splitSentences(TEXT));
});

test("the streaming splitter holds a sentence until the next one starts", () => {
  const splitter = createSentenceSplitter();
  assert.deepEqual(splitter.push("It ends here"), []);
  assert.deepEqual(splitter.push("."), []);
  assert.deepEqual(splitter.push(" Next"), ["It ends here."]);
  assert.deepEqual(splitter.flush(), ["Next"]);
});

test("normalizeSpoken collapses whitespace inside and between sentences", () => {
  assert.equal(normalizeSpoken("One  two.\n\nThree   four."), "One two. Three four.");
});

test("trailer filter: marker in one chunk", () => {
  const f = createTrailerFilter();
  assert.equal(f.push(`Good answer. ${GRADE_MARKER} {"score":5}`), "Good answer. ");
  assert.deepEqual(f.finish(), { rest: "", spoken: "Good answer. ", trailer: ' {"score":5}' });
});

test("trailer filter: marker split across chunks is never emitted", () => {
  const f = createTrailerFilter();
  const emitted = ["Nice.\n@", "@GR", "ADE {\"s", "core\":4}"].map((d) => f.push(d)).join("");
  assert.equal(emitted, "Nice.\n");
  assert.equal(f.finish().trailer, ' {"score":4}');
});

test("trailer filter: a held-back prefix that is not the marker is released", () => {
  const f = createTrailerFilter();
  assert.equal(f.push("Email me @"), "Email me ");
  assert.equal(f.push("home"), "@home");
  assert.deepEqual(f.finish(), { rest: "", spoken: "Email me @home", trailer: null });
});

test("trailer filter: no marker releases the held tail on finish", () => {
  const f = createTrailerFilter();
  assert.equal(f.push("Ends with @@"), "Ends with ");
  assert.deepEqual(f.finish(), { rest: "@@", spoken: "Ends with @@", trailer: null });
});

test("parseGradeTrailer", () => {
  assert.deepEqual(parseGradeTrailer(' {"score":3}\n'), { score: 3 });
  assert.deepEqual(parseGradeTrailer(' ```json\n{"score":2}\n```'), { score: 2 });
  assert.equal(parseGradeTrailer(null), null);
  assert.equal(parseGradeTrailer(" not json"), null);
  assert.equal(parseGradeTrailer(" {broken"), null);
});

test("wordSchedule is monotonic, starts at 0 and ends at the duration", () => {
  const s = wordSchedule("The rate, in short, is zero.", 2);
  assert.equal(s.length, 6);
  assert.equal(s[0].start, 0);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].start >= s[i - 1].start);
  assert.ok(Math.abs(s[s.length - 1].end - 2) < 1e-9);
});

test("wordSchedule gives punctuation a pause", () => {
  const withComma = wordSchedule("aaaa, bbbb", 1);
  const without = wordSchedule("aaaa bbbb", 1);
  assert.ok(withComma[1].start > without[1].start);
});

test("wordSchedule of empty text is empty", () => {
  assert.deepEqual(wordSchedule("   ", 1), []);
});

test("wordIndexAt", () => {
  const s = wordSchedule("one two three", 3);
  assert.equal(wordIndexAt(s, 0), 0);
  assert.equal(wordIndexAt(s, s[1].start), 1);
  assert.equal(wordIndexAt(s, 99), 2);
});

test("charToWordIndex", () => {
  assert.equal(charToWordIndex("Hello big world", 0), 0);
  assert.equal(charToWordIndex("Hello big world", 6), 1);
  assert.equal(charToWordIndex("Hello big world", 7), 1);
  assert.equal(charToWordIndex("Hello big world", 10), 2);
});

test("spokenOffset lands just past the word being said", () => {
  const sentences = ["First one here.", "Second part now."];
  const joined = sentences.join(" ");
  assert.equal(joined.slice(0, spokenOffset(sentences, 0, 0)), "First");
  assert.equal(joined.slice(0, spokenOffset(sentences, 0, 2)), "First one here.");
  assert.equal(joined.slice(0, spokenOffset(sentences, 1, 1)), "First one here. Second part");
});

test("questionFromSpoken takes the last question", () => {
  assert.equal(questionFromSpoken("Close. Why is that? Try this: what is 2 plus 2?"), "Try this: what is 2 plus 2?");
  assert.equal(questionFromSpoken("Well done. That is all."), null);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --import tsx --test src/lib/live-text.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/live-text.ts
/**
 * Text handling for the live interview: the tutor's reply arrives as a stream,
 * is spoken a sentence at a time, and is captioned a word at a time. Pure, so
 * the server and the browser cut the same text into the same sentences, which
 * is what lets a caption position become a character offset the server can store.
 */

const segmenter = () => new Intl.Segmenter("en", { granularity: "sentence" });
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

// ponytail: Intl.Segmenter breaks after "Dr. " before a capital, so a title can
// be spoken as its own short sentence. Add a suppression list if it grates.
export function splitSentences(text: string): string[] {
  return [...segmenter().segment(text)].map((s) => tidy(s.segment)).filter(Boolean);
}

/** The canonical stored form of a spoken reply. */
export function normalizeSpoken(text: string): string {
  return splitSentences(text).join(" ");
}

/**
 * Only the last segment can still grow, so everything before it is final. That
 * makes the output independent of how the stream happened to be chunked.
 */
export function createSentenceSplitter() {
  const seg = segmenter();
  let buffer = "";
  return {
    push(delta: string): string[] {
      buffer += delta;
      const parts = [...seg.segment(buffer)].map((s) => s.segment);
      if (parts.length < 2) return [];
      buffer = parts[parts.length - 1];
      return parts.slice(0, -1).map(tidy).filter(Boolean);
    },
    flush(): string[] {
      const rest = tidy(buffer);
      buffer = "";
      return rest ? [rest] : [];
    },
  };
}

export const GRADE_MARKER = "@@GRADE";

/**
 * Splits the model's output into what is spoken and the grade line after the
 * marker. Any tail that could be the start of the marker is held back, so
 * "@@GR" never reaches the voice just because the chunk ended there.
 */
export function createTrailerFilter(marker = GRADE_MARKER) {
  let pending = "";
  let spoken = "";
  let trailer: string | null = null;
  return {
    push(delta: string): string {
      if (trailer !== null) {
        trailer += delta;
        return "";
      }
      pending += delta;
      const at = pending.indexOf(marker);
      if (at >= 0) {
        const out = pending.slice(0, at);
        trailer = pending.slice(at + marker.length);
        pending = "";
        spoken += out;
        return out;
      }
      let hold = 0;
      for (let k = Math.min(marker.length - 1, pending.length); k > 0; k--) {
        if (marker.startsWith(pending.slice(-k))) {
          hold = k;
          break;
        }
      }
      const out = pending.slice(0, pending.length - hold);
      pending = pending.slice(pending.length - hold);
      spoken += out;
      return out;
    },
    finish(): { rest: string; spoken: string; trailer: string | null } {
      const rest = trailer === null ? pending : "";
      spoken += rest;
      pending = "";
      return { rest, spoken, trailer };
    },
  };
}

/** The JSON object after the marker, tolerating code fences; null when there is none. */
export function parseGradeTrailer(trailer: string | null): unknown {
  if (!trailer) return null;
  const start = trailer.indexOf("{");
  const end = trailer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trailer.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type WordSpan = { start: number; end: number };

const words = (text: string) => text.split(/\s+/).filter(Boolean);

function weight(word: string): number {
  if (/[.!?]["')”’]*$/.test(word)) return word.length + 3;
  if (/[,;:]["')”’]*$/.test(word)) return word.length + 2;
  return word.length;
}

/**
 * Kokoro returns audio with no word timings, so each word gets a share of the
 * sentence's duration by length, plus a little for the pause punctuation makes.
 * ponytail: accurate to about a word; forced alignment would be exact.
 */
export function wordSchedule(text: string, durationSec: number): WordSpan[] {
  const weights = words(text).map(weight);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total === 0) return [];
  let acc = 0;
  return weights.map((w) => {
    const start = (durationSec * acc) / total;
    acc += w;
    return { start, end: (durationSec * acc) / total };
  });
}

export function wordIndexAt(schedule: WordSpan[], t: number): number {
  let i = 0;
  while (i + 1 < schedule.length && schedule[i + 1].start <= t) i++;
  return i;
}

/** For the browser voice, whose boundary events report a character index. */
export function charToWordIndex(text: string, charIndex: number): number {
  return Math.max(0, words(`${text.slice(0, charIndex)}x`).length - 1);
}

export function spokenOffset(sentences: string[], sentenceIndex: number, wordIndex: number): number {
  const before = sentences.slice(0, sentenceIndex).join(" ");
  const current = words(sentences[sentenceIndex] ?? "").slice(0, wordIndex + 1).join(" ");
  return before.length + (sentenceIndex > 0 ? 1 : 0) + current.length;
}

export function questionFromSpoken(spoken: string): string | null {
  const questions = splitSentences(spoken).filter((s) => s.endsWith("?"));
  return questions.length > 0 ? questions[questions.length - 1] : null;
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --import tsx --test src/lib/live-text.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/live-text.ts src/lib/live-text.test.ts
git commit -m "feat: sentence streaming, grade trailer and word timing for live interviews

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---
### Task 3: Live interview logic (`live-interview.ts`)

**Files:**
- Create: `src/lib/live-interview.ts`
- Test: `src/lib/live-interview.test.ts`

**Interfaces:**
- Consumes: `rubricFor`, `InterviewFeedback`, `Rubric` from `src/lib/interview.ts`; the type of `feynmanFeedbackSchema` from `src/lib/validation.ts`
- Produces:
  - `type FeynmanFeedback` (the Feynman coach's parsed output)
  - `VERDICTS`, `type Verdict = "right" | "partial" | "wrong"`, `type TranscriptSource = "whisper" | "browser"`
  - `type LiveFeedback = { score: number; verdict: Verdict; improvement: string; correction: string; example: string; transcriptSource?: TranscriptSource }`
  - `liveGradeSchema(mode: "VIVA" | "PROTEGE")`, a Zod object: `score`, `verdict`, `improvement`, `correction`, `example`, `nextQuestion: string | null`
  - `liveTurnSchema` `{ turnId, answer, transcriptSource }`, `liveInterruptSchema` `{ turnId, interruptedAt }`, `liveToggleSchema` `{ live }`
  - `verdictFromScore(rubric: Rubric, score: number): Verdict`
  - `toLiveFeedback(graded: InterviewFeedback | FeynmanFeedback): LiveFeedback`
  - `readLiveFeedback(json: string | null): LiveFeedback | null`
  - `nextTurnKind(verdict: Verdict, answeringRetry: boolean): "retry" | "new"`
  - `questionsAnswered(turns: { answer: string | null; retryOf: string | null }[]): number`
  - `SILENCE_MS = 1200`, `LISTEN_ONSET_MS = 150`, `BARGE_IN_MS = 300`, `DEFAULT_SENSITIVITY = 0.5`, `sensitivityToThreshold(s: number): number`
  - `createVad({ threshold, silenceMs })` with `step(level, nowMs, onsetMs): "start" | "end" | null`, `reset()`, `setThreshold(t)`
  - `type LivePhase`, `type LiveState`, `INITIAL_LIVE_STATE`, `type LiveAction`, `liveReducer(state, action): LiveState`
  - `isEndCommand(text: string): boolean`
  - `heardAnswer(local: string | null, preview: string): { text: string; source: TranscriptSource } | null`
  - `type LiveTurnEvent` and `type DebateLiveEvent`, the NDJSON events of the two live routes

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/live-interview.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_LIVE_STATE,
  createVad,
  heardAnswer,
  isEndCommand,
  liveGradeSchema,
  liveReducer,
  nextTurnKind,
  questionsAnswered,
  readLiveFeedback,
  sensitivityToThreshold,
  toLiveFeedback,
  verdictFromScore,
  type LiveState,
} from "./live-interview.ts";

test("liveGradeSchema scores on the mode's scale", () => {
  const viva = liveGradeSchema("VIVA");
  assert.equal(viva.safeParse({ score: 4, verdict: "right" }).success, true);
  assert.equal(viva.safeParse({ score: 40, verdict: "right" }).success, false);
  const protege = liveGradeSchema("PROTEGE");
  assert.equal(protege.safeParse({ score: 40, verdict: "partial" }).success, true);
  assert.equal(protege.safeParse({ score: 4, verdict: "maybe" }).success, false);
});

test("liveGradeSchema fills defaults", () => {
  const parsed = liveGradeSchema("VIVA").parse({ score: 2, verdict: "wrong" });
  assert.deepEqual(parsed, { score: 2, verdict: "wrong", improvement: "", correction: "", example: "", nextQuestion: null });
});

test("verdictFromScore", () => {
  assert.equal(verdictFromScore("INTERVIEWER", 5), "right");
  assert.equal(verdictFromScore("INTERVIEWER", 3), "partial");
  assert.equal(verdictFromScore("INTERVIEWER", 2), "wrong");
  assert.equal(verdictFromScore("FEYNMAN", 80), "right");
  assert.equal(verdictFromScore("FEYNMAN", 60), "partial");
  assert.equal(verdictFromScore("FEYNMAN", 20), "wrong");
});

test("toLiveFeedback maps the interviewer grader", () => {
  assert.deepEqual(
    toLiveFeedback({ strengths: ["a"], improvements: ["fix x"], score: 2, modelAnswer: "model" }),
    { score: 2, verdict: "wrong", improvement: "fix x", correction: "fix x", example: "model" }
  );
});

test("toLiveFeedback maps the Feynman grader", () => {
  assert.deepEqual(
    toLiveFeedback({ score: 55, verdict: "ok", strengths: [], gaps: ["gap"], jargon: [], followUp: "" }),
    { score: 55, verdict: "partial", improvement: "gap", correction: "gap", example: "" }
  );
});

test("readLiveFeedback reads every stored shape", () => {
  const live = { score: 3, verdict: "partial", improvement: "i", correction: "c", example: "e" };
  assert.deepEqual(readLiveFeedback(JSON.stringify(live)), live);
  assert.equal(readLiveFeedback(JSON.stringify({ strengths: ["s"], improvements: ["i"], score: 5, modelAnswer: "m" }))?.verdict, "right");
  assert.equal(readLiveFeedback(JSON.stringify({ score: 10, verdict: "weak", gaps: ["g"] }))?.verdict, "wrong");
  assert.equal(readLiveFeedback(null), null);
  assert.equal(readLiveFeedback("not json"), null);
  assert.equal(readLiveFeedback("{}"), null);
});

test("one retry per missed question", () => {
  assert.equal(nextTurnKind("wrong", false), "retry");
  assert.equal(nextTurnKind("partial", false), "retry");
  assert.equal(nextTurnKind("right", false), "new");
  assert.equal(nextTurnKind("wrong", true), "new");
});

test("retries do not count toward the question limit", () => {
  assert.equal(
    questionsAnswered([
      { answer: "a", retryOf: null },
      { answer: "b", retryOf: "t1" },
      { answer: null, retryOf: null },
      { answer: "c", retryOf: null },
    ]),
    2
  );
});

test("sensitivityToThreshold is clamped and inverse", () => {
  assert.ok(sensitivityToThreshold(1) < sensitivityToThreshold(0));
  assert.equal(sensitivityToThreshold(5), sensitivityToThreshold(1));
  assert.equal(sensitivityToThreshold(-1), sensitivityToThreshold(0));
});

test("vad: speech starts only after the onset holds", () => {
  const vad = createVad({ threshold: 0.1, silenceMs: 1000 });
  assert.equal(vad.step(0.5, 0, 300), null);
  assert.equal(vad.step(0.5, 200, 300), null);
  assert.equal(vad.step(0.5, 300, 300), "start");
  assert.equal(vad.step(0.5, 400, 300), null);
});

test("vad: a blip shorter than the onset is ignored", () => {
  const vad = createVad({ threshold: 0.1, silenceMs: 1000 });
  vad.step(0.5, 0, 300);
  vad.step(0.0, 100, 300);
  assert.equal(vad.step(0.5, 350, 300), null);
});

test("vad: silence ends speech, a short pause does not", () => {
  const vad = createVad({ threshold: 0.1, silenceMs: 1000 });
  vad.step(0.5, 0, 0);
  assert.equal(vad.step(0.0, 100, 0), null);
  assert.equal(vad.step(0.5, 600, 0), null);
  assert.equal(vad.step(0.0, 700, 0), null);
  assert.equal(vad.step(0.0, 1700, 0), "end");
});

test("vad: setThreshold and reset", () => {
  const vad = createVad({ threshold: 0.1, silenceMs: 1000 });
  vad.setThreshold(0.9);
  assert.equal(vad.step(0.5, 0, 0), null);
  vad.setThreshold(0.1);
  assert.equal(vad.step(0.5, 10, 0), "start");
  vad.reset();
  assert.equal(vad.step(0.5, 20, 0), "start");
});

const at = (phase: LiveState["phase"]): LiveState => ({ phase, error: null });

test("reducer: the viva loop", () => {
  let s = liveReducer(INITIAL_LIVE_STATE, { type: "start" });
  assert.equal(s.phase, "speaking");
  s = liveReducer(s, { type: "replyDone", completed: false });
  assert.equal(s.phase, "listening");
  s = liveReducer(s, { type: "speechEnd" });
  assert.equal(s.phase, "transcribing");
  s = liveReducer(s, { type: "transcribed" });
  assert.equal(s.phase, "thinking");
  s = liveReducer(s, { type: "replyStarted" });
  assert.equal(s.phase, "speaking");
  s = liveReducer(s, { type: "replyDone", completed: true });
  assert.equal(s.phase, "done");
});

test("reducer: barge-in, empty transcript, advance", () => {
  assert.equal(liveReducer(at("speaking"), { type: "bargeIn" }).phase, "listening");
  assert.equal(liveReducer(at("transcribing"), { type: "empty" }).phase, "speaking");
  assert.equal(liveReducer(at("listening"), { type: "advance" }).phase, "thinking");
  assert.equal(liveReducer(INITIAL_LIVE_STATE, { type: "advance" }).phase, "thinking");
});

test("reducer: failure and retry", () => {
  const failed = liveReducer(at("thinking"), { type: "failed", message: "boom" });
  assert.deepEqual(failed, { phase: "error", error: "boom" });
  assert.deepEqual(liveReducer(failed, { type: "retry" }), { phase: "thinking", error: null });
  assert.equal(liveReducer(at("transcribing"), { type: "failed", message: "x" }).phase, "error");
  assert.equal(liveReducer(at("speaking"), { type: "failed", message: "x" }).phase, "error");
});

test("reducer: end from anywhere, and ignored actions keep the state", () => {
  assert.equal(liveReducer(at("listening"), { type: "end" }).phase, "done");
  const s = at("listening");
  assert.equal(liveReducer(s, { type: "bargeIn" }), s);
  assert.equal(liveReducer(at("done"), { type: "start" }).phase, "done");
});

test("heardAnswer prefers the local transcript, then the browser preview", () => {
  assert.deepEqual(heardAnswer(" Entropy rises ", "entropy rise"), { text: "Entropy rises", source: "whisper" });
  assert.deepEqual(heardAnswer("", "entropy rises"), { text: "entropy rises", source: "browser" });
  assert.deepEqual(heardAnswer(null, "  "), null);
});

test("isEndCommand", () => {
  assert.equal(isEndCommand("End session."), true);
  assert.equal(isEndCommand("please stop the interview"), true);
  assert.equal(isEndCommand("finish debate"), true);
  assert.equal(isEndCommand("The session ends when entropy peaks"), false);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --import tsx --test src/lib/live-interview.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/live-interview.ts
import { z } from "zod";
import { rubricFor, type InterviewFeedback, type Rubric } from "@/lib/interview";
import type { feynmanFeedbackSchema } from "@/lib/validation";

export type FeynmanFeedback = z.infer<typeof feynmanFeedbackSchema>;

export const VERDICTS = ["right", "partial", "wrong"] as const;
export type Verdict = (typeof VERDICTS)[number];
export type TranscriptSource = "whisper" | "browser";

/** What a live turn stores in `InterviewTurn.feedback`. */
export type LiveFeedback = {
  score: number;
  verdict: Verdict;
  improvement: string;
  correction: string;
  example: string;
  transcriptSource?: TranscriptSource;
};

/** The JSON after the `@@GRADE` marker. The score keeps its grader's scale, as `recallRawFor` expects. */
export function liveGradeSchema(mode: "VIVA" | "PROTEGE") {
  const score =
    rubricFor(mode) === "FEYNMAN" ? z.number().min(0).max(100) : z.number().int().min(1).max(5);
  return z.object({
    score,
    verdict: z.enum(VERDICTS),
    improvement: z.string().trim().max(600).default(""),
    correction: z.string().trim().max(1200).default(""),
    example: z.string().trim().max(2000).default(""),
    nextQuestion: z.string().trim().min(1).max(600).nullable().default(null),
  });
}

export const liveTurnSchema = z.object({
  turnId: z.string().trim().min(1),
  answer: z.string().trim().min(1).max(4000),
  transcriptSource: z.enum(["whisper", "browser"]).default("whisper"),
});

export const liveInterruptSchema = z.object({
  turnId: z.string().trim().min(1),
  interruptedAt: z.number().int().min(0).max(20000),
});

export const liveToggleSchema = z.object({ live: z.boolean() });

export function verdictFromScore(rubric: Rubric, score: number): Verdict {
  if (rubric === "FEYNMAN") return score >= 75 ? "right" : score >= 50 ? "partial" : "wrong";
  return score >= 4 ? "right" : score === 3 ? "partial" : "wrong";
}

/** The fallback grader and debate interjections produce the typed-mode shapes; this reads them as a live grade. */
export function toLiveFeedback(graded: InterviewFeedback | FeynmanFeedback): LiveFeedback {
  if ("modelAnswer" in graded) {
    const first = graded.improvements[0] ?? "";
    return {
      score: graded.score,
      verdict: verdictFromScore("INTERVIEWER", graded.score),
      improvement: first,
      correction: first,
      example: graded.modelAnswer,
    };
  }
  const first = graded.gaps[0] ?? "";
  return {
    score: graded.score,
    verdict: verdictFromScore("FEYNMAN", graded.score),
    improvement: first,
    correction: first,
    example: "",
  };
}

/**
 * Stored feedback in any of its shapes: a live grade, the interviewer's, or
 * the Feynman coach's. A session can switch between typing and talking, so
 * one transcript can hold all three.
 */
export function readLiveFeedback(json: string | null): LiveFeedback | null {
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (typeof o.score !== "number") return null;
  if (typeof o.verdict === "string" && (VERDICTS as readonly string[]).includes(o.verdict) && typeof o.correction === "string") {
    return o as unknown as LiveFeedback;
  }
  if (typeof o.modelAnswer === "string" && Array.isArray(o.improvements)) {
    return toLiveFeedback(o as unknown as InterviewFeedback);
  }
  if (Array.isArray(o.gaps)) {
    return toLiveFeedback({ score: o.score, gaps: o.gaps as string[] } as FeynmanFeedback);
  }
  return null;
}

/** A missed question earns one variant; a missed variant does not earn another. */
export function nextTurnKind(verdict: Verdict, answeringRetry: boolean): "retry" | "new" {
  return verdict !== "right" && !answeringRetry ? "retry" : "new";
}

/** Retries are a second go at the same question, so they don't use up the session's questions. */
export function questionsAnswered(turns: { answer: string | null; retryOf: string | null }[]): number {
  return turns.filter((t) => t.answer !== null && t.retryOf === null).length;
}

export const SILENCE_MS = 1200;
export const LISTEN_ONSET_MS = 150;
export const BARGE_IN_MS = 300;
export const DEFAULT_SENSITIVITY = 0.5;

/**
 * Slider position (0 = deaf, 1 = twitchy) to a level threshold on the 0..1
 * scale the analyser reports.
 * ponytail: linear guess from one laptop mic; the slider is the calibration knob.
 */
export function sensitivityToThreshold(sensitivity: number): number {
  const s = Math.min(1, Math.max(0, sensitivity));
  return 0.2 - s * 0.17;
}

/**
 * Energy-based voice detection. The onset is passed per step because the same
 * mic needs a quick trigger while listening and a slower one while the tutor
 * talks, where a cough should not count as cutting in.
 */
export function createVad(config: { threshold: number; silenceMs: number }) {
  let threshold = config.threshold;
  let speaking = false;
  let aboveSince: number | null = null;
  let belowSince: number | null = null;
  return {
    step(level: number, now: number, onsetMs: number): "start" | "end" | null {
      if (level >= threshold) {
        belowSince = null;
        if (speaking) return null;
        aboveSince ??= now;
        if (now - aboveSince >= onsetMs) {
          speaking = true;
          aboveSince = null;
          return "start";
        }
        return null;
      }
      aboveSince = null;
      if (!speaking) return null;
      belowSince ??= now;
      if (now - belowSince >= config.silenceMs) {
        speaking = false;
        belowSince = null;
        return "end";
      }
      return null;
    },
    reset() {
      speaking = false;
      aboveSince = null;
      belowSince = null;
    },
    setThreshold(next: number) {
      threshold = next;
    },
  };
}

export type LivePhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error" | "done";
export type LiveState = { phase: LivePhase; error: string | null };
export const INITIAL_LIVE_STATE: LiveState = { phase: "idle", error: null };

export type LiveAction =
  | { type: "start" }
  | { type: "advance" }
  | { type: "speechEnd" }
  | { type: "transcribed" }
  | { type: "empty" }
  | { type: "replyStarted" }
  | { type: "replyDone"; completed: boolean }
  | { type: "bargeIn" }
  | { type: "failed"; message: string }
  | { type: "retry" }
  | { type: "end" };

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  const to = (phase: LivePhase, error: string | null = null): LiveState => ({ phase, error });
  if (action.type === "end") return to("done");
  switch (state.phase) {
    case "idle":
      if (action.type === "start") return to("speaking");
      if (action.type === "advance") return to("thinking");
      return state;
    case "listening":
      if (action.type === "speechEnd") return to("transcribing");
      if (action.type === "advance") return to("thinking");
      return state;
    case "transcribing":
      if (action.type === "transcribed") return to("thinking");
      if (action.type === "empty") return to("speaking");
      if (action.type === "failed") return to("error", action.message);
      return state;
    case "thinking":
      if (action.type === "replyStarted") return to("speaking");
      if (action.type === "failed") return to("error", action.message);
      return state;
    case "speaking":
      if (action.type === "bargeIn") return to("listening");
      if (action.type === "replyDone") return to(action.completed ? "done" : "listening");
      if (action.type === "failed") return to("error", action.message);
      return state;
    case "error":
      return action.type === "retry" ? to("thinking") : state;
    case "done":
      return state;
  }
}

export function isEndCommand(text: string): boolean {
  return /^\s*(please\s+)?(end|stop|finish)\s+(the\s+)?(session|interview|debate)[.!]?\s*$/i.test(text);
}

/**
 * The answer to save and grade: the local transcription when it produced
 * anything, else Chrome's preview, marked as such for the transcript.
 */
export function heardAnswer(local: string | null, preview: string): { text: string; source: TranscriptSource } | null {
  const fromLocal = local?.trim();
  if (fromLocal) return { text: fromLocal.slice(0, 4000), source: "whisper" };
  const fromPreview = preview.trim();
  return fromPreview ? { text: fromPreview.slice(0, 4000), source: "browser" } : null;
}

export type LiveNextTurn = { id: string; order: number; question: string; retryOf: string | null };

/** NDJSON events from `POST /api/interview/[id]/live-turn`. */
export type LiveTurnEvent =
  | { type: "text"; delta: string }
  | { type: "done"; verdict: Verdict; completed: boolean; nextTurn: LiveNextTurn | null }
  | { type: "error"; message: string };

export type DebateLiveTurn = { id: string; order: number; speaker: string; question: string };

/** NDJSON events from `POST /api/interview/[id]/debate/live`. */
export type DebateLiveEvent =
  | { type: "speaker"; speaker: string; order: number }
  | { type: "text"; delta: string }
  | { type: "done"; turn: DebateLiveTurn | null; finished: boolean }
  | { type: "error"; message: string };
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --import tsx --test src/lib/live-interview.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/live-interview.ts src/lib/live-interview.test.ts
git commit -m "feat: live interview grading schema, retry policy, voice detector and turn reducer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Transcript helpers (`live-transcript.ts`)

**Files:**
- Create: `src/lib/live-transcript.ts`
- Test: `src/lib/live-transcript.test.ts`

**Interfaces:**
- Consumes: `readLiveFeedback`, `Verdict`, `TranscriptSource` (Task 3); `STUDENT_SPEAKER` from `src/lib/debate.ts`
- Produces:
  - `type TranscriptTurn = { id: string; order: number; speaker: string | null; question: string; answer: string | null; feedback: string | null; spoken: string | null; interruptedAt: number | null; retryOf: string | null }`
  - `type TranscriptLine = { speaker: string; text: string; interrupted: boolean; source?: TranscriptSource }`
  - `type FixCard = { question: string; answer: string; correction: string; example: string; retry: { answer: string; verdict: Verdict } | null }`
  - `tutorName(mode: "VIVA" | "PROTEGE" | "DEBATE"): string`
  - `transcriptLines(turns: TranscriptTurn[], tutor: string): TranscriptLine[]`
  - `fixCards(turns: TranscriptTurn[]): FixCard[]`
  - `transcriptMarkdown(title: string, lines: TranscriptLine[], cards: FixCard[]): string`

How a Viva/Protégé turn maps to lines: a turn's `spoken` is the tutor's reply to that turn's answer, and that reply already contains the next question. So a turn's `question` gets its own line only when the turn before it has no `spoken`: the first turn, a typed turn, or a turn whose reply failed.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/live-transcript.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixCards, transcriptLines, transcriptMarkdown, tutorName, type TranscriptTurn } from "./live-transcript.ts";

function turn(p: Partial<TranscriptTurn> & { id: string; order: number }): TranscriptTurn {
  return { speaker: null, question: "", answer: null, feedback: null, spoken: null, interruptedAt: null, retryOf: null, ...p };
}
const grade = (verdict: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ score: verdict === "right" ? 5 : 2, verdict, improvement: "imp", correction: "corr", example: "ex", ...extra });

const viva: TranscriptTurn[] = [
  turn({ id: "t0", order: 0, question: "What is entropy?", answer: "Disorder", feedback: grade("wrong", { transcriptSource: "browser" }), spoken: "Not quite. Try this: what happens to a gas?" }),
  turn({ id: "t1", order: 1, question: "Try this: what happens to a gas?", answer: "It spreads", feedback: grade("right"), spoken: "Yes. Next: what is heat?", interruptedAt: 4, retryOf: "t0" }),
  turn({ id: "t2", order: 2, question: "Next: what is heat?" }),
];

test("tutorName", () => {
  assert.equal(tutorName("VIVA"), "Tutor");
  assert.equal(tutorName("PROTEGE"), "Classmate");
});

test("viva lines: the first question, then answers and replies; a cut reply is truncated", () => {
  assert.deepEqual(transcriptLines(viva, "Tutor"), [
    { speaker: "Tutor", text: "What is entropy?", interrupted: false },
    { speaker: "You", text: "Disorder", interrupted: false, source: "browser" },
    { speaker: "Tutor", text: "Not quite. Try this: what happens to a gas?", interrupted: false },
    { speaker: "You", text: "It spreads", interrupted: false, source: undefined },
    { speaker: "Tutor", text: "Yes.", interrupted: true },
  ]);
});

test("a typed turn in a live session keeps its question line", () => {
  const lines = transcriptLines(
    [
      turn({ id: "a", order: 0, question: "Q1", answer: "A1", feedback: grade("right") }),
      turn({ id: "b", order: 1, question: "Q2" }),
    ],
    "Tutor"
  );
  assert.deepEqual(lines.map((l) => l.text), ["Q1", "A1", "Q2"]);
});

test("debate lines, with an unheard agent turn dropped", () => {
  const lines = transcriptLines(
    [
      turn({ id: "p", order: 0, speaker: "Proponent", question: "It holds." }),
      turn({ id: "s", order: 1, speaker: "Skeptic", question: "Not always, because of friction.", interruptedAt: 12 }),
      turn({ id: "y", order: 2, speaker: "You", question: "Interjection", answer: "Friction is heat." }),
      turn({ id: "q", order: 3, speaker: "Proponent", question: "Never heard.", interruptedAt: 0 }),
    ],
    "Tutor"
  );
  assert.deepEqual(lines, [
    { speaker: "Proponent", text: "It holds.", interrupted: false },
    { speaker: "Skeptic", text: "Not always,", interrupted: true },
    { speaker: "You", text: "Friction is heat.", interrupted: false },
  ]);
});

test("fix cards pair a miss with its retry", () => {
  assert.deepEqual(fixCards(viva), [
    { question: "What is entropy?", answer: "Disorder", correction: "corr", example: "ex", retry: { answer: "It spreads", verdict: "right" } },
  ]);
});

test("fix cards skip right answers and read typed-mode feedback", () => {
  const cards = fixCards([
    turn({ id: "a", order: 0, question: "Q1", answer: "A1", feedback: grade("right") }),
    turn({ id: "b", order: 1, question: "Q2", answer: "A2", feedback: JSON.stringify({ strengths: ["s"], improvements: ["do x"], score: 1, modelAnswer: "m" }) }),
  ]);
  assert.deepEqual(cards, [{ question: "Q2", answer: "A2", correction: "do x", example: "m", retry: null }]);
});

test("markdown export", () => {
  const md = transcriptMarkdown("Entropy viva", transcriptLines(viva, "Tutor"), fixCards(viva));
  assert.match(md, /^# Entropy viva\n/);
  assert.match(md, /\*\*You:\*\* Disorder _\(browser transcript\)_/);
  assert.match(md, /\*\*Tutor:\*\* Yes\. — \(you cut in\)/);
  assert.match(md, /### 1\. What is entropy\?/);
  assert.match(md, /- \*\*Retry:\*\* It spreads \(right\)/);
});

test("markdown export with nothing to fix", () => {
  assert.match(transcriptMarkdown("T", [], []), /Nothing to fix/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --import tsx --test src/lib/live-transcript.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/live-transcript.ts
import { STUDENT_SPEAKER } from "@/lib/debate";
import { readLiveFeedback, type TranscriptSource, type Verdict } from "@/lib/live-interview";

export type TranscriptTurn = {
  id: string;
  order: number;
  speaker: string | null;
  question: string;
  answer: string | null;
  feedback: string | null;
  spoken: string | null;
  interruptedAt: number | null;
  retryOf: string | null;
};

export type TranscriptLine = { speaker: string; text: string; interrupted: boolean; source?: TranscriptSource };

export type FixCard = {
  question: string;
  answer: string;
  correction: string;
  example: string;
  retry: { answer: string; verdict: Verdict } | null;
};

export function tutorName(mode: "VIVA" | "PROTEGE" | "DEBATE"): string {
  return mode === "PROTEGE" ? "Classmate" : "Tutor";
}

/** What the student actually heard: the text up to where they cut in. */
function heard(text: string, interruptedAt: number | null): { text: string; interrupted: boolean } {
  return interruptedAt === null
    ? { text, interrupted: false }
    : { text: text.slice(0, interruptedAt).trimEnd(), interrupted: true };
}

export function transcriptLines(turns: TranscriptTurn[], tutor: string): TranscriptLine[] {
  const sorted = [...turns].sort((a, b) => a.order - b.order);
  const lines: TranscriptLine[] = [];
  sorted.forEach((t, i) => {
    if (t.speaker === STUDENT_SPEAKER) {
      if (t.answer) lines.push({ speaker: "You", text: t.answer, interrupted: false });
      return;
    }
    if (t.speaker !== null) {
      // A debate agent cut off before its first word said nothing the student heard.
      const agent = heard(t.question, t.interruptedAt);
      if (agent.text) lines.push({ speaker: t.speaker, ...agent });
      return;
    }
    const previous = sorted[i - 1];
    if (!previous || previous.spoken === null) {
      lines.push({ speaker: tutor, text: t.question, interrupted: false });
    }
    if (t.answer !== null) {
      lines.push({
        speaker: "You",
        text: t.answer,
        interrupted: false,
        source: readLiveFeedback(t.feedback)?.transcriptSource,
      });
    }
    if (t.spoken !== null) lines.push({ speaker: tutor, ...heard(t.spoken, t.interruptedAt) });
  });
  return lines;
}

/** Every missed first attempt, with its correction, example, and how the retry went. */
export function fixCards(turns: TranscriptTurn[]): FixCard[] {
  const retries = new Map(turns.filter((t) => t.retryOf !== null).map((t) => [t.retryOf as string, t]));
  return [...turns]
    .sort((a, b) => a.order - b.order)
    .flatMap((t) => {
      if (t.answer === null || t.retryOf !== null) return [];
      const feedback = readLiveFeedback(t.feedback);
      if (!feedback || feedback.verdict === "right") return [];
      const retry = retries.get(t.id);
      const retryFeedback = retry ? readLiveFeedback(retry.feedback) : null;
      return [
        {
          question: t.question,
          answer: t.answer,
          correction: feedback.correction,
          example: feedback.example,
          retry:
            retry && retry.answer !== null && retryFeedback
              ? { answer: retry.answer, verdict: retryFeedback.verdict }
              : null,
        },
      ];
    });
}

export function transcriptMarkdown(title: string, lines: TranscriptLine[], cards: FixCard[]): string {
  const conversation = lines.map((l) => {
    const cut = l.interrupted ? " — (you cut in)" : "";
    const source = l.source === "browser" ? " _(browser transcript)_" : "";
    return `**${l.speaker}:** ${l.text}${cut}${source}`;
  });
  const fixes =
    cards.length === 0
      ? ["Nothing to fix — every answer landed."]
      : cards.map((c, i) =>
          [
            `### ${i + 1}. ${c.question}`,
            `- **You said:** ${c.answer}`,
            c.correction ? `- **Correction:** ${c.correction}` : "",
            c.example ? `- **Example:** ${c.example}` : "",
            c.retry ? `- **Retry:** ${c.retry.answer} (${c.retry.verdict})` : "",
          ]
            .filter(Boolean)
            .join("\n")
        );
  return [`# ${title}`, "## Conversation", conversation.join("\n\n"), "## What to fix", fixes.join("\n\n")].join("\n\n") + "\n";
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `node --import tsx --test src/lib/live-transcript.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/live-transcript.ts src/lib/live-transcript.test.ts
git commit -m "feat: live interview transcript lines, fix cards and markdown export

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Schema, migration, and the live toggle

**Files:**
- Modify: `prisma/schema.prisma` (the `InterviewSession` and `InterviewTurn` models)
- Create: `prisma/migrations/20260918120000_live_interview/migration.sql`
- Modify: `src/app/api/interview/[id]/route.ts` (add `PATCH`)

**Interfaces:**
- Consumes: `liveToggleSchema` (Task 3)
- Produces: the columns `InterviewSession.live`, `InterviewTurn.spoken`, `InterviewTurn.interruptedAt`, `InterviewTurn.retryOf`; `PATCH /api/interview/[id]` with `{ live: boolean }`, which returns `{ session }`

- [ ] **Step 1: Edit the schema**

In `model InterviewSession`, add this after the `courseTopicId String?` line and its comment:

```prisma
  /// Set by "Talk it through": the session page renders the spoken loop and,
  /// once finished, the transcript view.
  live Boolean @default(false)
```

In `model InterviewTurn`, add this after `speaker String?`:

```prisma
  /// Live mode: the tutor's whole spoken reply to this turn's answer, which
  /// ends in the next question. Stored normalized (see normalizeSpoken).
  spoken          String?
  /// Char offset into `spoken` (or into `question` on a debate agent's turn)
  /// where the student cut in.
  interruptedAt   Int?
  /// The turn whose missed question this variant retries.
  retryOf         String?
```

- [ ] **Step 2: Write the migration by hand**

This follows the repo convention: `prisma migrate dev` would also propose dropping the FTS5 shadow tables.

```sql
-- prisma/migrations/20260918120000_live_interview/migration.sql
-- Hand-written: `prisma migrate dev` would also propose dropping `page_search`
-- and its FTS5 shadow tables, which the Prisma datamodel cannot see.

-- AlterTable
ALTER TABLE "InterviewSession" ADD COLUMN "live" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InterviewTurn" ADD COLUMN "spoken" TEXT;
ALTER TABLE "InterviewTurn" ADD COLUMN "interruptedAt" INTEGER;
ALTER TABLE "InterviewTurn" ADD COLUMN "retryOf" TEXT;
```

The first line of that block is a path label. Don't copy it into the file; the file starts at `-- Hand-written`.

- [ ] **Step 3: Regenerate the client and validate**

Run: `npx prisma validate && npx prisma generate`
Expected: "The schema at prisma/schema.prisma is valid" and "Generated Prisma Client".

- [ ] **Step 4: HUMAN GATE — apply the migration**

Stop and ask the user to run this in the Lectern checkout:

```bash
npm run db:migrate
```

It backs up the database, then runs `prisma migrate deploy`. Agents must not run it themselves. Tasks 6, 7, 10 and 11 don't need the new columns in the database, so they can continue while you wait.

- [ ] **Step 5: Add PATCH to `src/app/api/interview/[id]/route.ts`**

Add these imports next to the existing ones:

```ts
import { withValidation } from "@/lib/api-utils";
import { liveToggleSchema } from "@/lib/live-interview";
```

`jsonError` is already imported from `@/lib/api-utils`, so merge the two into one import line: `import { jsonError, withValidation } from "@/lib/api-utils";`. Then add this handler between `GET` and `DELETE`:

```ts
/** "Talk it through" and "Switch to typing": the same session, a different runner. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(liveToggleSchema, body);
  if ("error" in result) return result.error;

  const session = await db.interviewSession.findUnique({ where: { id } });
  if (!session) return jsonError("Interview session not found", 404);

  const updated = await db.interviewSession.update({ where: { id }, data: { live: result.data.live } });
  return NextResponse.json({ session: updated });
}
```

- [ ] **Step 6: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260918120000_live_interview src/app/api/interview/\[id\]/route.ts
git commit -m "feat: live interview columns and the live toggle

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Streaming LLM calls

**Files:**
- Modify: `src/lib/openrouter.ts`, `src/lib/ollama.ts`, `src/lib/llm.ts`
- Modify: `src/lib/openrouter.test.ts`
- Create: `src/lib/ollama.test.ts`

**Interfaces:**
- Consumes: `sseData`, `ndjsonEvents` (Task 1)
- Produces:
  - `openRouterDelta(payload: string): string`, which throws on an error payload
  - `callOpenRouterStream(opts: { model: string; messages: ChatMessage[]; signal?: AbortSignal }): AsyncGenerator<string>`
  - `ollamaDelta(event: unknown): string`, which throws on an error event
  - `createThinkStripper(): { push(delta: string): string }`
  - `callOllamaStream(opts: { messages: ChatMessage[]; model?: string; signal?: AbortSignal }): AsyncGenerator<string>`
  - `callLLMStream(opts: { model: string; messages: ChatMessage[]; stage?: LLMStage; signal?: AbortSignal }): AsyncGenerator<string>`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/openrouter.test.ts`, and change its import line to `import { modelField, openRouterDelta, webPluginField } from "./openrouter.ts";`:

```ts
test("openRouterDelta reads a content delta", () => {
  assert.equal(openRouterDelta('{"choices":[{"delta":{"content":"Hi"}}]}'), "Hi");
});

test("openRouterDelta ignores role-only chunks and garbage", () => {
  assert.equal(openRouterDelta('{"choices":[{"delta":{"role":"assistant"}}]}'), "");
  assert.equal(openRouterDelta("not json"), "");
});

test("openRouterDelta throws on a mid-stream error", () => {
  assert.throws(() => openRouterDelta('{"error":{"message":"rate limited"}}'), /rate limited/);
});
```

Create `src/lib/ollama.test.ts`:

```ts
// src/lib/ollama.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createThinkStripper, ollamaDelta } from "./ollama.ts";

test("ollamaDelta reads message content", () => {
  assert.equal(ollamaDelta({ message: { content: "Hi" }, done: false }), "Hi");
  assert.equal(ollamaDelta({ done: true }), "");
});

test("ollamaDelta throws on an error event", () => {
  assert.throws(() => ollamaDelta({ error: "model not found" }), /model not found/);
});

test("think stripper passes plain text straight through", () => {
  const s = createThinkStripper();
  assert.equal(s.push("Hello"), "Hello");
  assert.equal(s.push(" there"), " there");
});

test("think stripper drops a leading think block split across chunks", () => {
  const s = createThinkStripper();
  assert.equal(s.push("<th"), "");
  assert.equal(s.push("ink>hmm, let me"), "");
  assert.equal(s.push(" see</think>  Hello"), "Hello");
  assert.equal(s.push(" world"), " world");
});

test("think stripper does not swallow other tags", () => {
  const s = createThinkStripper();
  assert.equal(s.push("<b>bold"), "<b>bold");
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --import tsx --test src/lib/openrouter.test.ts src/lib/ollama.test.ts`
Expected: FAIL, because `openRouterDelta`, `ollamaDelta` and `createThinkStripper` aren't exported.

- [ ] **Step 3: OpenRouter — pull out the request, add the stream**

In `src/lib/openrouter.ts`, add `import { sseData } from "@/lib/stream-lines";` at the top. Replace the whole `callOpenRouter` function with the following. The streaming call shares its key check, network error and HTTP error handling.

```ts
// in src/lib/openrouter.ts: replaces callOpenRouter
async function postOpenRouter(model: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Copy .env.example to .env and add your OpenRouter key.");
  }

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...modelField(model), ...body }),
      signal,
    });
  } catch {
    throw new Error("Could not reach OpenRouter. Check your internet connection and try again.");
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = data?.error?.message ?? `OpenRouter returned ${res.status}`;
    throw new Error(`OpenRouter request failed (model: ${model}): ${detail}`);
  }
  return res;
}

async function callOpenRouter(opts: {
  model: string;
  messages: ApiMessage[];
  jsonMode?: boolean;
  web?: boolean;
}): Promise<string> {
  const res = await postOpenRouter(opts.model, {
    ...webPluginField(opts.web),
    messages: opts.messages,
    ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
  });

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenRouter returned an empty response. You can retry this step.");
  }
  return content;
}

/**
 * One SSE payload's text. A provider that fails after the headers were sent
 * reports it as an `error` payload inside a 200 stream, so that throws here.
 */
export function openRouterDelta(payload: string): string {
  let data: { error?: { message?: unknown }; choices?: { delta?: { content?: unknown } }[] };
  try {
    data = JSON.parse(payload);
  } catch {
    return "";
  }
  if (typeof data?.error?.message === "string") {
    throw new Error(`OpenRouter stream failed: ${data.error.message}`);
  }
  const content = data?.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

/** The reply as it is written, for the live interview's voice. */
export async function* callOpenRouterStream(opts: {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const res = await postOpenRouter(opts.model, { messages: opts.messages, stream: true }, opts.signal);
  if (!res.body) throw new Error("OpenRouter returned an empty response. You can retry this step.");
  for await (const payload of sseData(res.body)) {
    const delta = openRouterDelta(payload);
    if (delta) yield delta;
  }
}
```

- [ ] **Step 4: Ollama — pull out the request, add the stream**

In `src/lib/ollama.ts`, add `import { ndjsonEvents } from "@/lib/stream-lines";`. Replace the body of `callOllama` from `const url = ...` through the `if (!res.ok) { ... }` block with a call to a new `postOllama`. The resulting file section should read:

```ts
// in src/lib/ollama.ts: replaces the fetch + error handling inside callOllama
async function postOllama(model: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${ollamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      body: JSON.stringify({ model, think: false, ...body }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      throw new Error(
        `Ollama did not respond within ${REQUEST_TIMEOUT_MS / 1000}s. The model may still be loading, or the machine is overloaded — try again.`
      );
    }
    throw new Error(
      `Could not reach Ollama at ${ollamaDisplayUrl()}. Is it running? (ollama serve, then: ollama pull ${model})`
    );
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = typeof data?.error === "string" ? data.error : `Ollama returned ${res.status}`;
    if (/not found/i.test(detail)) {
      throw new Error(`Ollama does not have the model "${model}" yet. Run: ollama pull ${model}`);
    }
    throw new Error(`Ollama request failed (model: ${model}): ${detail}`);
  }
  return res;
}

export async function callOllama(opts: {
  messages: ChatMessage[];
  jsonMode?: boolean;
  /** Overrides ollamaModel() when set — used for the REASONING tier. */
  model?: string;
  /** Raw base64, no `data:` prefix — Ollama's own image field, attached to the
   *  last message. Needs a multimodal model; a text-only one ignores them
   *  silently and answers from the prompt alone. */
  images?: string[];
}): Promise<string> {
  const model = opts.model || ollamaModel();
  const images = opts.images ?? [];
  const messages =
    images.length > 0
      ? opts.messages.map((m, i) => (i === opts.messages.length - 1 ? { ...m, images } : m))
      : opts.messages;

  const res = await postOllama(model, {
    messages,
    stream: false,
    ...(opts.jsonMode ? { format: "json" } : {}),
  });

  const data = await res.json();
  const content = data?.message?.content;
  if (typeof content !== "string" || !stripThinking(content)) {
    throw new Error("Ollama returned an empty response. You can retry this step.");
  }
  return stripThinking(content);
}

export function ollamaDelta(event: unknown): string {
  const e = event as { error?: unknown; message?: { content?: unknown } } | null;
  if (typeof e?.error === "string") throw new Error(`Ollama stream failed: ${e.error}`);
  return typeof e?.message?.content === "string" ? e.message.content : "";
}

/**
 * stripThinking for a stream: some Qwen3 builds open with a <think> block even
 * with think:false. Text is held only while it could still be that block's
 * opening tag, so a normal reply starts speaking at once.
 */
export function createThinkStripper() {
  const OPEN = "<think>";
  const CLOSE = "</think>";
  let buffer = "";
  let passing = false;
  return {
    push(delta: string): string {
      if (passing) return delta;
      buffer += delta;
      const head = buffer.trimStart();
      if (!head) return "";
      if (!OPEN.startsWith(head.slice(0, OPEN.length))) {
        passing = true;
        const out = buffer;
        buffer = "";
        return out;
      }
      const end = buffer.indexOf(CLOSE);
      if (end < 0) return "";
      passing = true;
      const out = buffer.slice(end + CLOSE.length).trimStart();
      buffer = "";
      return out;
    },
  };
}

export async function* callOllamaStream(opts: {
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  const model = opts.model || ollamaModel();
  const res = await postOllama(model, { messages: opts.messages, stream: true }, opts.signal);
  if (!res.body) throw new Error("Ollama returned an empty response. You can retry this step.");
  const think = createThinkStripper();
  for await (const event of ndjsonEvents(res.body)) {
    const delta = think.push(ollamaDelta(event));
    if (delta) yield delta;
  }
}
```

- [ ] **Step 5: `callLLMStream` in `src/lib/llm.ts`**

Change the imports to include `callOpenRouterStream` and `callOllamaStream`, then add this after `callLLMText`:

```ts
// in src/lib/llm.ts: add after callLLMText
/** callLLMText as a stream of text deltas, dispatched the same way. */
export function callLLMStream(opts: {
  model: string;
  messages: ChatMessage[];
  stage?: LLMStage;
  signal?: AbortSignal;
}): AsyncGenerator<string> {
  if (resolveProvider(opts.stage) === "ollama") {
    return callOllamaStream({
      messages: opts.messages,
      model: opts.stage === "reasoning" ? ollamaReasoningModel() : undefined,
      signal: opts.signal,
    });
  }
  return callOpenRouterStream({ model: opts.model, messages: opts.messages, signal: opts.signal });
}
```

- [ ] **Step 6: Run the tests, the full suite, and the type check**

Run: `node --import tsx --test src/lib/openrouter.test.ts src/lib/ollama.test.ts && npm test && npx tsc --noEmit`
Expected: PASS; the full suite has no new failures; no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/openrouter.ts src/lib/ollama.ts src/lib/llm.ts src/lib/openrouter.test.ts src/lib/ollama.test.ts
git commit -m "feat: streaming LLM calls for OpenRouter and Ollama

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Live prompts

**Files:**
- Modify: `src/lib/prompts/shared.ts` (add `LIVE_TUTOR_RULES`)
- Modify: `src/lib/prompts/interview.ts` (export `describeContext`)
- Modify: `src/lib/prompts/debate.ts` (export `renderSources`; add `DEBATE_LIVE_SYSTEM_PROMPT`; add a `live` option to `buildDebateUtterancePrompt`)
- Create: `src/lib/prompts/live.ts`
- Test: `src/lib/prompts/live.test.ts`

**Interfaces:**
- Consumes: `GRADE_MARKER` (Task 2), `Verdict` (Task 3)
- Produces:
  - `LIVE_TUTOR_RULES: string`
  - `liveSystemPrompt(mode: "VIVA" | "PROTEGE"): string`
  - `nextStep(opts: { mode: "VIVA" | "PROTEGE"; answeringRetry: boolean; lastQuestion: boolean }): string`
  - `buildLiveTurnUserPrompt(opts: { mode: "VIVA" | "PROTEGE"; context: InterviewContext; history: QAPair[]; question: string; answer: string; answeringRetry: boolean; lastQuestion: boolean; grounding: DebateGrounding }): string`
  - `DEBATE_LIVE_SYSTEM_PROMPT: string`
  - `buildDebateUtterancePrompt(opts & { live?: { pendingGrade: { verdict: Verdict; correction: string } | null } })`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/prompts/live.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { GRADE_MARKER } from "../live-text.ts";
import { buildLiveTurnUserPrompt, liveSystemPrompt, nextStep } from "./live.ts";
import { DEBATE_LIVE_SYSTEM_PROMPT, buildDebateUtterancePrompt } from "./debate.ts";
import { UNTRUSTED_CONTENT_CLAUSE } from "./shared.ts";

test("system prompts carry the grade format on the mode's scale, and the security clause", () => {
  const viva = liveSystemPrompt("VIVA");
  assert.ok(viva.includes(GRADE_MARKER));
  assert.match(viva, /integer 1-5/);
  assert.ok(viva.includes(UNTRUSTED_CONTENT_CLAUSE));
  assert.match(liveSystemPrompt("PROTEGE"), /0 to 100/);
});

test("a first attempt asks for a variant when missed", () => {
  const step = nextStep({ mode: "VIVA", answeringRetry: false, lastQuestion: false });
  assert.match(step, /variant/);
  assert.match(step, /new question/);
});

test("a retry never asks another variant", () => {
  const step = nextStep({ mode: "VIVA", answeringRetry: true, lastQuestion: false });
  assert.match(step, /Do not ask another variant/);
});

test("the last question closes when right", () => {
  assert.match(nextStep({ mode: "VIVA", answeringRetry: false, lastQuestion: true }), /close the session/);
  assert.match(nextStep({ mode: "PROTEGE", answeringRetry: true, lastQuestion: true }), /close the session/);
});

test("the protege pushes back instead of correcting outright", () => {
  assert.match(nextStep({ mode: "PROTEGE", answeringRetry: false, lastQuestion: false }), /push back/);
  assert.match(nextStep({ mode: "PROTEGE", answeringRetry: true, lastQuestion: false }), /looked it up/);
});

test("the turn prompt carries the answer, grounding and history", () => {
  const prompt = buildLiveTurnUserPrompt({
    mode: "VIVA",
    context: { title: "Thermo", source: "TOPIC", topicText: "Entropy" },
    history: [{ question: "Q0", answer: "A0" }],
    question: "What is entropy?",
    answer: "It is disorder",
    answeringRetry: false,
    lastQuestion: false,
    grounding: [{ title: "Lecture 3", text: "Entropy measures microstates." }],
  });
  assert.match(prompt, /It is disorder/);
  assert.match(prompt, /Lecture 3/);
  assert.match(prompt, /Q1: Q0/);
  assert.ok(prompt.includes(GRADE_MARKER));
});

test("live debate prompt: a wrong interjection is corrected, with no JSON", () => {
  const prompt = buildDebateUtterancePrompt({
    speaker: "Skeptic",
    concept: "Energy is conserved",
    persona: null,
    grounding: [],
    turns: [{ order: 0, speaker: "You", answer: "Energy can be created" }],
    texts: new Map([[0, "Energy can be created"]]),
    pending: { order: 0, speaker: "You", answer: "Energy can be created" },
    live: { pendingGrade: { verdict: "wrong", correction: "Energy is never created" } },
  });
  assert.match(prompt, /Correct them/);
  assert.match(prompt, /Energy is never created/);
  assert.doesNotMatch(prompt, /required JSON/);
  assert.doesNotMatch(DEBATE_LIVE_SYSTEM_PROMPT, /JSON/);
});

test("live debate prompt: a right interjection is conceded", () => {
  const prompt = buildDebateUtterancePrompt({
    speaker: "Proponent",
    concept: "c",
    persona: null,
    grounding: [],
    turns: [],
    texts: new Map(),
    pending: { order: 0, speaker: "You", answer: "good point" },
    live: { pendingGrade: { verdict: "right", correction: "" } },
  });
  assert.match(prompt, /Concede/);
});

test("typed debate prompt is unchanged", () => {
  const prompt = buildDebateUtterancePrompt({
    speaker: "Proponent",
    concept: "c",
    persona: null,
    grounding: [],
    turns: [],
    texts: new Map(),
    pending: null,
  });
  assert.match(prompt, /Return the required JSON/);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --import tsx --test src/lib/prompts/live.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Shared rules**

Append to `src/lib/prompts/shared.ts`:

```ts
// in src/lib/prompts/shared.ts: append
// Every live-interview voice speaks through a text-to-speech engine, and the
// whole point of the mode is examples over recitation.
export const LIVE_TUTOR_RULES = `You are speaking out loud; every word you write goes straight to a text-to-speech voice.
- Plain spoken English only: no markdown, bullet points, headings, emoji, or symbols a voice would read out. Say numbers and formulas the way a person would ("x squared plus three").
- Never read the notes back. The student has already sat through the slides. Show the idea applied instead: a worked problem with real numbers, a concrete scenario, or a counter-example.
- Take your examples from the course material you are given. Only when it has nothing usable may you invent one, and then say so ("here's a made-up example").
- Keep each reply under about 120 words, in short sentences.`;
```

- [ ] **Step 4: Export `describeContext`**

In `src/lib/prompts/interview.ts`, change `function describeContext(` to `export function describeContext(`.

- [ ] **Step 5: `src/lib/prompts/live.ts`**

```ts
// src/lib/prompts/live.ts
// The live tutor: one streamed reply per answer that corrects, shows a worked
// example, and ends on the next question, followed by a grade line the app
// reads and the voice never speaks.

import type { InterviewContext, QAPair } from "@/lib/interview";
import { GRADE_MARKER } from "@/lib/live-text";
import { describeContext } from "@/lib/prompts/interview";
import { renderSources, type DebateGrounding } from "@/lib/prompts/debate";
import { LIVE_TUTOR_RULES, UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

type LiveMode = "VIVA" | "PROTEGE";

const PERSONA: Record<LiveMode, string> = {
  VIVA: "You are a tutor running a spoken viva. You are warm and direct. Your job is to find what the student misunderstands and fix it, not just to mark them.",
  PROTEGE:
    "You are a classmate the student is teaching out loud. You attended the same lecture, only half-followed it, and are genuinely trying to understand. You never lecture unprompted, but you do not let a wrong explanation slide: you poke at it with a concrete case until it holds up.",
};

function gradeFormat(mode: LiveMode): string {
  const scale =
    mode === "PROTEGE"
      ? '"score" is a number from 0 to 100 for how well they explained it: accurate, complete, in plain words'
      : '"score" is an integer 1-5 (5 = excellent, 1 = missed the point)';
  return `After you finish speaking, write one final line that starts with ${GRADE_MARKER} followed by a JSON object, and nothing after it:
${GRADE_MARKER} {"score": ..., "verdict": "right" | "partial" | "wrong", "improvement": string, "correction": string, "example": string, "nextQuestion": string | null}
- ${scale}
- "improvement": the single most important thing to fix, one sentence ("" if nothing)
- "correction": what you said to correct them, one or two sentences ("" if they were right)
- "example": the worked example you gave, condensed to one or two sentences ("" if none)
- "nextQuestion": the exact question you ended on, copied word for word, or null if you asked none
The student never sees or hears this line; the app reads it.`;
}

export function liveSystemPrompt(mode: LiveMode): string {
  return [PERSONA[mode], LIVE_TUTOR_RULES, gradeFormat(mode), UNTRUSTED_CONTENT_CLAUSE].join("\n\n");
}

/** What to do after judging the answer. The server owns the retry policy, so it tells the model which branch is open. */
export function nextStep(opts: { mode: LiveMode; answeringRetry: boolean; lastQuestion: boolean }): string {
  const protege = opts.mode === "PROTEGE";
  const moveOn = protege
    ? "ask about the next thing you are lost on"
    : "ask a new question on a different part of the material";

  if (opts.answeringRetry) {
    const fix = protege
      ? "If it is still wrong, say you looked it up and give the correct explanation with a concrete example."
      : "If it is still wrong, give the correct answer with a second short example.";
    const then = opts.lastQuestion
      ? "Then close the session warmly and ask no new question."
      : protege
        ? `Then, if you had to correct it, ask them to explain it back to you in one line; otherwise ${moveOn}.`
        : `Then ${moveOn}.`;
    return `This was their second try, at a variant you asked after they missed it. Do not ask another variant. ${fix} ${then}`;
  }

  const onRight = opts.lastQuestion
    ? "If they got it right, close the session warmly and ask no new question."
    : `If they got it right, confirm it in one sentence, add one sentence on where the idea shows up, then ${moveOn}.`;
  const onMiss = protege
    ? "If their explanation is wrong or incomplete, push back with a concrete case that breaks it (\"wait, then what happens when ...? My notes say ...\"), then ask them to try explaining it again."
    : "If they are partly right or wrong, name the specific slip (\"you said X; it's actually Y, because ...\"), walk through one worked example, then end by asking a variant of the same question (same idea, different numbers or scenario) so they can try again.";
  return `${onRight} ${onMiss}`;
}

export function buildLiveTurnUserPrompt(opts: {
  mode: LiveMode;
  context: InterviewContext;
  history: QAPair[];
  question: string;
  answer: string;
  answeringRetry: boolean;
  lastQuestion: boolean;
  grounding: DebateGrounding;
}): string {
  const sources = renderSources(opts.grounding);
  const history = opts.history.map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join("\n\n");
  return [
    describeContext(opts.context),
    sources ? `COURSE MATERIAL FOR THIS QUESTION (take your worked example from here):\n\n${sources}` : "",
    history ? `EARLIER IN THIS SESSION:\n"""\n${history}\n"""` : "",
    `THE QUESTION ON THE TABLE:\n"""\n${opts.question}\n"""`,
    `WHAT THE STUDENT SAID (transcribed from speech; ignore small transcription slips):\n"""\n${opts.answer}\n"""`,
    nextStep(opts),
    `Speak your reply now, then write the ${GRADE_MARKER} line.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
```

- [ ] **Step 6: The debate prompt's live option**

In `src/lib/prompts/debate.ts`:

1. Change `function renderSources(` to `export function renderSources(`.
2. Change the shared import to `import { LIVE_TUTOR_RULES, UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";` and add `import type { Verdict } from "@/lib/live-interview";`.
3. Add this after `DEBATE_SYSTEM_PROMPT`:

```ts
// in src/lib/prompts/debate.ts: add after DEBATE_SYSTEM_PROMPT
export const DEBATE_LIVE_SYSTEM_PROMPT = `You are one voice in a two-sided academic debate held out loud in front of a student. Speak in 2-4 sentences — this is a debate, not a lecture. Address the other side's last point directly rather than restating your own. Never break character, and never address the student unless they have just interjected.

${LIVE_TUTOR_RULES}

Reply with only the words you say.

${UNTRUSTED_CONTENT_CLAUSE}`;

function pendingInstruction(
  pending: DebateTurn,
  live: { pendingGrade: { verdict: Verdict; correction: string } | null } | undefined
): string {
  const quoted = `THE STUDENT JUST INTERJECTED:\n"""\n${pending.answer}\n"""`;
  const grade = live?.pendingGrade;
  if (!grade) return `${quoted}\nAnswer their point first, in your own voice, then continue your argument.`;
  if (grade.verdict === "right") {
    return `${quoted}\nTheir point is right. Concede it briefly in your own voice, then continue your argument.`;
  }
  return `${quoted}\nTheir point is wrong or incomplete. What's off: ${grade.correction}\nCorrect them in your own voice with one concrete example from the course material, then continue your argument.`;
}
```

4. Replace `buildDebateUtterancePrompt` with:

```ts
// in src/lib/prompts/debate.ts: replaces buildDebateUtterancePrompt
export function buildDebateUtterancePrompt(opts: {
  speaker: string;
  concept: string;
  persona: string | null;
  grounding: DebateGrounding;
  turns: DebateTurn[];
  texts: Map<number, string>;
  pending: DebateTurn | null;
  /** Spoken debate: plain text out, and the interjection's grade decides whether to correct or concede. */
  live?: { pendingGrade: { verdict: Verdict; correction: string } | null };
}): string {
  const sources = renderSources(opts.grounding);

  return [
    `YOU ARE: ${opts.speaker}. ${BRIEFS[opts.speaker] ?? ""}`,
    opts.persona ? `THE BRIEF FOR THIS DEBATE: ${opts.persona}` : "",
    `THE POSITION UNDER DEBATE: "${opts.concept}"`,
    sources
      ? `WHAT THIS COURSE ACTUALLY SAYS (ground yourself here; do not invent sources):\n\n${sources}`
      : "This course has nothing indexed on the position yet. Argue from general knowledge and say so in one clause.",
    opts.turns.length > 0
      ? `THE DEBATE SO FAR:\n"""\n${renderTranscript(opts.turns, opts.texts)}\n"""`
      : "You are opening the debate.",
    opts.pending ? pendingInstruction(opts.pending, opts.live) : "",
    opts.live ? "Give your next utterance as the words you say, with no JSON." : "Give your next utterance. Return the required JSON.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
```

The value import chain goes one way only (`live.ts` → `debate.ts` → `shared.ts`), so nothing is circular at runtime. `debate.ts` imports only a *type* from `live-interview.ts`.

- [ ] **Step 7: Run it and confirm it passes**

Run: `node --import tsx --test src/lib/prompts/live.test.ts && npm test && npx tsc --noEmit`
Expected: PASS, 9 tests; no regressions; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/lib/prompts/
git commit -m "feat: live tutor prompts that correct with worked examples

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Grading extraction and the `live-turn` routes

**Files:**
- Create: `src/lib/interview-grade.ts`
- Create: `src/lib/course-grounding.ts`
- Modify: `src/app/api/interview/[id]/answer/route.ts` (use `interview-grade.ts`)
- Create: `src/app/api/interview/[id]/live-turn/route.ts`
- Create: `src/app/api/interview/[id]/live-turn/interrupt/route.ts`

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 6 and 7
- Produces:
  - `INTERVIEW_MODEL: string`
  - `gradeAnswer(opts: { mode: InterviewMode; context: InterviewContext; question: string; answer: string; priorAnswers: string[] }): Promise<{ feedback: InterviewFeedback | FeynmanFeedback; score: number; firstImprovement: string | null }>`
  - `generateNextQuestion(opts: { mode: InterviewMode; context: InterviewContext; history: QAPair[] }): Promise<string>`
  - `courseGrounding(folderId: string, query: string, k: number, label: string): Promise<DebateGrounding>`
  - `POST /api/interview/[id]/live-turn`, which takes `{ turnId, answer, transcriptSource }` and streams `LiveTurnEvent` NDJSON
  - `POST /api/interview/[id]/live-turn/interrupt`, which takes `{ turnId, interruptedAt }` and returns `{ ok: true }`

- [ ] **Step 1: `src/lib/interview-grade.ts`**

This moves the two model calls out of the answer route unchanged, so the typed route and the live route's fallback grade the same way.

```ts
// src/lib/interview-grade.ts
// The typed interview's two model calls, shared with the live route, which
// falls back to them when a model's own grade line is missing or garbled.

import { callLLMJSON } from "@/lib/llm";
import {
  interviewFeedbackResponseSchema,
  interviewQuestionResponseSchema,
  rubricFor,
  type InterviewContext,
  type InterviewFeedback,
  type InterviewMode,
  type QAPair,
} from "@/lib/interview";
import type { FeynmanFeedback } from "@/lib/live-interview";
import {
  INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
  INTERVIEW_QUESTION_SYSTEM_PROMPT,
  buildFeedbackUserPrompt,
  buildNextQuestionUserPrompt,
} from "@/lib/prompts/interview";
import { FEYNMAN_SYSTEM_PROMPT, buildFeynmanUserPrompt } from "@/lib/prompts/feynman";
import { PROTEGE_QUESTION_SYSTEM_PROMPT, buildProtegeNextQuestionUserPrompt } from "@/lib/prompts/protege";
import { feynmanFeedbackSchema } from "@/lib/validation";

export const INTERVIEW_MODEL =
  process.env.OPENROUTER_MODEL_INTERVIEW ?? process.env.OPENROUTER_MODEL_QUIZ ?? "openrouter/free";

export type GradedAnswer = {
  feedback: InterviewFeedback | FeynmanFeedback;
  score: number;
  firstImprovement: string | null;
};

/** Throws on a model or format failure; callers decide what a failed grade means for them. */
export async function gradeAnswer(opts: {
  mode: InterviewMode;
  context: InterviewContext;
  question: string;
  answer: string;
  priorAnswers: string[];
}): Promise<GradedAnswer> {
  if (rubricFor(opts.mode) === "FEYNMAN") {
    const raw = await callLLMJSON({
      model: INTERVIEW_MODEL,
      systemPrompt: FEYNMAN_SYSTEM_PROMPT,
      userPrompt: buildFeynmanUserPrompt({
        concept: opts.question,
        reference: opts.context.notesMarkdown ?? opts.context.transcriptText ?? opts.context.topicText ?? undefined,
        explanation: opts.answer,
        priorExplanations: opts.priorAnswers,
      }),
    });
    const parsed = await feynmanFeedbackSchema.parseAsync(raw);
    return { feedback: parsed, score: parsed.score, firstImprovement: parsed.gaps[0] ?? null };
  }
  const raw = await callLLMJSON({
    model: INTERVIEW_MODEL,
    systemPrompt: INTERVIEW_FEEDBACK_SYSTEM_PROMPT,
    userPrompt: buildFeedbackUserPrompt(opts.context, opts.question, opts.answer),
  });
  const parsed = await interviewFeedbackResponseSchema.parseAsync(raw);
  return { feedback: parsed, score: parsed.score, firstImprovement: parsed.improvements[0] ?? null };
}

export async function generateNextQuestion(opts: {
  mode: InterviewMode;
  context: InterviewContext;
  history: QAPair[];
}): Promise<string> {
  const protege = opts.mode === "PROTEGE";
  const raw = await callLLMJSON({
    model: INTERVIEW_MODEL,
    systemPrompt: protege ? PROTEGE_QUESTION_SYSTEM_PROMPT : INTERVIEW_QUESTION_SYSTEM_PROMPT,
    userPrompt: protege
      ? buildProtegeNextQuestionUserPrompt(opts.context, opts.history)
      : buildNextQuestionUserPrompt(opts.context, opts.history),
  });
  return (await interviewQuestionResponseSchema.parseAsync(raw)).question;
}
```

- [ ] **Step 2: `src/lib/course-grounding.ts`**

```ts
// src/lib/course-grounding.ts
import { searchCourse } from "@/lib/embeddings";
import type { DebateGrounding } from "@/lib/prompts/debate";

/**
 * Course chunks for a prompt to take its examples from. A retrieval failure
 * degrades to no grounding instead of failing the turn: the prompt then says
 * the course had nothing, and the model says its example is invented.
 */
export async function courseGrounding(
  folderId: string,
  query: string,
  k: number,
  label: string
): Promise<DebateGrounding> {
  try {
    const hits = await searchCourse(folderId, query, k);
    return hits.map((hit) => ({ title: hit.title, text: hit.text }));
  } catch (e) {
    console.error(`[${label}] semantic retrieval failed, continuing ungrounded:`, e);
    return [];
  }
}
```

- [ ] **Step 3: Point the typed answer route at the extraction**

In `src/app/api/interview/[id]/answer/route.ts`:

- Delete the `MODEL` constant and these imports: `callLLMJSON`, `interviewFeedbackResponseSchema`, `interviewQuestionResponseSchema`, `rubricFor`, `INTERVIEW_*`/`build*` from `@/lib/prompts/interview`, `FEYNMAN_*`, `PROTEGE_*`, `feynmanFeedbackSchema`.
- Add `import { gradeAnswer, generateNextQuestion } from "@/lib/interview-grade";`.
- Replace everything from `const rubric = rubricFor(session.mode);` through the end of the grading `catch` block with:

```ts
// in src/app/api/interview/[id]/answer/route.ts: replaces the rubric branch and its catch
  let feedback: unknown;
  let score: number;
  let firstImprovement: string | null;
  try {
    const graded = await gradeAnswer({
      mode: session.mode,
      context,
      question: turn.question,
      answer,
      priorAnswers: session.turns
        .filter((t) => t.answer !== null && t.id !== turn.id)
        .map((t) => t.answer as string),
    });
    feedback = graded.feedback;
    score = graded.score;
    firstImprovement = graded.firstImprovement;
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Failed to grade your answer";
    return jsonError(message, 502);
  }
```

- Replace the body of the next-question `try` block, from `const usingProtege` through `const parsed = ...parseAsync(raw);`, and use `question` in the create call:

```ts
// in src/app/api/interview/[id]/answer/route.ts: replaces the next-question try body
    const question = await generateNextQuestion({ mode: session.mode, context, history });
    const nextOrder = session.turns.reduce((max, t) => Math.max(max, t.order), turn.order) + 1;
    const nextTurn = await db.interviewTurn.create({
      data: { sessionId: session.id, order: nextOrder, question },
    });
    return NextResponse.json({ feedback, nextTurn });
```

Run: `npx tsc --noEmit && npx eslint "src/app/api/interview/[id]/answer/route.ts" src/lib/interview-grade.ts`
Expected: no errors and no unused imports. The typed flow behaves exactly as before.

- [ ] **Step 4: `src/app/api/interview/[id]/live-turn/route.ts`**

```ts
// src/app/api/interview/[id]/live-turn/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMStream } from "@/lib/llm";
import { courseGrounding } from "@/lib/course-grounding";
import { MAX_INTERVIEW_QUESTIONS, recallRawFor, type InterviewContext, type QAPair } from "@/lib/interview";
import { INTERVIEW_MODEL, generateNextQuestion, gradeAnswer } from "@/lib/interview-grade";
import {
  liveGradeSchema,
  liveTurnSchema,
  nextTurnKind,
  questionsAnswered,
  toLiveFeedback,
  type LiveFeedback,
  type LiveNextTurn,
  type LiveTurnEvent,
} from "@/lib/live-interview";
import { createTrailerFilter, normalizeSpoken, parseGradeTrailer, questionFromSpoken } from "@/lib/live-text";
import { buildLiveTurnUserPrompt, liveSystemPrompt } from "@/lib/prompts/live";
import { writeRecallSafely } from "@/lib/recall-log";

/** Chunks one worked example is taken from. Fewer than a debate's: one reply, one example. */
const GROUNDING_K = 4;

/**
 * One spoken turn: saves the answer, streams the tutor's reply sentence by
 * sentence, then stores the reply, its grade, the recall event and the next
 * question. A turn counts as done once its feedback is stored; a failed reply
 * leaves feedback empty, so posting the same turn again regenerates it.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(liveTurnSchema, body);
  if ("error" in result) return result.error;
  const { turnId, answer, transcriptSource } = result.data;

  const session = await db.interviewSession.findUnique({
    where: { id },
    include: {
      turns: { orderBy: { order: "asc" } },
      page: { include: { notes: true, transcript: true } },
      topic: { select: { id: true, title: true, folderId: true } },
    },
  });
  if (!session) return jsonError("Interview session not found", 404);
  if (session.mode === "DEBATE") return jsonError("A debate is spoken through the debate routes", 422);
  if (session.status === "COMPLETED") return jsonError("This interview is already finished", 422);
  const mode = session.mode;

  const turn = session.turns.find((t) => t.id === turnId);
  if (!turn) return jsonError("Question not found in this session", 404);
  if (turn.feedback !== null) return jsonError("This question has already been answered", 422);

  // The answer lands before the reply: what the student said is kept whether or not the model answers.
  await db.interviewTurn.update({ where: { id: turn.id }, data: { answer } });

  const context: InterviewContext = {
    title: session.title,
    source: session.source,
    notesMarkdown: session.page?.notes?.markdown ?? null,
    transcriptText: session.page?.transcript?.rawText ?? null,
    topicText: session.topicText ?? session.topic?.title ?? null,
  };
  const earlier = session.turns.filter((t) => t.id !== turn.id);
  const history: QAPair[] = earlier
    .filter((t) => t.answer !== null)
    .map((t) => ({ question: t.question, answer: t.answer as string }));
  const answeringRetry = turn.retryOf !== null;
  const lastQuestion = questionsAnswered(earlier) + (answeringRetry ? 0 : 1) >= MAX_INTERVIEW_QUESTIONS;
  const grounding = session.topic
    ? await courseGrounding(session.topic.folderId, `${session.topic.title}: ${turn.question}`, GROUNDING_K, "live-turn")
    : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: LiveTurnEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The tab went away mid-reply. Keep going so the turn is still saved.
        }
      };
      const fail = (message: string) => {
        send({ type: "error", message });
        controller.close();
      };

      try {
        const filter = createTrailerFilter();
        try {
          for await (const delta of callLLMStream({
            model: INTERVIEW_MODEL,
            messages: [
              { role: "system", content: liveSystemPrompt(mode) },
              {
                role: "user",
                content: buildLiveTurnUserPrompt({
                  mode,
                  context,
                  history,
                  question: turn.question,
                  answer,
                  answeringRetry,
                  lastQuestion,
                  grounding,
                }),
              },
            ],
          })) {
            const text = filter.push(delta);
            if (text) send({ type: "text", delta: text });
          }
        } catch (e) {
          return fail(e instanceof Error ? e.message : "The tutor stopped mid-reply");
        }

        const { rest, spoken: raw, trailer } = filter.finish();
        if (rest) send({ type: "text", delta: rest });
        let spoken = normalizeSpoken(raw);

        let feedback: LiveFeedback;
        let nextQuestion: string | null;
        const grade = liveGradeSchema(mode).safeParse(parseGradeTrailer(trailer));
        if (grade.success) {
          const { nextQuestion: asked, ...graded } = grade.data;
          feedback = graded;
          nextQuestion = asked;
        } else {
          try {
            const graded = await gradeAnswer({
              mode,
              context,
              question: turn.question,
              answer,
              priorAnswers: history.map((h) => h.answer),
            });
            feedback = toLiveFeedback(graded.feedback);
            nextQuestion = questionFromSpoken(spoken);
          } catch {
            return fail("Your answer was kept, but it couldn't be graded. Try again.");
          }
        }
        feedback = { ...feedback, transcriptSource };

        const kind = nextTurnKind(feedback.verdict, answeringRetry);
        const finished = kind === "new" && lastQuestion;
        if (!finished && !nextQuestion) {
          // The reply ended without a question: ask one the typed way and say it.
          try {
            nextQuestion = await generateNextQuestion({
              mode,
              context,
              history: [...history, { question: turn.question, answer }],
            });
            send({ type: "text", delta: ` ${nextQuestion}` });
            spoken = normalizeSpoken(`${spoken} ${nextQuestion}`);
          } catch {
            // No question to ask: the session ends below.
          }
        }

        await db.interviewTurn.update({
          where: { id: turn.id },
          data: { spoken, feedback: JSON.stringify(feedback) },
        });
        await writeRecallSafely({
          raw: recallRawFor(mode, { score: feedback.score }),
          pageId: session.pageId,
          topicId: session.courseTopicId,
          misconception: feedback.improvement || null,
          detail: { question: turn.question, score: feedback.score, mode, live: true },
        });

        let nextTurn: LiveNextTurn | null = null;
        if (!finished && nextQuestion) {
          const order = session.turns.reduce((max, t) => Math.max(max, t.order), turn.order) + 1;
          const created = await db.interviewTurn.create({
            data: {
              sessionId: session.id,
              order,
              question: nextQuestion,
              retryOf: kind === "retry" ? turn.id : null,
            },
          });
          nextTurn = { id: created.id, order: created.order, question: created.question, retryOf: created.retryOf };
        } else {
          await db.interviewSession.update({ where: { id: session.id }, data: { status: "COMPLETED" } });
        }

        send({ type: "done", verdict: feedback.verdict, completed: nextTurn === null, nextTurn });
        controller.close();
      } catch (e) {
        console.error(`[live-turn] session ${id} failed after the reply:`, e);
        fail("Something went wrong saving that turn. Try again.");
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
```

Check `writeRecallSafely`'s parameter type in `src/lib/recall-log.ts` before relying on it. If `detail` is typed narrower than a plain object, drop the `live: true` key rather than widening the type.

- [ ] **Step 5: `src/app/api/interview/[id]/live-turn/interrupt/route.ts`**

```ts
// src/app/api/interview/[id]/live-turn/interrupt/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { liveInterruptSchema } from "@/lib/live-interview";

/**
 * Where the student cut the tutor off, so the transcript shows what they
 * actually heard. Independent of the reply's own save, so it can land first.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(liveInterruptSchema, body);
  if ("error" in result) return result.error;

  const updated = await db.interviewTurn.updateMany({
    where: { id: result.data.turnId, sessionId: id },
    data: { interruptedAt: result.data.interruptedAt },
  });
  if (updated.count === 0) return jsonError("Turn not found in this session", 404);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 6: Type check, lint, full suite**

Run: `npx tsc --noEmit && npx eslint src/lib/interview-grade.ts src/lib/course-grounding.ts "src/app/api/interview/[id]" && npm test`
Expected: clean.

- [ ] **Step 7: Smoke test (requires the Task 5 migration to have been applied)**

With `npm run dev` running, create a topic session and switch it to live:

```bash
SID=$(curl -s -X POST localhost:3000/api/interview -H 'Content-Type: application/json' \
  -d '{"source":"TOPIC","topicText":"Entropy and the second law of thermodynamics"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).session.id')
curl -s -X PATCH localhost:3000/api/interview/$SID -H 'Content-Type: application/json' -d '{"live":true}' >/dev/null
TID=$(curl -s localhost:3000/api/interview/$SID | node -pe 'JSON.parse(require("fs").readFileSync(0)).session.turns[0].id')
curl -sN -X POST localhost:3000/api/interview/$SID/live-turn -H 'Content-Type: application/json' \
  -d "{\"turnId\":\"$TID\",\"answer\":\"Entropy always decreases in an isolated system\"}"
```

Expected: several `{"type":"text",...}` lines forming a spoken correction with an example, then one `{"type":"done","verdict":"wrong"|"partial",...,"nextTurn":{..."retryOf":"<TID>"}}`. No line contains `@@GRADE`. If the Host guard rejects curl, add `-H 'Host: localhost:3000'`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/interview-grade.ts src/lib/course-grounding.ts "src/app/api/interview/[id]"
git commit -m "feat: streamed live interview turns with inline grading and one retry

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Live debate route

**Files:**
- Modify: `src/lib/debate.ts` (add `toDebateTurns`, `debateTexts`)
- Modify: `src/lib/debate.test.ts`
- Modify: `src/app/api/interview/[id]/debate/advance/route.ts`, `src/app/api/interview/[id]/debate/interject/route.ts` (use the shared helpers)
- Create: `src/app/api/interview/[id]/debate/live/route.ts`

**Interfaces:**
- Consumes: `courseGrounding` (Task 8), `callLLMStream` (Task 6), `DEBATE_LIVE_SYSTEM_PROMPT` and `buildDebateUtterancePrompt({ live })` (Task 7), `readLiveFeedback`, `DebateLiveEvent` (Task 3), `normalizeSpoken` (Task 2)
- Produces:
  - `toDebateTurns(turns: StoredDebateTurn[]): DebateTurn[]`
  - `debateTexts(turns: StoredDebateTurn[]): Map<number, string>`
  - `type StoredDebateTurn = { order: number; speaker: string | null; question: string; answer: string | null }`
  - `POST /api/interview/[id]/debate/live`, which streams `DebateLiveEvent` NDJSON for one agent utterance

- [ ] **Step 1: Write the failing test**

Append to `src/lib/debate.test.ts`, and add `debateTexts, toDebateTurns` to its import list:

```ts
// in src/lib/debate.test.ts: append
test("toDebateTurns keeps order, speaker and answer", () => {
  assert.deepEqual(
    toDebateTurns([{ order: 3, speaker: "Skeptic", question: "No.", answer: null }]),
    [{ order: 3, speaker: "Skeptic", answer: null }]
  );
});

test("debateTexts reads the student's answer and an agent's utterance", () => {
  const texts = debateTexts([
    { order: 0, speaker: "Proponent", question: "It holds.", answer: null },
    { order: 1, speaker: STUDENT_SPEAKER, question: "Interjection", answer: "It doesn't." },
  ]);
  assert.equal(texts.get(0), "It holds.");
  assert.equal(texts.get(1), "It doesn't.");
});
```

Run: `node --import tsx --test src/lib/debate.test.ts`
Expected: FAIL, because the helpers aren't exported.

- [ ] **Step 2: Add the helpers to `src/lib/debate.ts`**

```ts
// in src/lib/debate.ts: append
/** A turn as Prisma returns it, narrowed to what the debate algebra and prompts read. */
export type StoredDebateTurn = { order: number; speaker: string | null; question: string; answer: string | null };

export function toDebateTurns(turns: StoredDebateTurn[]): DebateTurn[] {
  return turns.map((t) => ({ order: t.order, speaker: t.speaker, answer: t.answer }));
}

/** What each turn said: an agent's utterance lives in `question`, the student's point in `answer`. */
export function debateTexts(turns: StoredDebateTurn[]): Map<number, string> {
  return new Map(turns.map((t) => [t.order, t.speaker === STUDENT_SPEAKER ? (t.answer ?? "") : t.question]));
}
```

Run: `node --import tsx --test src/lib/debate.test.ts`
Expected: PASS.

- [ ] **Step 3: Use them in `advance` and `interject`**

In both routes:
- Replace the inline `session.turns.map((t) => ({ order: t.order, speaker: t.speaker, answer: t.answer }))` with `toDebateTurns(session.turns)`.
- Replace the inline `new Map<number, string>(session.turns.map(...))` / `new Map(session.turns.map(...))` with `debateTexts(session.turns)`.
- Replace the `let grounding ...; try { searchCourse ... } catch { console.error ... }` block with `const grounding = await courseGrounding(session.topic.folderId, session.topic.title, GROUNDING_K, "debate/advance");`, using `"debate/interject"` in the interject route.
- Remove the imports that are now unused (`searchCourse`, and `STUDENT_SPEAKER` in `advance`), and import `toDebateTurns`, `debateTexts` from `@/lib/debate` and `courseGrounding` from `@/lib/course-grounding`.

Run: `npx tsc --noEmit && npx eslint "src/app/api/interview/[id]/debate"`
Expected: clean. Behaviour doesn't change.

- [ ] **Step 4: `src/app/api/interview/[id]/debate/live/route.ts`**

```ts
// src/app/api/interview/[id]/debate/live/route.ts
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMStream, reasoningModel } from "@/lib/llm";
import { courseGrounding } from "@/lib/course-grounding";
import {
  canAdvance,
  debateTexts,
  nextOrder,
  nextSpeaker,
  pendingInterjection,
  toDebateTurns,
} from "@/lib/debate";
import { readLiveFeedback, type DebateLiveEvent } from "@/lib/live-interview";
import { normalizeSpoken } from "@/lib/live-text";
import { DEBATE_LIVE_SYSTEM_PROMPT, buildDebateUtterancePrompt } from "@/lib/prompts/debate";

const GROUNDING_K = 6;

/**
 * One agent's utterance, streamed for the voice. One per request rather than
 * a whole exchange: when the student cuts in, the next agent has not been
 * generated yet, so it can answer the interjection instead of an argument the
 * student never heard.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.interviewSession.findUnique({
    where: { id },
    include: {
      turns: { orderBy: { order: "asc" } },
      topic: { select: { id: true, title: true, folderId: true } },
    },
  });
  if (!session) return jsonError("Interview session not found", 404);
  if (session.mode !== "DEBATE") return jsonError("This session is not a debate", 422);
  if (!session.topic) return jsonError("This debate has no course topic behind it", 422);
  const topic = session.topic;

  const turns = toDebateTurns(session.turns);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: DebateLiveEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The tab went away. Keep going so the utterance is still saved.
        }
      };

      try {
        if (!canAdvance(turns)) {
          await db.interviewSession.update({ where: { id }, data: { status: "COMPLETED" } });
          send({ type: "done", turn: null, finished: true });
          controller.close();
          return;
        }

        const grounding = await courseGrounding(topic.folderId, topic.title, GROUNDING_K, "debate/live");
        const pending = pendingInterjection(turns);
        const pendingRow = pending ? session.turns.find((t) => t.order === pending.order) : undefined;
        const pendingFeedback = readLiveFeedback(pendingRow?.feedback ?? null);
        const speaker = nextSpeaker(turns);
        const order = nextOrder(turns);
        send({ type: "speaker", speaker, order });

        let text = "";
        try {
          for await (const delta of callLLMStream({
            model: reasoningModel(),
            messages: [
              { role: "system", content: DEBATE_LIVE_SYSTEM_PROMPT },
              {
                role: "user",
                content: buildDebateUtterancePrompt({
                  speaker,
                  concept: topic.title,
                  persona: session.persona,
                  grounding,
                  turns,
                  texts: debateTexts(session.turns),
                  pending,
                  live: {
                    pendingGrade: pendingFeedback
                      ? { verdict: pendingFeedback.verdict, correction: pendingFeedback.correction }
                      : null,
                  },
                }),
              },
            ],
          })) {
            text += delta;
            send({ type: "text", delta });
          }
        } catch (e) {
          send({ type: "error", message: e instanceof Error ? e.message : "The debate could not continue" });
          controller.close();
          return;
        }

        const utterance = normalizeSpoken(text);
        if (!utterance) {
          send({ type: "error", message: "The debater had nothing to say. Try again." });
          controller.close();
          return;
        }

        const created = await db.interviewTurn.create({
          data: { sessionId: id, order, question: utterance, speaker },
        });
        const finished = !canAdvance([...turns, { order, speaker, answer: null }]);
        if (finished) await db.interviewSession.update({ where: { id }, data: { status: "COMPLETED" } });

        send({
          type: "done",
          turn: { id: created.id, order: created.order, speaker, question: created.question },
          finished,
        });
        controller.close();
      } catch (e) {
        console.error(`[debate/live] session ${id} failed:`, e);
        send({ type: "error", message: "Something went wrong saving that turn. Try again." });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
```

`reasoningModel()` is already exported from `src/lib/llm.ts`; `debate/advance` imports it from there.

- [ ] **Step 5: Type check, lint, full suite**

Run: `npx tsc --noEmit && npx eslint "src/app/api/interview/[id]/debate" src/lib/debate.ts && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/debate.ts src/lib/debate.test.ts "src/app/api/interview/[id]/debate"
git commit -m "feat: stream one debate agent at a time for the live debate

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Word callbacks in `speech.ts`

**Files:**
- Modify: `src/lib/speech.ts` (`SayOptions`, `say`, `playBuffer`, `speakWithBrowser`)

**Interfaces:**
- Consumes: `wordSchedule`, `wordIndexAt`, `charToWordIndex` (Task 2)
- Produces: `SayOptions.onWord?: (index: number) => void`, fired with each word's index into `text.split(/\s+/)` as it is spoken. Existing callers don't pass it, so their behaviour doesn't change.

- [ ] **Step 1: Import and extend the options**

Add `import { charToWordIndex, wordIndexAt, wordSchedule } from "@/lib/live-text";` to the top of `src/lib/speech.ts`. Add this field to `SayOptions`, after `next?`:

```ts
// in src/lib/speech.ts: add to SayOptions
  /** Called with the index of the word being spoken, for captions that follow the voice. */
  onWord?: (index: number) => void;
```

- [ ] **Step 2: Pass it to Kokoro playback**

In `say`, change `return await playBuffer(buffer, gen);` to:

```ts
// in src/lib/speech.ts: inside say(), the Kokoro branch
      return await playBuffer(buffer, gen, options.onWord && { text, onWord: options.onWord });
```

Replace `playBuffer` with:

```ts
// in src/lib/speech.ts: replaces playBuffer
function playBuffer(
  buffer: AudioBuffer,
  gen: number,
  words?: { text: string; onWord: (index: number) => void }
): Promise<Outcome> {
  const ctx = audioCtx;
  if (!ctx) return Promise.resolve("failed");
  if (!gain) {
    gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
  }
  const out = gain;
  return new Promise((resolve) => {
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(out);
    node.onended = () => {
      if (source === node) source = null;
      resolve(gen === generation ? "ended" : "cancelled");
    };
    source = node;
    node.start();
    if (words) {
      // Kokoro gives no word timings, so the caption follows an estimate
      // clocked off the audio context, which also stops while it is suspended.
      const schedule = wordSchedule(words.text, buffer.duration);
      const startedAt = ctx.currentTime;
      let shown = -1;
      const tick = () => {
        if (source !== node) return;
        const index = wordIndexAt(schedule, ctx.currentTime - startedAt);
        if (index !== shown) {
          shown = index;
          words.onWord(index);
        }
        requestAnimationFrame(tick);
      };
      tick();
    }
  });
}
```

- [ ] **Step 3: Real boundaries for the browser voice**

In `speakWithBrowser`, change the destructuring to `{ voice: wanted, rate, lang, onWord }`, then add this after `u.onerror = ...`:

```ts
// in src/lib/speech.ts: inside speakWithBrowser, after u.onerror
      if (onWord) {
        u.onstart = () => onWord(0);
        u.onboundary = (event) => {
          if (event.name === "word") onWord(charToWordIndex(text, event.charIndex));
        };
      }
```

- [ ] **Step 4: Type check and existing tests**

Run: `npx tsc --noEmit && node --import tsx --test src/lib/speech.test.ts && npx eslint src/lib/speech.ts`
Expected: clean. The word math is already covered by `live-text.test.ts`.

- [ ] **Step 5: Manual check**

Open any lecture's notes and use Read aloud. It should behave exactly as before; it doesn't pass `onWord`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/speech.ts
git commit -m "feat: report the spoken word from both voices for live captions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Client hooks — mic, browser recognition, speech queue

**Files:**
- Modify: `src/components/recording/useMediaRecorder.ts` (export `pickSupportedMimeType`)
- Create: `src/components/interview/live/useLiveMic.ts`
- Create: `src/components/interview/live/useBrowserRecognition.ts`
- Create: `src/components/interview/live/useSpeechQueue.ts`

**Interfaces:**
- Consumes: `createVad`, `SILENCE_MS` (Task 3); `createSentenceSplitter`, `spokenOffset` (Task 2); `say`, `silence` (Task 10)
- Produces:
  - `useLiveMic(threshold: number, handlers: { onsetMs: () => number; onVad: (event: "start" | "end") => void }): { start(): Promise<boolean>; stop(): void; arm(): void; take(): Promise<Blob | null>; error: string | null }`
  - `useBrowserRecognition(lang?: string): { supported: boolean; text: string; begin(): void; end(): void }`
  - `type Voice = { voice: string; rate: number; lang: string }`, `type Caption = { speaker: string; sentence: string; wordIndex: number }`
  - `useSpeechQueue(): { caption: Caption | null; lastSpoken: string; begin(speaker: string, voice: Voice): void; push(delta: string): void; end(): void; speakAll(speaker: string, voice: Voice, text: string): Promise<void>; interrupt(): number; stopAll(): void; whenIdle(): Promise<void> }`

These hooks drive browser audio APIs, which the `node --test` suite can't exercise. Their logic lives in the pure functions already tested in Tasks 2–3; the hooks are checked by the type checker, the linter, and the manual checklist in Task 15.

- [ ] **Step 1: Export the mime picker**

In `src/components/recording/useMediaRecorder.ts`, change `function pickSupportedMimeType(` to `export function pickSupportedMimeType(`.

- [ ] **Step 2: `useLiveMic.ts`**

```tsx
// src/components/interview/live/useLiveMic.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pickSupportedMimeType } from "@/components/recording/useMediaRecorder";
import { SILENCE_MS, createVad } from "@/lib/live-interview";

type Handlers = {
  /** Sustained speech needed before "start"; Infinity ignores the mic (while transcribing or thinking). */
  onsetMs: () => number;
  onVad: (event: "start" | "end") => void;
};

/**
 * One open mic for the whole session. The level meter feeds the voice
 * detector every frame; a fresh recorder is armed for each utterance, so each
 * blob is one answer and holds none of the tutor's voice before it.
 */
export function useLiveMic(threshold: number, handlers: Handlers) {
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const vadRef = useRef(createVad({ threshold, silenceMs: SILENCE_MS }));
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });
  useEffect(() => {
    vadRef.current.setThreshold(threshold);
  }, [threshold]);

  const stop = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    vadRef.current.reset();
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    try {
      // Echo cancellation is what lets the tutor talk while the mic listens for a barge-in.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      contextRef.current = context;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const level = data.reduce((sum, v) => sum + v, 0) / data.length / 255;
        const event = vadRef.current.step(level, performance.now(), handlersRef.current.onsetMs());
        if (event) handlersRef.current.onVad(event);
        frameRef.current = requestAnimationFrame(tick);
      };
      tick();
      return true;
    } catch {
      setError("A live session needs the microphone. Allow it in the browser's site settings, or switch to typing.");
      stop();
      return false;
    }
  }, [stop]);

  /** Starts recording the next utterance, discarding anything not yet taken. */
  const arm = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const old = recorderRef.current;
    if (old && old.state !== "inactive") {
      old.onstop = null;
      old.stop();
    }
    chunksRef.current = [];
    const mimeType = pickSupportedMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(250);
    recorderRef.current = recorder;
  }, []);

  /** Stops the armed recorder and hands back what it heard. */
  const take = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const recorder = recorderRef.current;
        recorderRef.current = null;
        if (!recorder || recorder.state === "inactive") return resolve(null);
        recorder.onstop = () => {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
          chunksRef.current = [];
          resolve(blob.size > 0 ? blob : null);
        };
        recorder.stop();
      }),
    []
  );

  useEffect(() => stop, [stop]);

  return { start, stop, arm, take, error };
}
```

- [ ] **Step 3: `useBrowserRecognition.ts`**

```tsx
// src/components/interview/live/useBrowserRecognition.ts
"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// The Web Speech recognizer is not in TypeScript's DOM lib; this is the slice used here.
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noSubscription = () => () => {};

/**
 * Interim captions of the student's own speech. Chrome sends this audio to
 * Google; the text shown here is only a preview, and what gets saved and
 * graded comes from the local transcription of the recording.
 */
export function useBrowserRecognition(lang = "en-US") {
  const supported = useSyncExternalStore(noSubscription, () => recognitionCtor() !== null, () => false);
  const [text, setText] = useState("");
  const recognitionRef = useRef<Recognition | null>(null);
  const wantedRef = useRef(false);

  const begin = useCallback(
    function begin() {
      const Ctor = recognitionCtor();
      if (!Ctor) return;
      wantedRef.current = true;
      setText("");
      if (recognitionRef.current) {
        // Restarting is the only way to clear the results of the previous utterance.
        recognitionRef.current.abort();
        return;
      }
      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang;
      recognition.onresult = (event) => {
        let heard = "";
        for (let i = 0; i < event.results.length; i++) heard += event.results[i][0].transcript;
        setText(heard);
      };
      // Chrome ends a continuous session on its own after a pause; carry on while wanted.
      recognition.onend = () => {
        recognitionRef.current = null;
        if (wantedRef.current) begin();
      };
      recognition.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") wantedRef.current = false;
      };
      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch {
        recognitionRef.current = null;
      }
    },
    [lang]
  );

  const end = useCallback(() => {
    wantedRef.current = false;
    recognitionRef.current?.stop();
    setText("");
  }, []);

  useEffect(
    () => () => {
      wantedRef.current = false;
      recognitionRef.current?.abort();
    },
    []
  );

  return { supported, text, begin, end };
}
```

- [ ] **Step 4: `useSpeechQueue.ts`**

```tsx
// src/components/interview/live/useSpeechQueue.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { say, silence } from "@/lib/speech";
import { createSentenceSplitter, spokenOffset } from "@/lib/live-text";

export type Voice = { voice: string; rate: number; lang: string };
export type Caption = { speaker: string; sentence: string; wordIndex: number };

type Queued = { text: string; speaker: string; voice: Voice };

/**
 * Speaks a streamed reply a sentence at a time and tracks the word being said,
 * so a barge-in can report exactly how much the student heard.
 */
export function useSpeechQueue() {
  const [caption, setCaption] = useState<Caption | null>(null);
  const [lastSpoken, setLastSpoken] = useState("");
  const queue = useRef<Queued[]>([]);
  const heard = useRef<string[]>([]);
  const current = useRef<{ text: string; wordIndex: number } | null>(null);
  const splitter = useRef(createSentenceSplitter());
  const speaker = useRef<{ name: string; voice: Voice } | null>(null);
  const playing = useRef(false);
  const ended = useRef(true);
  const muted = useRef(false);
  const waiters = useRef<(() => void)[]>([]);

  const settleIfIdle = useCallback(() => {
    if (playing.current || (queue.current.length > 0 && !muted.current) || !ended.current) return;
    const resolve = waiters.current;
    waiters.current = [];
    resolve.forEach((r) => r());
  }, []);

  const pump = useCallback(async () => {
    if (playing.current) return;
    playing.current = true;
    while (queue.current.length > 0 && !muted.current) {
      const item = queue.current.shift() as Queued;
      current.current = { text: item.text, wordIndex: 0 };
      setCaption({ speaker: item.speaker, sentence: item.text, wordIndex: 0 });
      const following = queue.current[0];
      const outcome = await say(item.text, {
        ...item.voice,
        next: following && following.speaker === item.speaker ? following.text : undefined,
        onWord: (wordIndex) => {
          if (current.current) current.current.wordIndex = wordIndex;
          setCaption((c) => (c ? { ...c, wordIndex } : c));
        },
      });
      if (outcome === "cancelled") break;
      heard.current.push(item.text);
      current.current = null;
      setLastSpoken(item.text);
    }
    playing.current = false;
    settleIfIdle();
  }, [settleIfIdle]);

  const enqueue = useCallback(
    (sentences: string[]) => {
      const who = speaker.current;
      if (!who || muted.current) return;
      for (const text of sentences) queue.current.push({ text, speaker: who.name, voice: who.voice });
      void pump();
    },
    [pump]
  );

  /** Starts a new reply: a fresh splitter, and a fresh count of what was heard. */
  const begin = useCallback((name: string, voice: Voice) => {
    speaker.current = { name, voice };
    splitter.current = createSentenceSplitter();
    heard.current = [];
    current.current = null;
    ended.current = false;
    muted.current = false;
  }, []);

  const push = useCallback((delta: string) => enqueue(splitter.current.push(delta)), [enqueue]);

  const end = useCallback(() => {
    enqueue(splitter.current.flush());
    ended.current = true;
    settleIfIdle();
  }, [enqueue, settleIfIdle]);

  const whenIdle = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiters.current.push(resolve);
        settleIfIdle();
      }),
    [settleIfIdle]
  );

  const speakAll = useCallback(
    async (name: string, voice: Voice, text: string) => {
      begin(name, voice);
      push(text);
      end();
      await whenIdle();
    },
    [begin, push, end, whenIdle]
  );

  /** Stops the voice mid-word and returns the offset, in the reply's normalized text, of what was heard. */
  const interrupt = useCallback((): number => {
    muted.current = true;
    queue.current = [];
    silence();
    const said = current.current;
    const offset = said
      ? spokenOffset([...heard.current, said.text], heard.current.length, said.wordIndex)
      : heard.current.join(" ").length;
    ended.current = true;
    settleIfIdle();
    return offset;
  }, [settleIfIdle]);

  const stopAll = useCallback(() => {
    muted.current = true;
    queue.current = [];
    ended.current = true;
    silence();
    setCaption(null);
    settleIfIdle();
  }, [settleIfIdle]);

  useEffect(() => () => silence(), []);

  return { caption, lastSpoken, begin, push, end, speakAll, interrupt, stopAll, whenIdle };
}
```

- [ ] **Step 5: Type check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/interview/live src/components/recording/useMediaRecorder.ts`
Expected: clean. If the React Compiler lint rule `react-hooks/refs` objects to `handlersRef.current = handlers` inside the effect, keep it in the effect; it's the documented "latest ref" pattern. Don't move it into render.

- [ ] **Step 6: Commit**

```bash
git add src/components/interview/live src/components/recording/useMediaRecorder.ts
git commit -m "feat: live mic, browser captions and sentence speech queue hooks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Caption strip, live controls, go-live button

**Files:**
- Create: `src/components/interview/live/CaptionStrip.tsx`
- Create: `src/components/interview/live/LiveControls.tsx`
- Create: `src/components/interview/GoLiveButton.tsx`

**Interfaces:**
- Consumes: `Caption` (Task 11), `LivePhase`, `DEFAULT_SENSITIVITY` (Task 3), `PATCH /api/interview/[id]` (Task 5)
- Produces:
  - `<CaptionStrip caption student lastSpoken visible />`, where `student: { text: string; interim: boolean } | null`
  - `type LivePrefs = { captions: boolean; sensitivity: number }`; `useLivePrefs(): [LivePrefs, (next: LivePrefs) => void]`
  - `<LiveControls phase prefs onPrefs onEnd onSwitchToTyping ending />`
  - `setLive(sessionId: string, live: boolean): Promise<boolean>`
  - `<GoLiveButton sessionId />`

- [ ] **Step 1: `CaptionStrip.tsx`**

```tsx
// src/components/interview/live/CaptionStrip.tsx
"use client";

import clsx from "@/lib/clsx";
import type { Caption } from "./useSpeechQueue";

/** Each debater keeps one colour, so the speaker is readable at a glance. */
const SPEAKER_TONE: Record<string, string> = {
  Proponent: "text-brand-ink",
  Skeptic: "text-lavender-ink",
};

/**
 * The line being spoken, with the current word highlighted. The highlight is a
 * state change, not an animation, so it stays on under reduced motion. Screen
 * readers get each finished sentence once, through the live region, instead
 * of a word-by-word flood.
 */
export function CaptionStrip({
  caption,
  student,
  lastSpoken,
  visible,
}: {
  caption: Caption | null;
  student: { text: string; interim: boolean } | null;
  lastSpoken: string;
  visible: boolean;
}) {
  return (
    <div className="min-h-[96px] rounded-2xl border border-line bg-surface px-5 py-4 shadow-sm">
      {visible && student && (
        <p className={clsx("text-[17px] leading-relaxed text-brand-ink", student.interim && "italic opacity-80")}>
          <span className="mr-2 text-[12px] font-semibold uppercase tracking-wide text-muted-2">You</span>
          {student.text}
        </p>
      )}
      {visible && !student && caption && (
        <p className="text-[17px] leading-relaxed">
          <span
            className={clsx(
              "mr-2 text-[12px] font-semibold uppercase tracking-wide",
              SPEAKER_TONE[caption.speaker] ?? "text-muted-2"
            )}
          >
            {caption.speaker}
          </span>
          {caption.sentence.split(/\s+/).filter(Boolean).map((word, i) => (
            <span
              key={i}
              className={clsx(
                "rounded px-0.5",
                i < caption.wordIndex && "text-ink",
                i === caption.wordIndex && "bg-brand-soft text-ink",
                i > caption.wordIndex && "text-muted-2"
              )}
            >
              {word}{" "}
            </span>
          ))}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {lastSpoken}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: `LiveControls.tsx`**

```tsx
// src/components/interview/live/LiveControls.tsx
"use client";

import { useState } from "react";
import { Captions, CaptionsOff, Keyboard, Loader2, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DEFAULT_SENSITIVITY, type LivePhase } from "@/lib/live-interview";

export type LivePrefs = { captions: boolean; sensitivity: number };

const PREFS_KEY = "lectern.live";
const DEFAULTS: LivePrefs = { captions: true, sensitivity: DEFAULT_SENSITIVITY };

function readPrefs(): LivePrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Record<keyof LivePrefs, unknown>>;
      return {
        captions: typeof saved.captions === "boolean" ? saved.captions : DEFAULTS.captions,
        sensitivity:
          typeof saved.sensitivity === "number" ? Math.min(1, Math.max(0, saved.sensitivity)) : DEFAULTS.sensitivity,
      };
    }
  } catch {
    // No storage (server render, private mode) or a corrupt value: use defaults.
  }
  return DEFAULTS;
}

export function useLivePrefs(): [LivePrefs, (next: LivePrefs) => void] {
  const [prefs, setPrefs] = useState(readPrefs);
  const update = (next: LivePrefs) => {
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      // Unsaved is fine: the setting still applies for this session.
    }
  };
  return [prefs, update];
}

const PHASE_LABEL: Record<LivePhase, string> = {
  idle: "Ready",
  listening: "Listening…",
  transcribing: "Catching that…",
  thinking: "Thinking…",
  speaking: "Speaking — talk over me to cut in",
  error: "Stopped",
  done: "Finished",
};

export async function setLive(sessionId: string, live: boolean): Promise<boolean> {
  const res = await fetch(`/api/interview/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ live }),
  }).catch(() => null);
  return !!res?.ok;
}

export function LiveControls({
  phase,
  prefs,
  onPrefs,
  onEnd,
  onSwitchToTyping,
  ending,
}: {
  phase: LivePhase;
  prefs: LivePrefs;
  onPrefs: (next: LivePrefs) => void;
  onEnd: () => void;
  onSwitchToTyping: () => void;
  ending: boolean;
}) {
  const listening = phase === "listening";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex items-center gap-2 text-[13px] font-medium text-muted" role="status">
        <span
          aria-hidden
          className={listening ? "h-2.5 w-2.5 rounded-full bg-brand" : "h-2.5 w-2.5 rounded-full bg-line-strong"}
        />
        {PHASE_LABEL[phase]}
      </span>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          Mic sensitivity
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.sensitivity}
            onChange={(e) => onPrefs({ ...prefs, sensitivity: Number(e.target.value) })}
            className="w-24 accent-brand"
          />
        </label>
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={prefs.captions}
          onClick={() => onPrefs({ ...prefs, captions: !prefs.captions })}
        >
          {prefs.captions ? <Captions className="h-4 w-4" strokeWidth={2} /> : <CaptionsOff className="h-4 w-4" strokeWidth={2} />}
          CC
        </Button>
        <Button variant="ghost" size="sm" onClick={onSwitchToTyping}>
          <Keyboard className="h-4 w-4" strokeWidth={2} />
          Switch to typing
        </Button>
        <Button variant="danger" size="sm" onClick={onEnd} disabled={ending}>
          {ending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <PhoneOff className="h-4 w-4" strokeWidth={2} />}
          End
        </Button>
      </div>
    </div>
  );
}
```

`lucide-react` exports `Captions`, `CaptionsOff` and `Keyboard`; check with `grep -o '"CaptionsOff"' node_modules/lucide-react/dist/lucide-react.d.ts`. If an icon is missing from the installed version, use `Subtitles` instead of `Captions`/`CaptionsOff`.

- [ ] **Step 3: `GoLiveButton.tsx`**

```tsx
// src/components/interview/GoLiveButton.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AudioLines } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { setLive } from "@/components/interview/live/LiveControls";

/** Turns the session into a spoken one. Every launcher lands on this page, so this is the one entry point. */
export function GoLiveButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function goLive() {
    setBusy(true);
    if (await setLive(sessionId, true)) router.refresh();
    else setBusy(false);
  }

  return (
    <Button variant="secondary" size="sm" onClick={goLive} disabled={busy} className="self-start">
      <AudioLines className="h-4 w-4" strokeWidth={2} />
      {busy ? "Switching…" : "Talk it through"}
    </Button>
  );
}
```

- [ ] **Step 4: Type check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/interview`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/interview
git commit -m "feat: word-highlight captions, live controls and the go-live button

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: `LiveSession` (Viva and Protégé) and page wiring

**Files:**
- Modify: `src/components/page-detail/ReadAloudBar.tsx` (export `readPrefs`)
- Create: `src/components/interview/live/transcribe.ts`
- Create: `src/components/interview/live/LiveSession.tsx`
- Modify: `src/app/interview/[id]/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 3, 8, 11 and 12; `tutorName` (Task 4); `loadKokoro` from `src/lib/speech.ts`; `useMicHeldByLecture` from `RecordingProvider`
- Produces:
  - `transcribe(sessionId: string, blob: Blob | null, turnId: string | null): Promise<string | null>`
  - `useAct(): [LiveState, (action: LiveAction) => void, () => LivePhase]`, a reducer whose phase is also readable synchronously through the getter, for async flows
  - `<LiveSession sessionId mode openTurn />`

- [ ] **Step 1: Export the read-aloud prefs**

In `src/components/page-detail/ReadAloudBar.tsx`, change `function readPrefs(` to `export function readPrefs(`. The live tutor speaks in the voice the student already chose for read-aloud.

- [ ] **Step 2: `transcribe.ts`**

```ts
// src/components/interview/live/transcribe.ts
"use client";

import { useCallback, useReducer, useRef } from "react";
import { INITIAL_LIVE_STATE, liveReducer, type LiveAction, type LivePhase, type LiveState } from "@/lib/live-interview";

/**
 * Runs one utterance through the local transcriber (Whisper or mac-speech).
 * Null when it is unavailable or heard nothing; the caller falls back to the
 * browser's preview.
 */
export async function transcribe(sessionId: string, blob: Blob | null, turnId: string | null): Promise<string | null> {
  if (!blob) return null;
  const form = new FormData();
  form.append("file", blob, `answer.${blob.type.includes("mp4") ? "m4a" : "webm"}`);
  if (turnId) form.append("turnId", turnId);
  const res = await fetch(`/api/interview/${sessionId}/transcribe-answer`, { method: "POST", body: form }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { text?: unknown } | null;
  return typeof data?.text === "string" ? data.text : null;
}

/**
 * The turn reducer, plus a ref that holds the phase the moment an action is
 * dispatched. Async flows check it after every await; the rendered state lags
 * a frame behind, which is too late for "did the student cut in meanwhile?".
 */
export function useAct(): [LiveState, (action: LiveAction) => void, () => LivePhase] {
  const [state, dispatch] = useReducer(liveReducer, INITIAL_LIVE_STATE);
  const phase = useRef<LivePhase>(INITIAL_LIVE_STATE.phase);
  const act = useCallback((action: LiveAction) => {
    phase.current = liveReducer({ phase: phase.current, error: null }, action).phase;
    dispatch(action);
  }, []);
  // A getter, not the ref: TypeScript would keep a checked `phase.current` narrowed across awaits.
  const now = useCallback(() => phase.current, []);
  return [state, act, now];
}
```

- [ ] **Step 3: `LiveSession.tsx`**

```tsx
// src/components/interview/live/LiveSession.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { readPrefs as readReadAloudPrefs } from "@/components/page-detail/ReadAloudBar";
import { useMicHeldByLecture } from "@/components/recording/RecordingProvider";
import {
  BARGE_IN_MS,
  LISTEN_ONSET_MS,
  heardAnswer,
  isEndCommand,
  sensitivityToThreshold,
  type LiveNextTurn,
  type LiveTurnEvent,
  type TranscriptSource,
} from "@/lib/live-interview";
import { tutorName } from "@/lib/live-transcript";
import { loadKokoro } from "@/lib/speech";
import { ndjsonEvents } from "@/lib/stream-lines";
import { CaptionStrip } from "./CaptionStrip";
import { LiveControls, setLive, useLivePrefs } from "./LiveControls";
import { transcribe, useAct } from "./transcribe";
import { useBrowserRecognition } from "./useBrowserRecognition";
import { useLiveMic } from "./useLiveMic";
import { useSpeechQueue, type Voice } from "./useSpeechQueue";

const NOT_HEARD = "Sorry, I didn't catch that. Could you say it again?";

function tutorVoice(): Voice {
  const prefs = readReadAloudPrefs();
  return { voice: prefs.voiceId, rate: prefs.rate, lang: "en-US" };
}

type Answer = { text: string; source: TranscriptSource };

/**
 * The spoken viva or protégé: the tutor speaks, the mic listens, silence ends
 * the student's turn, and talking over the tutor cuts it off.
 */
export function LiveSession({
  sessionId,
  mode,
  openTurn,
}: {
  sessionId: string;
  mode: "VIVA" | "PROTEGE";
  openTurn: LiveNextTurn | null;
}) {
  const router = useRouter();
  const [state, act, now] = useAct();
  const [prefs, setPrefs] = useLivePrefs();
  const [voice] = useState(tutorVoice);
  const [student, setStudent] = useState<{ text: string; interim: boolean } | null>(null);
  const [ending, setEnding] = useState(false);
  const speech = useSpeechQueue();
  const recognition = useBrowserRecognition();
  const lectureMic = useMicHeldByLecture();
  const tutor = tutorName(mode);

  const turnRef = useRef<LiveNextTurn | null>(openTurn);
  // The turn whose reply is being spoken, for recording where a barge-in landed.
  const replyTurnRef = useRef<string | null>(null);
  // A reply still streaming after a barge-in; the next answer waits for it to be saved.
  const replyRef = useRef<Promise<unknown> | null>(null);
  const lastAnswerRef = useRef<Answer | null>(null);
  const onVadRef = useRef<(event: "start" | "end") => void>(() => {});

  const mic = useLiveMic(sensitivityToThreshold(prefs.sensitivity), {
    onsetMs: () => (now() === "listening" ? LISTEN_ONSET_MS : now() === "speaking" ? BARGE_IN_MS : Infinity),
    onVad: (event) => onVadRef.current(event),
  });
  const { arm, take, start: openMic, stop: closeMic, error: micError } = mic;

  function listen() {
    arm();
    recognition.begin();
  }

  function shutDown() {
    speech.stopAll();
    recognition.end();
    closeMic();
  }

  async function finish() {
    setEnding(true);
    shutDown();
    act({ type: "end" });
    await fetch(`/api/interview/${sessionId}/complete`, { method: "POST" }).catch(() => null);
    router.refresh();
  }

  async function switchToTyping() {
    shutDown();
    if (await setLive(sessionId, false)) router.refresh();
  }

  async function sendAnswer(answer: Answer) {
    const turn = turnRef.current;
    if (!turn) return finish();
    lastAnswerRef.current = answer;

    const res = await fetch(`/api/interview/${sessionId}/live-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId: turn.id, answer: answer.text, transcriptSource: answer.source }),
    }).catch(() => null);
    if (!res?.ok || !res.body) {
      const data = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      act({ type: "failed", message: data.error ?? "Couldn't reach the tutor." });
      return;
    }

    replyTurnRef.current = turn.id;
    speech.begin(tutor, voice);
    const body = res.body;
    const reply = (async () => {
      let final = null as LiveTurnEvent | null;
      let started = false;
      for await (const raw of ndjsonEvents(body)) {
        const event = raw as LiveTurnEvent;
        if (event.type === "text") {
          if (!started) {
            started = true;
            setStudent(null);
            act({ type: "replyStarted" });
          }
          speech.push(event.delta);
        } else {
          final = event;
        }
      }
      speech.end();
      if (final?.type === "done") turnRef.current = final.nextTurn;
      return final;
    })();
    replyRef.current = reply;
    const final = await reply;

    if (!final || final.type !== "done") {
      speech.stopAll();
      act({ type: "failed", message: final?.type === "error" ? final.message : "Lost the tutor mid-reply." });
      return;
    }
    if (now() === "thinking") act({ type: "replyStarted" });
    // Cut in: the student's words are already the answer to the next turn.
    if (now() !== "speaking") return;
    await speech.whenIdle();
    if (now() !== "speaking") return;
    act({ type: "replyDone", completed: final.completed });
    if (final.completed) void finish();
    else listen();
  }

  async function onSpeechEnd() {
    if (now() !== "listening") return;
    act({ type: "speechEnd" });
    const preview = recognition.text;
    if (preview) setStudent({ text: preview, interim: true });
    recognition.end();
    const blob = await take();
    await replyRef.current;
    const turn = turnRef.current;
    const answer = heardAnswer(await transcribe(sessionId, blob, turn?.id ?? null), preview);

    if (!answer) {
      act({ type: "empty" });
      await speech.speakAll(tutor, voice, NOT_HEARD);
      if (now() !== "speaking") return;
      act({ type: "replyDone", completed: false });
      listen();
      return;
    }
    setStudent({ text: answer.text, interim: false });
    if (isEndCommand(answer.text) || !turn) return void finish();
    act({ type: "transcribed" });
    await sendAnswer(answer);
  }

  function onSpeechStart() {
    if (now() !== "speaking") return;
    const heard = speech.interrupt();
    const turnId = replyTurnRef.current;
    replyTurnRef.current = null;
    if (turnId) {
      void fetch(`/api/interview/${sessionId}/live-turn/interrupt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId, interruptedAt: heard }),
      }).catch(() => null);
    }
    act({ type: "bargeIn" });
    listen();
  }

  useEffect(() => {
    onVadRef.current = (event) => {
      if (event === "start") onSpeechStart();
      else void onSpeechEnd();
    };
  });

  async function begin() {
    if (!openTurn) return void finish();
    // Both need the click: Kokoro's AudioContext and the mic prompt.
    loadKokoro();
    if (!(await openMic())) return;
    act({ type: "start" });
    await speech.speakAll(tutor, voice, openTurn.question);
    if (now() !== "speaking") return;
    act({ type: "replyDone", completed: false });
    listen();
  }

  async function retry() {
    const answer = lastAnswerRef.current;
    act({ type: "retry" });
    if (answer) await sendAnswer(answer);
  }

  const shownStudent =
    state.phase === "listening"
      ? recognition.text
        ? { text: recognition.text, interim: true }
        : null
      : state.phase === "transcribing" || state.phase === "thinking"
        ? student
        : null;

  return (
    <section className="flex flex-col gap-4" aria-label="Live interview">
      {state.phase === "idle" ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-brand-border bg-brand-soft/40 p-5">
          <p className="text-sm text-ink">
            Talk it through out loud. When you&apos;re done answering, pause for a moment. Talk over the{" "}
            {tutor.toLowerCase()} to cut in. Headphones help in a noisy room.
          </p>
          {lectureMic && (
            <p className="text-[13px] font-medium text-red-700">
              Your lecture recording is using the microphone. Stop it to talk live.
            </p>
          )}
          {micError && <p className="text-[13px] font-medium text-red-700">{micError}</p>}
          <Button variant="brand" onClick={() => void begin()} disabled={!!lectureMic}>
            <Mic className="h-4 w-4" strokeWidth={2} />
            Start talking
          </Button>
        </div>
      ) : (
        <CaptionStrip
          caption={speech.caption}
          student={shownStudent}
          lastSpoken={speech.lastSpoken}
          visible={prefs.captions}
        />
      )}

      {state.phase === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[13px] font-medium text-red-700">{state.error ?? "Lost the tutor."}</p>
          <Button variant="secondary" size="sm" onClick={() => void retry()}>
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
            Try again
          </Button>
        </div>
      )}

      <LiveControls
        phase={state.phase}
        prefs={prefs}
        onPrefs={setPrefs}
        onEnd={() => void finish()}
        onSwitchToTyping={() => void switchToTyping()}
        ending={ending}
      />
      {!recognition.supported && state.phase !== "idle" && (
        <p className="text-[12.5px] text-muted">
          This browser can&apos;t preview speech, so your words appear once they&apos;re transcribed.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Wire the page**

Replace the component in `src/app/interview/[id]/page.tsx`. It keeps the typed runner as is, adds the go-live button, and renders `LiveSession` for an active live Viva/Protégé. Tasks 14 and 15 fill in the debate and transcript branches.

```tsx
// src/app/interview/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { InterviewRunner } from "@/components/interview/InterviewRunner";
import { GoLiveButton } from "@/components/interview/GoLiveButton";
import { LiveSession } from "@/components/interview/live/LiveSession";
import { MAX_INTERVIEW_QUESTIONS } from "@/lib/interview";

export const dynamic = "force-dynamic";

export default async function InterviewSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.interviewSession.findUnique({
    where: { id },
    include: {
      turns: { orderBy: { order: "asc" } },
      topic: { select: { title: true } },
    },
  });
  if (!session) notFound();

  const active = session.status === "ACTIVE";
  // The turn waiting on the student: unanswered, or answered but never replied to.
  const open = session.turns.find((t) => t.speaker === null && t.feedback === null);

  let body: React.ReactNode;
  if (session.live && active && session.mode !== "DEBATE") {
    body = (
      <LiveSession
        sessionId={session.id}
        mode={session.mode === "PROTEGE" ? "PROTEGE" : "VIVA"}
        openTurn={open ? { id: open.id, order: open.order, question: open.question, retryOf: open.retryOf } : null}
      />
    );
  } else {
    body = (
      <>
        {active && <GoLiveButton sessionId={session.id} />}
        <InterviewRunner
          sessionId={session.id}
          title={session.title}
          concept={session.topic?.title ?? session.title}
          mode={session.mode}
          status={session.status}
          initialTurns={session.turns.map((t) => ({
            id: t.id,
            order: t.order,
            speaker: t.speaker,
            question: t.question,
            answer: t.answer,
            feedback: t.feedback,
          }))}
          totalQuestions={MAX_INTERVIEW_QUESTIONS}
        />
      </>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <Link href="/interview" className="flex items-center gap-1 self-start text-[13px] font-medium text-muted-2 hover:text-brand-ink">
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        All interviews
      </Link>
      {session.live && <h1 className="text-xl font-semibold text-ink">{session.title}</h1>}
      {body}
    </div>
  );
}
```

- [ ] **Step 5: Type check, lint, suite**

Run: `npx tsc --noEmit && npx eslint src/components/interview "src/app/interview/[id]" src/components/page-detail/ReadAloudBar.tsx && npm test`
Expected: clean.

- [ ] **Step 6: Manual check (needs the migration applied)**

With `npm run dev` running, open a lecture, start an interview, and click **Talk it through**, then **Start talking**. The tutor reads the first question with captions. Answer wrongly on purpose. You should hear a correction and a worked example, then a variant question. Answer it; the tutor moves on. Talk over the tutor mid-sentence; it stops within about half a second and starts listening.

- [ ] **Step 7: Commit**

```bash
git add src/components/interview src/components/page-detail/ReadAloudBar.tsx "src/app/interview/[id]/page.tsx"
git commit -m "feat: spoken viva and protege with barge-in and captions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: `LiveDebate`

**Files:**
- Modify: `src/app/api/interview/[id]/transcribe-answer/route.ts` (save audio only when there is a turn to attach it to)
- Create: `src/components/interview/live/LiveDebate.tsx`
- Modify: `src/app/interview/[id]/page.tsx` (render `LiveDebate`)

**Interfaces:**
- Consumes: `POST debate/live` (Task 9), `POST debate/interject` (existing), `POST live-turn/interrupt` (Task 8), the hooks from Task 11, `useAct` and `transcribe` (Task 13), `CaptionStrip`/`LiveControls` (Task 12)
- Produces: `<LiveDebate sessionId concept />`

- [ ] **Step 1: Stop orphaned audio in `transcribe-answer`**

A debate interjection is transcribed before its turn exists, so it has no `turnId`. The route currently saves the audio anyway, under a random name that no row points to. Change the `try` block so that it saves only when there is a turn:

```ts
// in src/app/api/interview/[id]/transcribe-answer/route.ts: replaces the try block
  try {
    // Kept only when it belongs to a turn: a file no row points to is never shown or deleted.
    if (turnId) {
      const relativePath = await saveAudioFile(turnId, buffer, extension);
      await db.interviewTurn.updateMany({
        where: { id: turnId, sessionId: id },
        data: { answerAudioPath: relativePath },
      });
    }

    const result = await transcribeAudio(buffer, `answer.${extension}`, mimeType);
    return NextResponse.json({ text: result.text });
  } catch (e) {
```

Delete the now-unused `stem` line and the `randomUUID` import.

- [ ] **Step 2: `LiveDebate.tsx`**

```tsx
// src/components/interview/live/LiveDebate.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Swords } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { readPrefs as readReadAloudPrefs } from "@/components/page-detail/ReadAloudBar";
import { useMicHeldByLecture } from "@/components/recording/RecordingProvider";
import {
  BARGE_IN_MS,
  LISTEN_ONSET_MS,
  heardAnswer,
  isEndCommand,
  sensitivityToThreshold,
  type DebateLiveEvent,
} from "@/lib/live-interview";
import { loadKokoro } from "@/lib/speech";
import { ndjsonEvents } from "@/lib/stream-lines";
import { CaptionStrip } from "./CaptionStrip";
import { LiveControls, setLive, useLivePrefs } from "./LiveControls";
import { transcribe, useAct } from "./transcribe";
import { useBrowserRecognition } from "./useBrowserRecognition";
import { useLiveMic } from "./useLiveMic";
import { useSpeechQueue, type Voice } from "./useSpeechQueue";

/** One voice per side, so the student can tell them apart with eyes closed. */
const DEBATE_VOICES: Record<string, string> = { Proponent: "am_michael", Skeptic: "bf_emma" };
const MODERATOR = "Moderator";
const NOT_HEARD = "Sorry, I didn't catch that. Could you say it again?";
/** The gap between speakers in which the student can cut in before the next one starts. */
const PAUSE_MS = 700;

/**
 * The spoken debate: agents take turns out loud, one request each, and the
 * student cuts in by talking. Their point is graded by the existing interject
 * route, and the next agent corrects or concedes it.
 */
export function LiveDebate({ sessionId, concept }: { sessionId: string; concept: string }) {
  const router = useRouter();
  const [state, act, now] = useAct();
  const [prefs, setPrefs] = useLivePrefs();
  const [rate] = useState(() => readReadAloudPrefs().rate);
  const [student, setStudent] = useState<{ text: string; interim: boolean } | null>(null);
  const [ending, setEnding] = useState(false);
  const speech = useSpeechQueue();
  const recognition = useBrowserRecognition();
  const lectureMic = useMicHeldByLecture();

  const agentRef = useRef<Promise<unknown> | null>(null);
  // The agent turn being spoken, once the server has saved it.
  const agentTurnRef = useRef<string | null>(null);
  // Where the student cut in, held until the interrupted turn has an id.
  const pendingCutRef = useRef<number | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVadRef = useRef<(event: "start" | "end") => void>(() => {});

  const mic = useLiveMic(sensitivityToThreshold(prefs.sensitivity), {
    onsetMs: () => (now() === "listening" ? LISTEN_ONSET_MS : now() === "speaking" ? BARGE_IN_MS : Infinity),
    onVad: (event) => onVadRef.current(event),
  });
  const { arm, take, start: openMic, stop: closeMic, error: micError } = mic;

  const voiceFor = (speaker: string): Voice => ({ voice: DEBATE_VOICES[speaker] ?? "af_heart", rate, lang: "en-US" });

  function clearAdvance() {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
  }

  function listen() {
    arm();
    recognition.begin();
  }

  function listenThenAdvance() {
    listen();
    clearAdvance();
    advanceTimer.current = setTimeout(() => {
      if (now() === "listening") void nextAgent();
    }, PAUSE_MS);
  }

  function postInterrupt(turnId: string, interruptedAt: number) {
    void fetch(`/api/interview/${sessionId}/live-turn/interrupt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId, interruptedAt }),
    }).catch(() => null);
  }

  function shutDown() {
    clearAdvance();
    speech.stopAll();
    recognition.end();
    closeMic();
  }

  async function finish() {
    setEnding(true);
    shutDown();
    act({ type: "end" });
    await fetch(`/api/interview/${sessionId}/complete`, { method: "POST" }).catch(() => null);
    router.refresh();
  }

  async function switchToTyping() {
    shutDown();
    if (await setLive(sessionId, false)) router.refresh();
  }

  async function nextAgent() {
    clearAdvance();
    if (now() === "listening" || now() === "idle") {
      recognition.end();
      act({ type: "advance" });
    }
    agentTurnRef.current = null;
    pendingCutRef.current = null;

    const res = await fetch(`/api/interview/${sessionId}/debate/live`, { method: "POST" }).catch(() => null);
    if (!res?.ok || !res.body) {
      const data = res ? ((await res.json().catch(() => ({}))) as { error?: string }) : {};
      act({ type: "failed", message: data.error ?? "The debate could not continue." });
      return;
    }

    const body = res.body;
    const run = (async () => {
      let final = null as DebateLiveEvent | null;
      let started = false;
      for await (const raw of ndjsonEvents(body)) {
        const event = raw as DebateLiveEvent;
        if (event.type === "speaker") {
          speech.begin(event.speaker, voiceFor(event.speaker));
        } else if (event.type === "text") {
          if (!started) {
            started = true;
            setStudent(null);
            act({ type: "replyStarted" });
          }
          speech.push(event.delta);
        } else {
          final = event;
        }
      }
      speech.end();
      if (final?.type === "done" && final.turn) {
        agentTurnRef.current = final.turn.id;
        if (pendingCutRef.current !== null) {
          postInterrupt(final.turn.id, pendingCutRef.current);
          pendingCutRef.current = null;
        }
      }
      return final;
    })();
    agentRef.current = run;
    const final = await run;

    if (!final || final.type !== "done") {
      speech.stopAll();
      act({ type: "failed", message: final?.type === "error" ? final.message : "Lost the debate mid-sentence." });
      return;
    }
    if (!final.turn) return void finish();
    if (now() === "thinking") act({ type: "replyStarted" });
    if (now() !== "speaking") return;
    await speech.whenIdle();
    if (now() !== "speaking") return;
    act({ type: "replyDone", completed: final.finished });
    if (final.finished) void finish();
    else listenThenAdvance();
  }

  async function onSpeechEnd() {
    if (now() !== "listening") return;
    clearAdvance();
    act({ type: "speechEnd" });
    const preview = recognition.text;
    if (preview) setStudent({ text: preview, interim: true });
    recognition.end();
    const blob = await take();
    await agentRef.current;
    const answer = heardAnswer(await transcribe(sessionId, blob, null), preview);

    if (!answer) {
      act({ type: "empty" });
      await speech.speakAll(MODERATOR, voiceFor(MODERATOR), NOT_HEARD);
      if (now() !== "speaking") return;
      act({ type: "replyDone", completed: false });
      listenThenAdvance();
      return;
    }
    setStudent({ text: answer.text, interim: false });
    if (isEndCommand(answer.text)) return void finish();
    act({ type: "transcribed" });

    const res = await fetch(`/api/interview/${sessionId}/debate/interject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: answer.text.slice(0, 2000) }),
    }).catch(() => null);
    if (!res?.ok) {
      act({ type: "failed", message: "Couldn't hand your point to the debate." });
      return;
    }
    await nextAgent();
  }

  function onSpeechStart() {
    // Speaking in the pause between agents holds the next one back.
    clearAdvance();
    if (now() !== "speaking") return;
    const heard = speech.interrupt();
    const turnId = agentTurnRef.current;
    if (turnId) postInterrupt(turnId, heard);
    else pendingCutRef.current = heard;
    act({ type: "bargeIn" });
    listen();
  }

  useEffect(() => {
    onVadRef.current = (event) => {
      if (event === "start") onSpeechStart();
      else void onSpeechEnd();
    };
  });

  useEffect(() => {
    const timer = advanceTimer;
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function begin() {
    loadKokoro();
    if (!(await openMic())) return;
    await nextAgent();
  }

  const shownStudent =
    state.phase === "listening"
      ? recognition.text
        ? { text: recognition.text, interim: true }
        : null
      : state.phase === "transcribing" || state.phase === "thinking"
        ? student
        : null;

  return (
    <section className="flex flex-col gap-4" aria-label="Live debate">
      {state.phase === "idle" ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-lavender-soft bg-lavender-soft/30 p-5">
          <p className="text-sm text-ink">
            Two debaters argue &ldquo;{concept}&rdquo; out loud. Cut in any time to make your point, and they&apos;ll
            answer it. If you&apos;re wrong, expect to be corrected with an example.
          </p>
          {lectureMic && (
            <p className="text-[13px] font-medium text-red-700">
              Your lecture recording is using the microphone. Stop it to talk live.
            </p>
          )}
          {micError && <p className="text-[13px] font-medium text-red-700">{micError}</p>}
          <Button variant="brand" onClick={() => void begin()} disabled={!!lectureMic}>
            <Swords className="h-4 w-4" strokeWidth={2} />
            Start the debate
          </Button>
        </div>
      ) : (
        <CaptionStrip
          caption={speech.caption}
          student={shownStudent}
          lastSpoken={speech.lastSpoken}
          visible={prefs.captions}
        />
      )}

      {state.phase === "error" && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[13px] font-medium text-red-700">{state.error ?? "The debate stopped."}</p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              act({ type: "retry" });
              void nextAgent();
            }}
          >
            <RotateCcw className="h-4 w-4" strokeWidth={2} />
            Try again
          </Button>
        </div>
      )}

      <LiveControls
        phase={state.phase}
        prefs={prefs}
        onPrefs={setPrefs}
        onEnd={() => void finish()}
        onSwitchToTyping={() => void switchToTyping()}
        ending={ending}
      />
    </section>
  );
}
```

- [ ] **Step 3: Render it from the page**

In `src/app/interview/[id]/page.tsx`, add `import { LiveDebate } from "@/components/interview/live/LiveDebate";`, and put this branch before the `LiveSession` one:

```tsx
// in src/app/interview/[id]/page.tsx: first branch of the body
  if (session.live && active && session.mode === "DEBATE") {
    body = <LiveDebate sessionId={session.id} concept={session.topic?.title ?? session.title} />;
  } else if (session.live && active) {
```

This replaces `if (session.live && active && session.mode !== "DEBATE") {`. The `LiveSession` branch already maps the mode explicitly, because TypeScript doesn't narrow `session.mode` through an `else if` after a compound condition.

- [ ] **Step 4: Type check, lint, suite**

Run: `npx tsc --noEmit && npx eslint src/components/interview "src/app/interview/[id]" "src/app/api/interview/[id]/transcribe-answer" && npm test`
Expected: clean.

- [ ] **Step 5: Manual check**

Start a debate from a course topic, click **Talk it through**, then **Start the debate**. The Proponent and Skeptic alternate in two different voices, with a speaker label on the captions. Talk over one and make a wrong claim: that agent stops, and the next one corrects you with an example. Make a right claim: it concedes.

- [ ] **Step 6: Commit**

```bash
git add src/components/interview "src/app/interview/[id]/page.tsx" "src/app/api/interview/[id]/transcribe-answer/route.ts"
git commit -m "feat: spoken debate with interjection by barge-in

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Transcript view

**Files:**
- Create: `src/components/interview/live/LiveTranscript.tsx`
- Modify: `src/app/interview/[id]/page.tsx` (completed live sessions)

**Interfaces:**
- Consumes: `transcriptLines`, `fixCards`, `transcriptMarkdown`, `tutorName`, `TranscriptLine`, `FixCard` (Task 4)
- Produces: `<LiveTranscript title lines cards />`

- [ ] **Step 1: `LiveTranscript.tsx`**

```tsx
// src/components/interview/live/LiveTranscript.tsx
"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import clsx from "@/lib/clsx";
import { transcriptMarkdown, type FixCard, type TranscriptLine } from "@/lib/live-transcript";

function fileName(title: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "interview"}.md`;
}

/**
 * The end of a spoken session: what was said, and a study sheet of every
 * miss with its correction and example — the part worth rereading.
 */
export function LiveTranscript({ title, lines, cards }: { title: string; lines: TranscriptLine[]; cards: FixCard[] }) {
  const [copied, setCopied] = useState(false);
  const markdown = transcriptMarkdown(title, lines, cards);

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure origin or denied); the download still works.
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(title);
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          {copied ? <Check className="h-4 w-4" strokeWidth={2} /> : <Copy className="h-4 w-4" strokeWidth={2} />}
          {copied ? "Copied" : "Copy as Markdown"}
        </Button>
        <Button variant="secondary" size="sm" onClick={download}>
          <Download className="h-4 w-4" strokeWidth={2} />
          Download .md
        </Button>
      </div>

      <section aria-labelledby="fix-heading" className="flex flex-col gap-3">
        <h2 id="fix-heading" className="text-base font-semibold text-ink">
          What to fix
        </h2>
        {cards.length === 0 ? (
          <p className="text-sm text-muted">Nothing to fix — every answer landed.</p>
        ) : (
          cards.map((card, i) => (
            <article key={i} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
              <p className="text-sm font-semibold text-ink">{card.question}</p>
              <p className="text-[13.5px] text-muted">
                <span className="font-medium text-ink-soft">You said: </span>
                {card.answer}
              </p>
              {card.correction && (
                <p className="text-[13.5px] text-ink">
                  <span className="font-medium">Correction: </span>
                  {card.correction}
                </p>
              )}
              {card.example && (
                <p className="rounded-lg bg-brand-soft/50 px-3 py-2 text-[13.5px] text-ink">
                  <span className="font-medium">Example: </span>
                  {card.example}
                </p>
              )}
              {card.retry && (
                <p className="text-[13px] text-muted">
                  <span className="font-medium text-ink-soft">Your retry ({card.retry.verdict}): </span>
                  {card.retry.answer}
                </p>
              )}
            </article>
          ))
        )}
      </section>

      <section aria-labelledby="conversation-heading" className="flex flex-col gap-3">
        <h2 id="conversation-heading" className="text-base font-semibold text-ink">
          Conversation
        </h2>
        <ol className="flex flex-col gap-3">
          {lines.map((line, i) => (
            <li key={i} className={clsx("flex flex-col gap-0.5", line.speaker === "You" && "items-end text-right")}>
              <span className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-2">{line.speaker}</span>
              <p
                className={clsx(
                  "max-w-[85%] rounded-xl px-3 py-2 text-[14px]",
                  line.speaker === "You" ? "bg-brand-soft text-ink" : "bg-surface-2 text-ink"
                )}
              >
                {line.text}
                {line.interrupted && <span className="text-muted-2"> — (you cut in)</span>}
                {line.source === "browser" && <span className="block text-[11.5px] text-muted-2">browser transcript</span>}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Render it for finished live sessions**

In `src/app/interview/[id]/page.tsx`, add:

```tsx
// in src/app/interview/[id]/page.tsx: imports
import { LiveTranscript } from "@/components/interview/live/LiveTranscript";
import { fixCards, transcriptLines, tutorName } from "@/lib/live-transcript";
```

Make this the first branch of the body, ahead of the `LiveDebate` branch, and change the `LiveDebate` branch's leading `if` to `} else if`:

```tsx
// in src/app/interview/[id]/page.tsx: first branch, before the debate one
  if (session.live && !active) {
    const turns = session.turns.map((t) => ({
      id: t.id,
      order: t.order,
      speaker: t.speaker,
      question: t.question,
      answer: t.answer,
      feedback: t.feedback,
      spoken: t.spoken,
      interruptedAt: t.interruptedAt,
      retryOf: t.retryOf,
    }));
    body = (
      <LiveTranscript
        title={session.title}
        lines={transcriptLines(turns, tutorName(session.mode))}
        cards={fixCards(turns)}
      />
    );
  } else if (session.live && active && session.mode === "DEBATE") {
```

- [ ] **Step 3: Type check, lint, suite**

Run: `npx tsc --noEmit && npx eslint src/components/interview "src/app/interview/[id]" && npm test`
Expected: clean.

- [ ] **Step 4: Manual check**

Finish a live Viva in which you missed at least one question. The page shows "What to fix" with the miss, the correction, the example and your retry, then the conversation, where a reply you cut off ends in "— (you cut in)". Test **Copy as Markdown** and **Download .md**.

- [ ] **Step 5: Commit**

```bash
git add src/components/interview/live/LiveTranscript.tsx "src/app/interview/[id]/page.tsx"
git commit -m "feat: transcript and what-to-fix study sheet after a live session

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Docs and the manual checklist

**Files:**
- Modify: `README.md` (the interview section)

- [ ] **Step 1: README**

Find the section that describes interviews (`grep -n -i "interview" README.md`) and add this paragraph beneath it:

```markdown
**Talk it through (live).** On any interview page, *Talk it through* turns the session into a spoken one, like a voice call: the tutor speaks, you answer out loud, a short pause ends your turn, and talking over the tutor cuts it off. When you're wrong it names the slip, walks through a worked example from your course material, and gives you one variant to retry. Captions highlight each word as it is spoken (CC toggles them). When the session ends you get the transcript plus a *What to fix* sheet you can copy or download as Markdown. Your answers are transcribed locally (Whisper or mac-speech); in Chrome, the live preview of your words uses Chrome's own speech service. The tutor speaks in your read-aloud voice; debaters use two fixed voices.
```

- [ ] **Step 2: Full verification**

Run: `npm test && npx tsc --noEmit && npx eslint src && npm run build`
Expected: all pass, and the build succeeds.

- [ ] **Step 3: Manual checklist (run in Chrome, then Firefox)**

Run each item against `npm run dev`, with the migration applied:

- [ ] Viva, speakers (no headphones): the tutor's voice doesn't trigger a barge-in by itself. If it does, lower **Mic sensitivity** and note the value that worked.
- [ ] Viva, headphones: a complete six-question session reaches the transcript.
- [ ] A wrong answer gets a correction, a worked example, and a variant question. A second miss gets the answer and moves on; there's no third try.
- [ ] Barge-in: talking over the tutor stops it within about half a second, and your words become the answer to the question the reply ended on.
- [ ] A cough while the tutor speaks doesn't cut it off at default sensitivity.
- [ ] Saying "end session" ends it and shows the transcript.
- [ ] Captions: the highlight follows the voice to within about a word, CC hides the strip, and the choice survives a reload.
- [ ] Firefox (no `SpeechRecognition`): there is no interim text, your words appear after transcription, and everything else works.
- [ ] Mic denied: the start card shows the permission message, and **Switch to typing** returns to the typed runner.
- [ ] First run with Kokoro not yet downloaded: the browser voice speaks meanwhile, and captions still move (from `onboundary`).
- [ ] Protégé: a wrong explanation gets pushback with a concrete case, and a second miss gets "I looked it up".
- [ ] Debate: two distinct voices; a wrong interjection is corrected with an example and a right one is conceded; the transcript shows the cut-off agent line truncated.
- [ ] Stop Whisper or mac-speech mid-session: the answer is graded on the browser text, and the transcript marks it "browser transcript".
- [ ] Kill the network mid-reply: "Try again" appears and regenerates the reply without asking the question again.
- [ ] Read-aloud on a lecture's notes still works exactly as before.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: live interview mode

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
