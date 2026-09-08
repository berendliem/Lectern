import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_CRAM_WEIGHT,
  applyCalibrationPenalty,
  calibration,
  cramWeight,
  isSchedulable,
  normalizeQuality,
  suggestQuality,
  weightedSample,
} from "./recall.ts";
import { scheduleNextReview } from "./sm2.ts";

test("normalizeQuality passes the flashcard buttons through unchanged", () => {
  for (const quality of [0, 3, 4, 5]) {
    assert.equal(normalizeQuality({ kind: "FLASHCARD", quality }), quality);
  }
});

test("normalizeQuality maps a correct multiple choice to 4, not 5", () => {
  assert.equal(normalizeQuality({ kind: "QUIZ", correct: true }), 4);
  assert.equal(normalizeQuality({ kind: "QUIZ", correct: false }), 0);
});

test("normalizeQuality scales short-answer similarity across the whole range", () => {
  assert.equal(normalizeQuality({ kind: "QUIZ", similarity: 0 }), 0);
  assert.equal(normalizeQuality({ kind: "QUIZ", similarity: 0.5 }), 3);
  assert.equal(normalizeQuality({ kind: "QUIZ", similarity: 1 }), 5);
});

test("normalizeQuality maps a Feynman score by twentieths", () => {
  assert.equal(normalizeQuality({ kind: "FEYNMAN", score: 0 }), 0);
  assert.equal(normalizeQuality({ kind: "FEYNMAN", score: 59 }), 3);
  assert.equal(normalizeQuality({ kind: "FEYNMAN", score: 100 }), 5);
});

test("normalizeQuality treats interview ratings as already on the scale", () => {
  assert.equal(normalizeQuality({ kind: "INTERVIEW", rating: 1 }), 1);
  assert.equal(normalizeQuality({ kind: "INTERVIEW", rating: 5 }), 5);
});

test("normalizeQuality scores a blurt by what it covered", () => {
  assert.equal(normalizeQuality({ kind: "BLURT", covered: 0, missed: 4 }), 0);
  assert.equal(normalizeQuality({ kind: "BLURT", covered: 2, missed: 2 }), 3);
  assert.equal(normalizeQuality({ kind: "BLURT", covered: 4, missed: 0 }), 5);
  // A blurt the grader could not find anything to score is a 0, not a crash.
  assert.equal(normalizeQuality({ kind: "BLURT", covered: 0, missed: 0 }), 0);
});

test("normalizeQuality clamps a grader that returns nonsense", () => {
  assert.equal(normalizeQuality({ kind: "FLASHCARD", quality: 9 }), 5);
  assert.equal(normalizeQuality({ kind: "INTERVIEW", rating: -2 }), 0);
  assert.equal(normalizeQuality({ kind: "FEYNMAN", score: Number.NaN }), 0);
});

test("a pretest is scored but never schedulable", () => {
  assert.equal(normalizeQuality({ kind: "PRETEST", correct: true }), 4);
  assert.equal(isSchedulable("PRETEST"), false);
  for (const kind of ["FLASHCARD", "QUIZ", "FEYNMAN", "INTERVIEW", "BLURT"] as const) {
    assert.equal(isSchedulable(kind), true);
  }
});

test("confidently wrong forces tomorrow, whatever SM-2 returned", () => {
  const now = new Date("2026-09-08T09:00:00Z");
  // A mature card: SM-2 on a failed recall already resets it, so use a passing
  // grade's result to prove the penalty is doing the work, not SM-2.
  const mature = scheduleNextReview({ easeFactor: 2.5, intervalDays: 30, repetitions: 6 }, 4, now);
  const penalized = applyCalibrationPenalty(mature, 3, 2, now);

  assert.equal(penalized.intervalDays, 1);
  assert.equal(penalized.repetitions, 0);
  assert.equal(penalized.nextReviewAt.getTime(), now.getTime() + 24 * 60 * 60 * 1000);
  // The ease factor is SM-2's business; the penalty only moves the interval.
  assert.equal(penalized.easeFactor, mature.easeFactor);
});

