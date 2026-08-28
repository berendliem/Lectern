import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTimecode, parseVtt } from "./transcript-import.ts";

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
