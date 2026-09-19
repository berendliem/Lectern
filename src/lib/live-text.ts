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
  if (/[.!?]["')\u201D\u2019]*$/.test(word)) return word.length + 3;
  if (/[,;:]["')\u201D\u2019]*$/.test(word)) return word.length + 2;
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
