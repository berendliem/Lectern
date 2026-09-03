import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COVERAGE_THRESHOLD,
  classifyTopic,
  coverageThreshold,
  rollUpMastery,
} from "./coverage.ts";

const match = (score: number) => ({ score, title: "Lecture 3", pageId: "p1", materialId: null });

test("a score exactly at the threshold counts as covered", () => {
  assert.equal(classifyTopic(match(0.35), 0.35).covered, true);
});

test("a score just under the threshold does not", () => {
  const out = classifyTopic(match(0.3499), 0.35);
  assert.equal(out.covered, false);
  // The near-miss is still reported, so the UI can name the closest lecture.
  assert.equal(out.match?.title, "Lecture 3");
});

test("a topic with no match at all is uncovered and has no match", () => {
  assert.deepEqual(classifyTopic(null, 0.35), { covered: false, match: null });
});

test("the threshold env var overrides the default, and nonsense falls back", () => {
  assert.equal(coverageThreshold("0.5"), 0.5);
  assert.equal(coverageThreshold(undefined), DEFAULT_COVERAGE_THRESHOLD);
  assert.equal(coverageThreshold("banana"), DEFAULT_COVERAGE_THRESHOLD);
  // Cosine over normalized vectors never exceeds 1; a threshold of 2 would
  // mark every topic uncovered forever.
  assert.equal(coverageThreshold("2"), DEFAULT_COVERAGE_THRESHOLD);
});

test("mastery rolls up to the weakest card", () => {
  const reviewed = new Date();
  assert.equal(rollUpMastery([]), null);
  assert.equal(
    rollUpMastery([
      { repetitions: 5, lastReviewedAt: reviewed },
      { repetitions: 0, lastReviewedAt: null },
    ]),
    "new"
  );
  assert.equal(
    rollUpMastery([
      { repetitions: 4, lastReviewedAt: reviewed },
      { repetitions: 1, lastReviewedAt: reviewed },
    ]),
    "learning"
  );
  assert.equal(
    rollUpMastery([
      { repetitions: 3, lastReviewedAt: reviewed },
      { repetitions: 9, lastReviewedAt: reviewed },
    ]),
    "mastered"
  );
});
