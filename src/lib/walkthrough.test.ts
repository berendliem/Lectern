import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSections, splitSlides, toStepView } from "./walkthrough.ts";
import {
  walkthroughOutlineResponseSchema,
  walkthroughRecallResponseSchema,
  walkthroughStepIndexSchema,
  walkthroughTeachResponseSchema,
} from "./validation.ts";
import { buildWalkthroughTeachUserPrompt } from "./prompts/walkthrough.ts";

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

test("splitSections does not let a heading mentioned in earlier prose cut mid-sentence", () => {
  const reading =
    "Foo\nThis references Bar informally.\n\nBar\nReal Bar content.";
  const steps = splitSections(reading, ["Foo", "Bar"]);
  assert.equal(steps.length, 2);
  assert.match(steps[0].sourceText, /This references Bar informally\.$/);
  assert.match(steps[1].sourceText, /^Bar\n/);
});

test("splitSections skips a heading that only ever appears mid-line", () => {
  const steps = splitSections("Some prose mentioning Bar in passing.", ["Bar"]);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].label, "The whole text");
});

test("walkthroughOutlineResponseSchema defaults a missing heading list to empty", () => {
  assert.deepEqual(walkthroughOutlineResponseSchema.parse({}).headings, []);
});

test("walkthroughTeachResponseSchema requires both halves of a step", () => {
  assert.throws(() => walkthroughTeachResponseSchema.parse({ explanation: "because" }));
  const parsed = walkthroughTeachResponseSchema.parse({
    explanation: "Light reactions make ATP.",
    recallPrompt: "What do the light reactions produce?",
  });
  assert.equal(parsed.recallPrompt, "What do the light reactions produce?");
});

test("walkthroughRecallResponseSchema fills in the arrays a model left out", () => {
  const parsed = walkthroughRecallResponseSchema.parse({ covered: ["ATP"] });
  assert.deepEqual(parsed.missed, []);
  assert.deepEqual(parsed.wrong, []);
});

test("walkthroughStepIndexSchema rejects a negative step", () => {
  assert.throws(() => walkthroughStepIndexSchema.parse({ stepIndex: -1 }));
  assert.equal(walkthroughStepIndexSchema.parse({ stepIndex: 4 }).stepIndex, 4);
});

test("the teaching prompt tells a deck and a reading apart", () => {
  const deck = buildWalkthroughTeachUserPrompt({
    materialTitle: "Week 4",
    kind: "SLIDES",
    label: "Slide 7",
    sourceText: "Slide 7: Enzymes\n- lower activation energy",
  });
  const reading = buildWalkthroughTeachUserPrompt({
    materialTitle: "Chapter 2",
    kind: "READING",
    label: "Subsets",
    sourceText: "Subsets\nA is a subset of B when…",
  });
  assert.match(deck, /bullets are shorthand/i);
  assert.match(reading, /move in an argument/i);
});

test("toStepView strips wider row fields down to the six client fields", () => {
  const row = {
    id: "step-1",
    walkthroughId: "wt-1",
    ordinal: 0,
    label: "Slide 1",
    sourceText: "Slide 1: Intro",
    explanation: "It introduces the topic.",
    recallPrompt: "What does slide 1 introduce?",
    walkthrough: { id: "wt-1", materialId: "mat-1", stepIndex: 0 },
  };
  assert.deepEqual(toStepView(row), {
    id: "step-1",
    ordinal: 0,
    label: "Slide 1",
    sourceText: "Slide 1: Intro",
    explanation: "It introduces the topic.",
    recallPrompt: "What does slide 1 introduce?",
  });
});

test("the teaching prompt truncates a step's source text at MAX_STEP_CHARS", () => {
  const long = "a".repeat(13_000) + "MARKER_PAST_CAP";
  const prompt = buildWalkthroughTeachUserPrompt({
    materialTitle: "Chapter 9",
    kind: "READING",
    label: "Long section",
    sourceText: long,
  });
  assert.doesNotMatch(prompt, /MARKER_PAST_CAP/);
});
