import { test } from "node:test";
import assert from "node:assert/strict";
import { splitForSpeech } from "./recap-speech.ts";

test("short sentences are packed together rather than spoken one at a time", () => {
  assert.deepEqual(splitForSpeech("One. Two. Three."), ["One. Two. Three."]);
});

test("chunks break at a sentence end, never mid-clause", () => {
  const sentence = `${"word ".repeat(30).trim()}.`;
  for (const chunk of splitForSpeech(`${sentence} ${sentence} ${sentence}`)) {
    assert.match(chunk, /\.$/);
  }
});

test("no text is lost or duplicated", () => {
  const script = "First point here. Second one follows! And a question? Then a close.";
  assert.equal(splitForSpeech(script).join(" "), script);
});

test("a run-on sentence is split rather than left to be cut off mid-word", () => {
  const runOn = `${"word ".repeat(120).trim()}.`;
  const chunks = splitForSpeech(runOn);
  assert.ok(chunks.length > 1, "an over-long sentence must not go out as one utterance");
  for (const chunk of chunks) assert.ok(chunk.length <= 200, `chunk too long: ${chunk.length}`);
  assert.equal(chunks.join(" "), runOn);
});

test("a single unbreakable word is emitted rather than dropped", () => {
  const long = `${"a".repeat(400)}.`;
  assert.deepEqual(splitForSpeech(long), [long]);
});

test("line breaks in the model's output do not become pauses", () => {
  assert.deepEqual(splitForSpeech("One.\n\nTwo."), ["One. Two."]);
});

test("an empty script produces nothing to speak", () => {
  assert.deepEqual(splitForSpeech("   "), []);
});
