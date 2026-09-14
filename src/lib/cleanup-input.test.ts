import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanupInput } from "./cleanup-input.ts";

const seg = (text: string, speaker?: string) => ({ start: 0, end: 1, text, ...(speaker ? { speaker } : {}) });

test("an unlabelled transcript is passed through as raw text with no lecturer", () => {
  assert.deepEqual(cleanupInput("raw words", [seg("raw"), seg("words")]), { text: "raw words" });
});

test("a diarized transcript is labelled and the speaker with the most words is the lecturer", () => {
  const result = cleanupInput("ignored", [
    seg("Is this on the exam?", "Speaker 2"),
    seg("Yes. Bayes says", "Speaker 1"),
    seg("posterior is prior times likelihood.", "Speaker 1"),
    seg("Cool.", "Speaker 2"),
  ]);
  assert.equal(result.lecturer, "Speaker 1");
  assert.equal(
    result.text,
    "Speaker 2: Is this on the exam?\n\nSpeaker 1: Yes. Bayes says\n\nposterior is prior times likelihood.\n\nSpeaker 2: Cool."
  );
});
