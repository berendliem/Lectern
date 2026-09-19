import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRADE_MARKER,
  charToWordIndex,
  createSentenceSplitter,
  createTrailerFilter,
  normalizeSpoken,
  parseGradeTrailer,
  questionFromSpoken,
  splitSentences,
  spokenOffset,
  wordIndexAt,
  wordSchedule,
} from "./live-text.ts";

const TEXT =
  'Hello there. How are you? e.g. this works. pi is 3.14 today. He said "stop." Then we left.\nNew line here. Done';

test("splitSentences follows the platform's rules", () => {
  assert.deepEqual(splitSentences(TEXT), [
    "Hello there.",
    "How are you?",
    // Intl.Segmenter only breaks before a capital, so "pi" joins the sentence before it.
    "e.g. this works. pi is 3.14 today.",
    'He said "stop."',
    "Then we left.",
    "New line here.",
    "Done",
  ]);
});

test("the streaming splitter matches splitSentences however the text is chunked", () => {
  const splitter = createSentenceSplitter();
  const out: string[] = [];
  for (const ch of TEXT) out.push(...splitter.push(ch));
  out.push(...splitter.flush());
  assert.deepEqual(out, splitSentences(TEXT));
});

test("the streaming splitter holds a sentence until the next one starts", () => {
  const splitter = createSentenceSplitter();
  assert.deepEqual(splitter.push("It ends here"), []);
  assert.deepEqual(splitter.push("."), []);
  assert.deepEqual(splitter.push(" Next"), ["It ends here."]);
  assert.deepEqual(splitter.flush(), ["Next"]);
});

test("normalizeSpoken collapses whitespace inside and between sentences", () => {
  assert.equal(normalizeSpoken("One  two.\n\nThree   four."), "One two. Three four.");
});

test("trailer filter: marker in one chunk", () => {
  const f = createTrailerFilter();
  assert.equal(f.push(`Good answer. ${GRADE_MARKER} {"score":5}`), "Good answer. ");
  assert.deepEqual(f.finish(), { rest: "", spoken: "Good answer. ", trailer: ' {"score":5}' });
});

test("trailer filter: marker split across chunks is never emitted", () => {
  const f = createTrailerFilter();
  const emitted = ["Nice.\n@", "@GR", "ADE {\"s", "core\":4}"].map((d) => f.push(d)).join("");
  assert.equal(emitted, "Nice.\n");
  assert.equal(f.finish().trailer, ' {"score":4}');
});

test("trailer filter: a held-back prefix that is not the marker is released", () => {
  const f = createTrailerFilter();
  assert.equal(f.push("Email me @"), "Email me ");
  assert.equal(f.push("home"), "@home");
  assert.deepEqual(f.finish(), { rest: "", spoken: "Email me @home", trailer: null });
});

test("trailer filter: no marker releases the held tail on finish", () => {
  const f = createTrailerFilter();
  assert.equal(f.push("Ends with @@"), "Ends with ");
  assert.deepEqual(f.finish(), { rest: "@@", spoken: "Ends with @@", trailer: null });
});

test("parseGradeTrailer", () => {
  assert.deepEqual(parseGradeTrailer(' {"score":3}\n'), { score: 3 });
  assert.deepEqual(parseGradeTrailer(' ```json\n{"score":2}\n```'), { score: 2 });
  assert.equal(parseGradeTrailer(null), null);
  assert.equal(parseGradeTrailer(" not json"), null);
  assert.equal(parseGradeTrailer(" {broken"), null);
});

test("wordSchedule is monotonic, starts at 0 and ends at the duration", () => {
  const s = wordSchedule("The rate, in short, is zero.", 2);
  assert.equal(s.length, 6);
  assert.equal(s[0].start, 0);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].start >= s[i - 1].start);
  assert.ok(Math.abs(s[s.length - 1].end - 2) < 1e-9);
});

test("wordSchedule gives punctuation a pause", () => {
  const withComma = wordSchedule("aaaa, bbbb", 1);
  const without = wordSchedule("aaaa bbbb", 1);
  assert.ok(withComma[1].start > without[1].start);
});

test("wordSchedule of empty text is empty", () => {
  assert.deepEqual(wordSchedule("   ", 1), []);
});

test("wordIndexAt", () => {
  const s = wordSchedule("one two three", 3);
  assert.equal(wordIndexAt(s, 0), 0);
  assert.equal(wordIndexAt(s, s[1].start), 1);
  assert.equal(wordIndexAt(s, 99), 2);
});

test("charToWordIndex", () => {
  assert.equal(charToWordIndex("Hello big world", 0), 0);
  assert.equal(charToWordIndex("Hello big world", 6), 1);
  assert.equal(charToWordIndex("Hello big world", 7), 1);
  assert.equal(charToWordIndex("Hello big world", 10), 2);
});

test("spokenOffset lands just past the word being said", () => {
  const sentences = ["First one here.", "Second part now."];
  const joined = sentences.join(" ");
  assert.equal(joined.slice(0, spokenOffset(sentences, 0, 0)), "First");
  assert.equal(joined.slice(0, spokenOffset(sentences, 0, 2)), "First one here.");
  assert.equal(joined.slice(0, spokenOffset(sentences, 1, 1)), "First one here. Second part");
});

test("questionFromSpoken takes the last question", () => {
  assert.equal(questionFromSpoken("Close. Why is that? Try this: what is 2 plus 2?"), "Try this: what is 2 plus 2?");
  assert.equal(questionFromSpoken("Well done. That is all."), null);
});
