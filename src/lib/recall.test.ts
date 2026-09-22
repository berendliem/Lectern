import { test } from "node:test";
import assert from "node:assert/strict";
import { qualityForScore, shouldRequeue } from "./grading.ts";
import {
  BASE_CRAM_WEIGHT,
  PASS_QUALITY,
  RESOLVE_QUALITY,
  applyCalibrationPenalty,
  calibration,
  cramWeight,
  isSchedulable,
  normalizeQuality,
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

test("a free-text quiz score reaches the ledger on the session's own bands", () => {
  // The ledger and the session read one score the same way: anything the
  // quiz asks again must not be recorded as a Good recall, and vice versa.
  for (const score of [0, 30, 59, 60, 84, 85, 94, 95, 100]) {
    const quality = normalizeQuality({ kind: "QUIZ", score, grader: "llm" });
    assert.equal(quality, qualityForScore(score), `score ${score}`);
    assert.equal(quality >= RESOLVE_QUALITY, !shouldRequeue(score, 1), `score ${score}`);
  }
});

test("an offline overlap grade can pass but never resolves a misconception", () => {
  assert.equal(normalizeQuality({ kind: "QUIZ", score: 100, grader: "overlap" }), PASS_QUALITY);
  assert.equal(normalizeQuality({ kind: "QUIZ", score: 85, grader: "overlap" }), PASS_QUALITY);
  assert.equal(normalizeQuality({ kind: "QUIZ", score: 40, grader: "overlap" }), 0);
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
  assert.equal(normalizeQuality({ kind: "BLURT", covered: 0, missed: 4, wrong: 0 }), 0);
  assert.equal(normalizeQuality({ kind: "BLURT", covered: 2, missed: 2, wrong: 0 }), 3);
  assert.equal(normalizeQuality({ kind: "BLURT", covered: 4, missed: 0, wrong: 0 }), 5);
  // A blurt the grader could not find anything to score is a 0, not a crash.
  assert.equal(normalizeQuality({ kind: "BLURT", covered: 0, missed: 0, wrong: 0 }), 0);
});

test("wrong claims count against a blurt that missed nothing", () => {
  // Recalled everything the notes ask for, and asserted four things they
  // contradict. Scoring only covered/(covered+missed) would call that a 5 —
  // and a 5 closes every open misconception on the lecture.
  const confidentlyWrong = normalizeQuality({ kind: "BLURT", covered: 4, missed: 0, wrong: 4 });
  assert.equal(confidentlyWrong, 3);
  assert.ok(
    confidentlyWrong < RESOLVE_QUALITY,
    "a blurt full of false claims must not resolve misconceptions"
  );
  assert.equal(normalizeQuality({ kind: "BLURT", covered: 1, missed: 0, wrong: 7 }), 1);
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

test("normalizeQuality scores a walked step the way it scores a blurt", () => {
  assert.equal(normalizeQuality({ kind: "WALKTHROUGH", covered: 0, missed: 3, wrong: 0 }), 0);
  assert.equal(normalizeQuality({ kind: "WALKTHROUGH", covered: 2, missed: 2, wrong: 0 }), 3);
  assert.equal(normalizeQuality({ kind: "WALKTHROUGH", covered: 4, missed: 0, wrong: 0 }), 5);
  // Nothing to score against is a 0, not a division by zero.
  assert.equal(normalizeQuality({ kind: "WALKTHROUGH", covered: 0, missed: 0, wrong: 0 }), 0);
  // A wrong claim sits in the denominator beside what was missed.
  assert.equal(normalizeQuality({ kind: "WALKTHROUGH", covered: 4, missed: 0, wrong: 4 }), 3);
});

test("a walked step is schedulable", () => {
  assert.equal(isSchedulable("WALKTHROUGH"), true);
});
