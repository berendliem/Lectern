/**
 * The recall scale. Pure — every helper here is arithmetic over numbers the
 * graders already produce, so `node --test` can import it without Prisma.
 * The ledger writes themselves live in `recall-log.ts`, the same split as
 * `embed-math.ts` next to `embeddings.ts`.
 */

import type { Sm2Result } from "./sm2.ts";

/**
 * The migration that turned `ReviewLog` into the ledger backfilled every
 * existing row with `quality = 0`. Those rows are streak evidence, not grades:
 * they record that a review happened on a day, and nothing about how it went.
 *
 * So every read that *scores* quality filters on `reviewedAt >= RECALL_LEDGER_SINCE`,
 * and every read that only counts events (the streak, the daily count) must not —
 * filtering there would truncate the student's history instead.
 *
 * Miss this filter in a scoring read and the scheduler concludes the student has
 * failed everything they ever reviewed.
 */
export const RECALL_LEDGER_SINCE = new Date("2026-09-08T00:00:00Z");

/** Below this, SM-2 treats the attempt as a failure and resets the interval. */
export const PASS_QUALITY = 3;
/** At or above this, a recall is good enough to close an open misconception. */
export const RESOLVE_QUALITY = 4;

export type RecallKind = "FLASHCARD" | "QUIZ" | "FEYNMAN" | "INTERVIEW" | "BLURT" | "PRETEST";

/**
 * What a grader actually produced, in its own units. A discriminated union
 * rather than `(kind, number)` because the numbers are not interchangeable:
 * a quiz passing its raw 1-for-correct into a `(kind, number)` signature would
 * read as quality 1 — a near-total blackout — and nothing would catch it.
 */
export type RecallRaw =
  /** The review buttons: Again/Hard/Good/Easy as 0/3/4/5. */
  | { kind: "FLASHCARD"; quality: number }
  | { kind: "QUIZ"; correct: boolean }
  | { kind: "QUIZ"; similarity: number }
  | { kind: "FEYNMAN"; score: number }
  | { kind: "INTERVIEW"; rating: number }
  | { kind: "BLURT"; covered: number; missed: number; wrong: number }
  | { kind: "PRETEST"; correct: boolean };

function clamp(quality: number): number {
  if (!Number.isFinite(quality)) return 0;
  return Math.max(0, Math.min(5, Math.round(quality)));
}

/**
 * Four graders onto SM-2's 0-5. These mappings are judgement calls, not
 * measurements: if interview scores land systematically harsher than flashcard
 * self-grades, every interviewed topic decays faster than it should. The
 * calibration report is what makes a bad mapping visible.
 */
export function normalizeQuality(raw: RecallRaw): number {
  switch (raw.kind) {
    case "FLASHCARD":
      return clamp(raw.quality);
    case "INTERVIEW":
      // 1-5 already coincides with SM-2's usable range.
      return clamp(raw.rating);
    case "FEYNMAN":
      return clamp(raw.score / 20);
    case "BLURT": {
      // Wrong claims sit in the denominator beside what was missed. The spec
      // scored covered/(covered+missed), which hands a perfect 5 to a dump that
      // recalled everything and also asserted eight things the notes contradict
      // — and a 5 closes every open misconception on that lecture.
      const asked = raw.covered + raw.missed + raw.wrong;
      // Nothing to score against is not a failure; an empty blurt scores 0 on
      // its own because `covered` is 0.
      return asked === 0 ? 0 : clamp((raw.covered / asked) * 5);
    }
    case "QUIZ":
    case "PRETEST":
      if ("similarity" in raw) return clamp(raw.similarity * 5);
      // A correct multiple choice is a 4, not a 5: one of four options is a
      // quarter of a guess, and 5 would inflate the ease factor for it.
      return raw.correct ? 4 : 0;
  }
}

