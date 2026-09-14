import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupInput } from "./cleanup-input.ts";

const seg = (text: string, speaker?: string) => ({ start: 0, end: 1, text, ...(speaker ? { speaker } : {}) });

test("an unlabelled transcript is passed through as raw text with no lecturer", () => {
  assert.deepEqual(cleanupInput("raw words", [seg("raw"), seg("words")], 8000), { chunks: ["raw words"] });
});

test("a diarized transcript is labelled and the speaker with the most words is the lecturer", () => {
  const result = cleanupInput(
    "ignored",
    [
      seg("Is this on the exam?", "Speaker 2"),
      seg("Yes. Bayes says", "Speaker 1"),
      seg("posterior is prior times likelihood.", "Speaker 1"),
      seg("Cool.", "Speaker 2"),
    ],
    8000
  );
  assert.equal(result.lecturer, "Speaker 1");
  assert.deepEqual(result.chunks, [
    "Speaker 2: Is this on the exam?\n\nSpeaker 1: Yes. Bayes says\n\nposterior is prior times likelihood.\n\nSpeaker 2: Cool.",
  ]);
});

test("a chunk that starts mid-run opens with the speaker's label", () => {
  // Three lecturer segments that do not fit one chunk: the second chunk must
  // name Speaker 1 again, or the model reads its opening as a student.
  const result = cleanupInput(
    "ignored",
    [seg("one two three", "Speaker 1"), seg("four five six", "Speaker 1"), seg("seven", "Speaker 1")],
    50
  );
  assert.deepEqual(result.chunks, ["Speaker 1: one two three", "Speaker 1: four five six\n\nseven"]);
});
