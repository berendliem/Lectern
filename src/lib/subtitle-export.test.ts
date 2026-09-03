import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSrt, buildVtt } from "./subtitle-export.ts";

test("buildVtt carries the speaker through as a voice tag", () => {
  const vtt = buildVtt([
    { start: 1, end: 4, text: "Welcome to week one.", speaker: "Berend Liem" },
    { start: 5, end: 7, text: "No speaker here." },
  ]);

  assert.match(vtt, /^WEBVTT\n/);
  assert.ok(vtt.includes("<v Berend Liem>Welcome to week one.</v>"));
  assert.ok(vtt.includes("00:00:05.000 --> 00:00:07.000\nNo speaker here."));
});

test("buildSrt leaves speakers out — SubRip has no voice syntax", () => {
  const srt = buildSrt([{ start: 1, end: 4, text: "Welcome.", speaker: "Berend Liem" }]);
  assert.equal(srt.includes("Berend Liem"), false);
  assert.ok(srt.includes("1\n00:00:01,000 --> 00:00:04,000\nWelcome."));
});