test("every other confidence and quality combination passes through", () => {
  const now = new Date("2026-09-08T09:00:00Z");
  const result = scheduleNextReview({ easeFactor: 2.5, intervalDays: 30, repetitions: 6 }, 4, now);

  for (const [confidence, quality] of [
    [3, 4],
    [2, 1],
    [1, 0],
    [null, 1],
    [undefined, 2],
  ] as const) {
    assert.deepEqual(applyCalibrationPenalty(result, confidence, quality, now), result);
  }
});

test("calibration reports both sides and ignores unrated attempts", () => {
  const report = calibration([
    { confidence: 3, quality: 5 },
    { confidence: 3, quality: 1 },
    { confidence: 1, quality: 4 },
    { confidence: 1, quality: 0 },
    { confidence: 2, quality: 0 },
    { confidence: null, quality: 0 },
  ]);

  assert.equal(report.overconfidentWrong, 0.5);
  assert.equal(report.underconfidentRight, 0.5);
  assert.equal(report.rated, 4);
});

test("calibration on no rated attempts reports zero rather than NaN", () => {
  const report = calibration([{ confidence: null, quality: 5 }]);
  assert.equal(report.overconfidentWrong, 0);
  assert.equal(report.underconfidentRight, 0);
  assert.equal(report.rated, 0);
});

test("weightedSample favours heavy items and never repeats one", () => {
  // A seeded LCG: the distribution is asserted, not hoped for.
  let seed = 42;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };

  const items = ["heavy", "light"];
  let heavyFirst = 0;
  const runs = 2000;
  for (let i = 0; i < runs; i++) {
    const sample = weightedSample(items, [9, 1], 2, rng);
    assert.deepEqual([...sample].sort(), ["heavy", "light"]);
    if (sample[0] === "heavy") heavyFirst += 1;
  }

  const share = heavyFirst / runs;
  assert.ok(share > 0.85 && share < 0.95, `heavy led ${share} of the time, expected about 0.9`);
});

test("weightedSample stops early rather than looping on unpickable items", () => {
  assert.deepEqual(
    weightedSample(["a", "b"], [0, 0], 2, () => 0.5),
    []
  );
  assert.deepEqual(
    weightedSample(["a"], [1], 5, () => 0.5),
    ["a"]
  );
  assert.throws(() => weightedSample(["a", "b"], [1], 1), /one weight per item/);
});

test("an unseen cram item lands at the mean weight", () => {
  const unseen = cramWeight({
    recentQuality: null,
    daysSinceLastSeen: null,
    openMisconception: false,
  });
  const weak = cramWeight({ recentQuality: 0, daysSinceLastSeen: 30, openMisconception: false });
  const strong = cramWeight({ recentQuality: 5, daysSinceLastSeen: 0, openMisconception: false });

  assert.equal(unseen, BASE_CRAM_WEIGHT);
  assert.ok(weak > unseen, "a failed, stale item must outrank an unseen one");
  assert.ok(strong < unseen, "a fresh, well-known item must rank below an unseen one");
});

test("an open misconception adds exactly one to a cram weight", () => {
  const stats = { recentQuality: 3, daysSinceLastSeen: 7 };
  assert.equal(
    cramWeight({ ...stats, openMisconception: true }) -
      cramWeight({ ...stats, openMisconception: false }),
    1
  );
});

test("suggestQuality maps similarity onto the four buttons at its boundaries", () => {
  assert.equal(suggestQuality(0.8), 5);
  assert.equal(suggestQuality(0.79), 4);
  assert.equal(suggestQuality(0.55), 4);
  assert.equal(suggestQuality(0.54), 3);
  assert.equal(suggestQuality(0.35), 3);
  assert.equal(suggestQuality(0.34), 0);
  assert.equal(suggestQuality(0), 0);
  // An embedder that returned nothing usable suggests Again rather than NaN.
  assert.equal(suggestQuality(Number.NaN), 0);
});
