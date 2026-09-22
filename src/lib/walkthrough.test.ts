import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSections, splitSlides } from "./walkthrough.ts";

const long = (word: string) => `${word} `.repeat(40).trim();

test("splitSlides makes one step per slide marker", () => {
  const deck = [
    `Slide 1: Photosynthesis\n${long("light")}`,
    `Slide 2: The Calvin cycle\n${long("carbon")}`,
  ].join("\n");
  const steps = splitSlides(deck);
  assert.equal(steps.length, 2);
  assert.deepEqual(
    steps.map((s) => s.label),
    ["Slide 1", "Slide 2"]
  );
  assert.equal(steps[0].ordinal, 0);
  assert.match(steps[0].sourceText, /^Slide 1: Photosynthesis/);
});

test("splitSlides folds a title card into the slide it introduces", () => {
  const deck = ["Slide 3: Week 4", `Slide 4: Enzyme kinetics\n${long("substrate")}`].join("\n");
  const steps = splitSlides(deck);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].label, "Slides 3-4");
  assert.match(steps[0].sourceText, /Week 4/);
  assert.match(steps[0].sourceText, /Enzyme kinetics/);
});

test("splitSlides folds a short final slide backwards", () => {
  const deck = [
    `Slide 1: Intro\n${long("alpha")}`,
    `Slide 2: Body\n${long("beta")}`,
    "Slide 3: Questions?",
  ].join("\n");
  const steps = splitSlides(deck);
  assert.equal(steps.length, 2);
  assert.equal(steps[1].label, "Slides 2-3");
  assert.match(steps[1].sourceText, /Questions\?/);
});

test("splitSlides ignores the word slide used in prose", () => {
  assert.deepEqual(splitSlides("as shown on the slide before this one"), []);
});

test("splitSlides returns nothing for text with no markers, so the caller falls back", () => {
  assert.deepEqual(splitSlides("A reading with no deck structure at all."), []);
});

test("splitSections cuts on the headings it can find", () => {
  const reading =
    "Preamble text.\n\nWhat is a set?\nA set is a collection.\n\nSubsets\nA is a subset of B.";
  const steps = splitSections(reading, ["What is a set?", "Subsets"]);
  assert.equal(steps.length, 2);
  assert.deepEqual(
    steps.map((s) => s.label),
    ["What is a set?", "Subsets"]
  );
  // The opening paragraph belongs to the first step rather than being dropped.
  assert.match(steps[0].sourceText, /Preamble text\./);
  assert.match(steps[1].sourceText, /subset of B/);
});

test("splitSections skips a heading the model invented", () => {
  const reading = "Subsets\nA is a subset of B.";
  const steps = splitSections(reading, ["Cardinality", "Subsets"]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].label, "Subsets");
});

test("splitSections falls back to one step when no heading matches", () => {
  const steps = splitSections("Unstructured prose with no headings.", ["Nope"]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].label, "The whole text");
  assert.equal(steps[0].sourceText, "Unstructured prose with no headings.");
});

test("splitSections returns nothing for empty text", () => {
  assert.deepEqual(splitSections("   \n  ", ["Anything"]), []);
});
