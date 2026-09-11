import { test } from "node:test";
import assert from "node:assert/strict";
import { splitCloze } from "./cloze.ts";

test("the blank keeps its place in the sentence", () => {
  assert.deepEqual(splitCloze("The {{mitochondrion}} produces ATP."), {
    before: "The ",
    after: " produces ATP.",
  });
});

test("a gap at the end leaves nothing after it", () => {
  assert.deepEqual(splitCloze("ATP is produced by the {{mitochondrion}}"), {
    before: "ATP is produced by the ",
    after: "",
  });
});

test("a prompt with no marker still gets a blank, at the end", () => {
  assert.deepEqual(splitCloze("Name the organelle that produces ATP."), {
    before: "Name the organelle that produces ATP.",
    after: "",
  });
});

test("a second marker stays literal rather than becoming an ungraded blank", () => {
  assert.deepEqual(splitCloze("{{Glycolysis}} precedes the {{Krebs cycle}}."), {
    before: "",
    after: " precedes the {{Krebs cycle}}.",
  });
});

test("a gap spanning a newline is still found", () => {
  assert.deepEqual(splitCloze("The {{Krebs\ncycle}} runs in the matrix."), {
    before: "The ",
    after: " runs in the matrix.",
  });
});