/** Pretest events are recorded and never scheduled — see §16.3. */
export function isSchedulable(kind: RecallKind): boolean {
  return kind !== "PRETEST";
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Confidently wrong is the most expensive error state in studying and the one
 * SM-2 cannot see: the student is not going to review something they believe
 * they know. Certain (3) plus a failed recall forces tomorrow; every other
 * combination passes straight through.
 */
export function applyCalibrationPenalty(
  result: Sm2Result,
  confidence: number | null | undefined,
  quality: number,
  now: Date = new Date()
): Sm2Result {
  if (confidence !== 3 || quality >= PASS_QUALITY) return result;
  return {
    ...result,
    intervalDays: 1,
    repetitions: 0,
    nextReviewAt: new Date(now.getTime() + DAY_MS),
  };
}

export type CalibrationEvent = { confidence: number | null; quality: number };

export type Calibration = {
  /** Share of "Certain" attempts that were wrong. */
  overconfidentWrong: number;
  /** Share of "Guessing" attempts that were right. */
  underconfidentRight: number;
  /** Attempts that carried a confidence at all — the rest say nothing. */
  rated: number;
};

/**
 * Read-only reporting. It changes no schedule; it is how a student finds out
 * that their sense of knowing something has come loose from knowing it.
 */
export function calibration(events: CalibrationEvent[]): Calibration {
  let certain = 0;
  let certainWrong = 0;
  let guessing = 0;
  let guessingRight = 0;

  for (const e of events) {
    if (e.confidence === 3) {
      certain += 1;
      if (e.quality < PASS_QUALITY) certainWrong += 1;
    } else if (e.confidence === 1) {
      guessing += 1;
      if (e.quality >= PASS_QUALITY) guessingRight += 1;
    }
  }

  return {
    overconfidentWrong: certain === 0 ? 0 : certainWrong / certain,
    underconfidentRight: guessing === 0 ? 0 : guessingRight / guessing,
    rated: certain + guessing,
  };
}

/**
 * Weighted sampling without replacement. The RNG is injectable so the
 * distribution can be asserted in a test rather than hoped for.
 *
 * ponytail: O(n²) — it re-totals the pool per draw, and cram draws the whole
 * course. Fine at a few hundred questions; a prefix-sum tree if a course ever
 * carries thousands.
 *
 * Weights at or below zero are treated as unpickable; if every remaining item
 * is unpickable the sample stops early rather than looping.
 */
export function weightedSample<T>(
  items: T[],
  weights: number[],
  n: number,
  rng: () => number = Math.random
): T[] {
  if (items.length !== weights.length) {
    throw new Error("weightedSample needs one weight per item.");
  }

  const pool = items.map((item, i) => ({ item, weight: Math.max(0, weights[i]) }));
  const out: T[] = [];

  while (out.length < n && pool.length > 0) {
    const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) break;

    let target = rng() * total;
    let picked = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      target -= pool[i].weight;
      if (target < 0) {
        picked = i;
        break;
      }
    }
    out.push(pool[picked].item);
    pool.splice(picked, 1);
  }

  return out;
}

/**
 * A typed free-recall attempt, scored against the card's own explanation, maps
 * onto the four buttons. Nothing here submits a grade — the student sees the
 * suggestion pre-highlighted and overrides it whenever it is wrong.
 *
 * ponytail: four hand-picked thresholds, calibrated against cosine similarity
 * on MiniLM; env knobs the first time a real deck argues with them.
 */
export function suggestQuality(similarity: number): number {
  if (!Number.isFinite(similarity)) return 0;
  if (similarity >= 0.8) return 5;
  if (similarity >= 0.55) return 4;
  if (similarity >= 0.35) return 3;
  return 0;
}

export type CramStats = {
  /** Most recent normalized quality for this question, or null if never seen. */
  recentQuality: number | null;
  /** Days since it was last answered, or null if never seen. */
  daysSinceLastSeen: number | null;
  openMisconception: boolean;
};

/** The mean weight, which is what an unseen item is worth (§16.8). */
export const BASE_CRAM_WEIGHT = 1 + 2 * 0.5 + 1 * 0.5;

/**
 * Weak items surface more, stale items surface more, an item with an open
 * misconception surfaces more. An item nobody has answered yet lands at the
 * mean, so a fresh question is neither buried nor privileged.
 */
export function cramWeight(stats: CramStats): number {
  if (stats.recentQuality === null && stats.daysSinceLastSeen === null) {
    return stats.openMisconception ? BASE_CRAM_WEIGHT + 1 : BASE_CRAM_WEIGHT;
  }
  const weakness = 1 - (stats.recentQuality ?? 0) / 5;
  const staleness = Math.min((stats.daysSinceLastSeen ?? 0) / 14, 1);
  return 1 + 2 * weakness + staleness + (stats.openMisconception ? 1 : 0);
}
