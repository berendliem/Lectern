import { test } from "node:test";
import assert from "node:assert/strict";
import { blurtResponseSchema } from "./validation.ts";
import { normalizeQuality } from "./recall.ts";

test("blurtResponseSchema fills in the arrays a model left out", () => {
  const parsed = blurtResponseSchema.parse({ covered: ["mitosis has four phases"] });
  assert.deepEqual(parsed.missed, []);
  assert.deepEqual(parsed.wrong, []);
});

test("blurtResponseSchema rejects a correction with no claim attached", () => {
  assert.throws(() =>
    blurtResponseSchema.parse({
      covered: [],
      missed: [],
      wrong: [{ correction: "Meiosis halves the chromosome count." }],
    })
  );
  // A model that answered in prose instead of the shape is a 502, not a blurt
  // scored as a total blackout.
  assert.throws(() => blurtResponseSchema.parse({ covered: "I remembered a lot" }));
});

test("a blurt's grade follows what it covered, not how much was written", () => {
  const marked = blurtResponseSchema.parse({
    covered: ["a", "b", "c"],
    missed: ["d"],
    wrong: [{ claim: "e", correction: "not e" }],
  });
  assert.equal(
    normalizeQuality({
      kind: "BLURT",
      covered: marked.covered.length,
      missed: marked.missed.length,
      wrong: marked.wrong.length,
    }),
    3
  );
});
