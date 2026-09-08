// Syllabus coverage: does anything this course captured actually teach each
// syllabus topic? Pure decisions only — the embedding and the database reads
// live in embeddings.ts and the course overview page.

import { masteryOf, type Mastery } from "./mastery.ts";

// Measured with MiniLM on a lecture and three syllabus topics: the topic the
// lecture teaches scored 0.82, a topic it only mentions in passing 0.42, and
// an unrelated topic 0.28. 0.5 sits in the gap — it credits the lecture that
// is *about* a topic, not the one that name-dropped it.
// ponytail: coverage threshold is a heuristic; needs a real knob because
// syllabus phrasing and lecture phrasing rarely match cleanly.
export const DEFAULT_COVERAGE_THRESHOLD = 0.5;

export function coverageThreshold(raw = process.env.COVERAGE_THRESHOLD): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return DEFAULT_COVERAGE_THRESHOLD;
  return parsed;
}

export type TopicMatch = {
  score: number;
  title: string;
  pageId: string | null;
  materialId: string | null;
};

/**
 * Why the course page is (or is not) showing a coverage verdict.
 * "no-sources" and "failed" both mean no verdict, but for opposite reasons —
 * nothing indexed to check against, versus embedding blew up — and telling a
 * user the wrong one sends them looking in the wrong place.
 */
export type CoverageState = "scored" | "no-sources" | "failed";

export type TopicCoverage = {
  covered: boolean;
  /** The best match, whether or not it cleared the threshold. */
  match: TopicMatch | null;
};

/**
 * Coverage is a hint, never a verdict: a below-threshold match is still
 * returned so the UI can offer the nearest lecture instead of claiming the
 * topic was never taught.
 */
export function classifyTopic(match: TopicMatch | null, threshold: number): TopicCoverage {
  if (!match) return { covered: false, match: null };
  return { covered: match.score >= threshold, match };
}

const RANK: Record<Mastery, number> = { new: 0, learning: 1, mastered: 2 };

/**
 * A topic is only as mastered as its weakest card: one card you have never
 * seen means you have not mastered the topic, however well the rest go.
 * Returns null when the source behind the topic has no cards at all.
 */
export function rollUpMastery(
  cards: { repetitions: number; lastReviewedAt: Date | string | null }[]
): Mastery | null {
  if (cards.length === 0) return null;
  let worst: Mastery = "mastered";
  for (const card of cards) {
    const m = masteryOf(card.repetitions, card.lastReviewedAt);
    if (RANK[m] < RANK[worst]) worst = m;
  }
  return worst;
}
