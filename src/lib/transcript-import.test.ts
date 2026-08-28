import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimecode, parseVtt, parseSrt, parseTimestampedText } from "./transcript-import.ts";

test("parseTimecode handles hh:mm:ss.mmm, comma millis, and m:ss", () => {
  assert.equal(parseTimecode("00:01:02.500"), 62.5);
  assert.equal(parseTimecode("00:01:02,500"), 62.5);
  assert.equal(parseTimecode("01:02"), 62);
  assert.equal(parseTimecode("01:00:00"), 3600);
});

test("parseVtt reads Teams voice tags", () => {
  const vtt = [
    "WEBVTT",
    "",
    "d1f2-1",
    "00:00:01.000 --> 00:00:04.000",
    "<v Berend Liem>Welcome to week one.</v>",
    "",
    "d1f2-2",
    "00:00:05.000 --> 00:00:07.000",
    "<v Dr Vos>Let us begin.</v>",
    "",
  ].join("\n");

  const segs = parseVtt(vtt);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].start, 1);
  assert.equal(segs[0].end, 4);
  assert.equal(segs[0].speaker, "Berend Liem");
  assert.equal(segs[0].text, "Welcome to week one.");
  assert.equal(segs[1].speaker, "Dr Vos");
});

test("parseVtt reads a colon speaker prefix and skips NOTE blocks", () => {
  const vtt = [
    "WEBVTT",
    "",
    "NOTE this is a comment",
    "",
    "00:00:02.000 --> 00:00:03.000",
    "Dr Vos: Photosynthesis converts light.",
    "",
  ].join("\n");

  const segs = parseVtt(vtt);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].speaker, "Dr Vos");
  assert.equal(segs[0].text, "Photosynthesis converts light.");
});

test("parseVtt leaves a sentence containing a colon alone", () => {
  const vtt = [
    "WEBVTT",
    "",
    "00:00:02.000 --> 00:00:03.000",
    "Remember this: the mitochondrion is the powerhouse.",
    "",
  ].join("\n");

  const segs = parseVtt(vtt);
  assert.equal(segs[0].speaker, undefined);
  assert.equal(segs[0].text, "Remember this: the mitochondrion is the powerhouse.");
});

test("parseTimecode rejects malformed input instead of guessing", () => {
  assert.ok(Number.isNaN(parseTimecode("01:")));
  assert.ok(Number.isNaN(parseTimecode("00::30")));
  assert.ok(Number.isNaN(parseTimecode("abc")));
  // Valid forms are unaffected.
  assert.equal(parseTimecode("00:01:02.500"), 62.5);
});

test("parseSrt reads numbered cues with comma millis", () => {
  const srt = [
    "1",
    "00:00:01,000 --> 00:00:03,000",
    "Dr Vos: Good morning.",
    "",
    "2",
    "00:00:04,000 --> 00:00:06,500",
    "Today we cover enzymes.",
    "",
  ].join("\n");

  const segs = parseSrt(srt);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].speaker, "Dr Vos");
  assert.equal(segs[0].text, "Good morning.");
  assert.equal(segs[1].end, 6.5);
});

test("parseTimestampedText reads the Teams Word export shape", () => {
  const txt = [
    "Berend Liem   0:03",
    "Are we recording?",
    "Dr Vos   0:09",
    "Yes. Let us start with enzymes.",
    "They lower activation energy.",
  ].join("\n");

  const segs = parseTimestampedText(txt);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].speaker, "Berend Liem");
  assert.equal(segs[0].start, 3);
  assert.equal(segs[0].text, "Are we recording?");
  assert.equal(segs[1].speaker, "Dr Vos");
  assert.equal(segs[1].text, "Yes. Let us start with enzymes. They lower activation energy.");
  // A segment with no end of its own runs up to the next segment's start.
  assert.equal(segs[0].end, 9);
});

test("parseTimestampedText reads the bracketed inline shape", () => {
  const txt = ["[00:00:10] Dr Vos: Enzymes are catalysts.", "[00:00:20] And they are reusable."].join("\n");

  const segs = parseTimestampedText(txt);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].start, 10);
  assert.equal(segs[0].speaker, "Dr Vos");
  assert.equal(segs[0].text, "Enzymes are catalysts.");
  assert.equal(segs[1].start, 20);
});

test("parseTimestampedText estimates an end for the final segment", () => {
  const segs = parseTimestampedText("Dr Vos   0:05\nOne two three four five six.");
  assert.equal(segs.length, 1);
  assert.ok(segs[0].end > segs[0].start, "final segment must have a positive duration");
});
