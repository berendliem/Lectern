import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MASTERY_SCORE,
  MAX_MASTERY_ATTEMPTS,
  shouldRequeue,
  qualityForScore,
  scoreForQuality,
  gradeShortAnswer,
} from "./grading.ts";

test("a score at the bar is mastered, one below it is not", () => {
  assert.equal(shouldRequeue(MASTERY_SCORE, 1), false);
  assert.equal(shouldRequeue(MASTERY_SCORE - 1, 1), true);
  assert.equal(shouldRequeue(100, 1), false);
  assert.equal(shouldRequeue(0, 1), true);
});

test("the cap releases an item the student cannot master", () => {
  assert.equal(shouldRequeue(10, MAX_MASTERY_ATTEMPTS - 1), true);
  assert.equal(shouldRequeue(10, MAX_MASTERY_ATTEMPTS), false);
  assert.equal(shouldRequeue(10, MAX_MASTERY_ATTEMPTS + 1), false);
});

test("a score that isn't a number never requeues", () => {
  // A grader that fell over must not put a question into an endless loop.
  assert.equal(shouldRequeue(NaN, 1), false);
});

/**
 * The loop the session actually runs: answer the item at the head, push it
 * back when it misses the bar, stop when the queue is exhausted. What this
 * guards is termination — a requeue rule that never releases turns the study
 * session into one the student cannot finish.
 */
function runSession(scores: number[]): { asked: number; queueLength: number } {
  const queue = ["q1"];
  const attempts: Record<string, number> = {};
  let asked = 0;

  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const score = scores[asked] ?? 0;
    asked += 1;
    const attempt = (attempts[id] ?? 0) + 1;
    attempts[id] = attempt;
    if (shouldRequeue(score, attempt)) queue.push(id);
  }

  return { asked, queueLength: queue.length };
}

test("a mastered answer is asked once", () => {
  assert.deepEqual(runSession([90]), { asked: 1, queueLength: 1 });
});

test("a missed answer comes back, and the session still terminates", () => {
  assert.deepEqual(runSession([40, 90]), { asked: 2, queueLength: 2 });
  assert.deepEqual(runSession([0, 0, 0, 0, 0]), {
    asked: MAX_MASTERY_ATTEMPTS,
    queueLength: MAX_MASTERY_ATTEMPTS,
  });
});

test("the mastered band is exactly the qualities that don't requeue", () => {
  // The invariant the session leans on: a card the student is told they got
  // ("Good" or "Easy") must never be the card that comes back for missing the
  // bar, and vice versa.
  for (const score of [0, 30, 59, 60, 84, 85, 94, 95, 100]) {
    const mastered = score >= MASTERY_SCORE;
    assert.equal(qualityForScore(score) >= 4, mastered, `score ${score}`);
    assert.equal(shouldRequeue(score, 1), !mastered, `score ${score}`);
  }
  assert.equal(qualityForScore(Number.NaN), 0);
});

test("a pressed button round-trips through the score scale", () => {
  for (const quality of [0, 3, 4, 5]) {
    assert.equal(qualityForScore(scoreForQuality(quality)), quality, `quality ${quality}`);
  }
});

test("gradeShortAnswer still scores overlap for the offline fallback", () => {
  assert.equal(gradeShortAnswer("the mitochondria makes energy", "mitochondria makes energy").isCorrect, true);
  assert.equal(gradeShortAnswer("no idea", "mitochondria makes energy").isCorrect, false);
});
