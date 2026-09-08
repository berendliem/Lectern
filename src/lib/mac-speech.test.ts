import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignSpeakers,
  needsConversion,
  speakerForMidpoint,
  speakerLabel,
  wordsToSegments,
} from "./mac-speech.ts";

const word = (text: string, start: number, end: number) => ({ word: text, start, end, probability: 0.9 });

test("a word straddling a handover goes to whoever said most of it", () => {
  const spans = [
    { start: 0, end: 5, speakerId: "S1" },
    { start: 5, end: 10, speakerId: "S2" },
  ];
  // 4.6 → 5.4 has its midpoint at 5.0, which the first span still owns;
  // 4.9 → 5.6 has its midpoint past the handover.
  assert.equal(speakerForMidpoint(word("chain", 4.6, 5.4), spans), "S1");
  assert.equal(speakerForMidpoint(word("rule", 4.9, 5.6), spans), "S2");
});

test("a word covered by no span inherits the previous word's speaker", () => {
  const spans = [{ start: 0, end: 2, speakerId: "S1" }];
  const assigned = assignSpeakers([word("gradient", 0, 1), word("descent", 8, 9)], spans);
  assert.deepEqual(
    assigned.map((w) => w.speaker),
    ["Speaker 1", "Speaker 1"]
  );
});

test("with no spans at all every word stays unlabelled", () => {
  const assigned = assignSpeakers([word("one", 0, 1), word("two", 1, 2)], []);
  assert.deepEqual(
    assigned.map((w) => w.speaker),
    [undefined, undefined]
  );
});

test("diarizer ids become reader-facing labels, unknown shapes pass through", () => {
  assert.equal(speakerLabel("S2"), "Speaker 2");
  assert.equal(speakerLabel(" s10 "), "Speaker 10");
  assert.equal(speakerLabel("Dr. Chen"), "Dr. Chen");
});

test("segments break where the speaker changes", () => {
  const spans = [
    { start: 0, end: 2, speakerId: "S1" },
    { start: 2, end: 4, speakerId: "S2" },
  ];
  const words = [word("hello", 0, 0.5), word("everyone", 0.6, 1.2), word("professor", 2.2, 3)];
  const segments = wordsToSegments(assignSpeakers(words, spans));

  assert.equal(segments.length, 2);
  assert.deepEqual(
    segments.map((s) => [s.speaker, s.text]),
    [
      ["Speaker 1", "hello everyone"],
      ["Speaker 2", "professor"],
    ]
  );
});

test("punctuation stays tight to the word it follows", () => {
  const words = [word("Good", 0, 0.3), word(" morning,", 0.3, 0.7), word(" everyone.", 0.7, 1.1)];
  const [segment] = wordsToSegments(assignSpeakers(words, []));
  assert.equal(segment.text, "Good morning, everyone.");
});

test("word timings survive into the segments", () => {
  const [segment] = wordsToSegments(assignSpeakers([word("one", 0, 1), word("two", 1, 2)], []));
  assert.equal(segment.words?.length, 2);
  assert.deepEqual([segment.start, segment.end], [0, 2]);
});

test("a long pause starts a new segment, but the merge window rejoins one speaker", () => {
  // 3s of silence breaks the run; mergeSameSpeaker's 15s window then puts the
  // same speaker's two runs back together, exactly as it does for an import.
  const words = [word("first", 0, 1), word("second", 4, 5)];
  const segments = wordsToSegments(assignSpeakers(words, [{ start: 0, end: 5, speakerId: "S1" }]));
  assert.equal(segments.length, 1);
  assert.equal(segments[0].text, "first second");
});

test("only containers AVFoundation cannot open are converted", () => {
  for (const name of ["clip.webm", "clip.ogg", "lecture.mkv", "CLIP.WEBM"]) {
    assert.equal(needsConversion(name), true, name);
  }
  for (const name of ["audio.m4a", "audio.mp3", "audio.wav", "lecture.mp4", "audio.mov"]) {
    assert.equal(needsConversion(name), false, name);
  }
});
