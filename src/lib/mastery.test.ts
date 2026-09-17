import { test } from "node:test";
import assert from "node:assert/strict";
import { isLeech, LEECH_MISSES } from "./mastery.ts";

test("a card is a leech once it has missed enough times without settling", () => {
  assert.equal(isLeech(LEECH_MISSES - 1, 0), false);
  assert.equal(isLeech(LEECH_MISSES, 0), true);
  assert.equal(isLeech(LEECH_MISSES, 2), true);
  // Three passes in a row: whatever it cost, it stuck.
  assert.equal(isLeech(LEECH_MISSES + 5, 3), false);
});
