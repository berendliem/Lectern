import { test } from "node:test";
import assert from "node:assert/strict";
import { splitIntoSentences, sentenceAt, type Sentence } from "./read-aloud.ts";

/** Rebuild a sentence from its (piece, offset) addresses, the way a Range does. */
function slice(pieces: string[], s: Sentence) {
  if (s.startPiece === s.endPiece) {
    return pieces[s.startPiece].slice(s.startOffset, s.endOffset);
  }
  let out = pieces[s.startPiece].slice(s.startOffset);
  for (let i = s.startPiece + 1; i < s.endPiece; i++) out += pieces[i];
  return out + pieces[s.endPiece].slice(0, s.endOffset);
}

test("splits one piece into sentences", () => {
  const pieces = ["Entropy always increases. Heat flows one way."];
  const sentences = splitIntoSentences(pieces);
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0].text, "Entropy always increases.");
  assert.equal(sentences[1].text, "Heat flows one way.");
});

test("addresses resolve back to the sentence text", () => {
  const pieces = ["Entropy always increases. Heat flows one way."];
  for (const s of splitIntoSentences(pieces)) {
    assert.equal(slice(pieces, s), s.text);
  }
});

test("a sentence spanning several pieces keeps correct start and end", () => {
  // What a bolded word inside a paragraph looks like once rendered: three
  // text nodes, one sentence.
  const pieces = ["The second law is ", "irreversible", " in closed systems."];
  const sentences = splitIntoSentences(pieces);
  assert.equal(sentences.length, 1);
  assert.equal(sentences[0].text, "The second law is irreversible in closed systems.");
  assert.equal(sentences[0].startPiece, 0);
  assert.equal(sentences[0].startOffset, 0);
  assert.equal(sentences[0].endPiece, 2);
  assert.equal(sentences[0].endOffset, pieces[2].length);
  assert.equal(slice(pieces, sentences[0]), sentences[0].text);
});

test("whitespace between sentences is excluded from both", () => {
  const pieces = ["One.", "\n\n   ", "Two."];
  const sentences = splitIntoSentences(pieces);
  assert.deepEqual(
    sentences.map((s) => s.text),
    ["One.", "Two."]
  );
  assert.equal(sentences[1].startPiece, 2);
  assert.equal(sentences[1].startOffset, 0);
  for (const s of sentences) assert.equal(slice(pieces, s), s.text);
});

test("adjacent blocks do not run together into one sentence", () => {
  // Two list items as react-markdown renders them: no whitespace between the
  // text nodes at all. Without the block hint these segment as one sentence.
  const pieces = ["Heat flows one way.", "Work is not free."];
  assert.deepEqual(
    splitIntoSentences(pieces).map((s) => s.text),
    ["Heat flows one way.Work is not free."]
  );

  const sentences = splitIntoSentences(pieces, "en", new Set([1]));
  assert.deepEqual(
    sentences.map((s) => s.text),
    ["Heat flows one way.", "Work is not free."]
  );
  // The separator belongs to no piece, so offsets still address the pieces.
  assert.equal(sentences[1].startPiece, 1);
  assert.equal(sentences[1].startOffset, 0);
  for (const s of sentences) assert.equal(slice(pieces, s), s.text);
});

test("a block hint does not split a sentence that legitimately spans pieces", () => {
  const pieces = ["A heading", "Entropy rises. Heat spreads."];
  const sentences = splitIntoSentences(pieces, "en", new Set([1]));
  assert.deepEqual(
    sentences.map((s) => s.text),
    ["A heading", "Entropy rises.", "Heat spreads."]
  );
  for (const s of sentences) assert.equal(slice(pieces, s), s.text);
});

test("empty and whitespace-only input yields no sentences", () => {
  assert.deepEqual(splitIntoSentences([]), []);
  assert.deepEqual(splitIntoSentences(["", "  \n "]), []);
});

test("sentenceAt finds the sentence holding a position", () => {
  const pieces = ["One. ", "Two. ", "Three."];
  const sentences = splitIntoSentences(pieces);
  assert.equal(sentences.length, 3);
  assert.equal(sentenceAt(sentences, 0, 1), 0);
  assert.equal(sentenceAt(sentences, 1, 0), 1);
  assert.equal(sentenceAt(sentences, 2, 5), 2);
});

test("sentenceAt lands on the next sentence when the position is in a gap", () => {
  const pieces = ["One.", "   ", "Two."];
  const sentences = splitIntoSentences(pieces);
  assert.equal(sentenceAt(sentences, 1, 1), 1);
});

test("sentenceAt returns -1 when there is nothing to read", () => {
  assert.equal(sentenceAt([], 0, 0), -1);
});
