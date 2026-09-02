import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTimecode,
  parseVtt,
  parseSrt,
  parseTimestampedText,
  splitSpeaker,
  mergeSameSpeaker,
  segmentsToRawText,
  parseExternalTranscript,
} from "./transcript-import.ts";
import { createPageFromTextSchema } from "./validation.ts";

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

test("parseTimestampedText treats prose containing a timecode as body text", () => {
  const txt = [
    "Dr Vos   0:05",
    "We covered enzymes.",
    "The lecture wrapped up around 1:15",
    "12:30 is when we broke for lunch",
  ].join("\n");

  const segs = parseTimestampedText(txt);
  assert.equal(segs.length, 1, "prose lines must not open new turns");
  assert.equal(segs[0].speaker, "Dr Vos");
  assert.ok(segs[0].text.includes("wrapped up around 1:15"));
  assert.ok(segs[0].text.includes("12:30 is when we broke"));
});

test("mergeSameSpeaker joins adjacent cues from one speaker inside the window", () => {
  const merged = mergeSameSpeaker(
    [
      { start: 0, end: 2, text: "Enzymes are catalysts.", speaker: "Dr Vos" },
      { start: 2, end: 4, text: "They lower activation energy.", speaker: "Dr Vos" },
      { start: 4, end: 6, text: "Any questions?", speaker: "Berend Liem" },
    ],
    15
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[0].text, "Enzymes are catalysts. They lower activation energy.");
  assert.equal(merged[0].start, 0);
  assert.equal(merged[0].end, 4);
  assert.equal(merged[1].speaker, "Berend Liem");
});

test("mergeSameSpeaker breaks when the gap exceeds the window", () => {
  const merged = mergeSameSpeaker(
    [
      { start: 0, end: 2, text: "Before the break.", speaker: "Dr Vos" },
      { start: 100, end: 102, text: "After the break.", speaker: "Dr Vos" },
    ],
    15
  );
  assert.equal(merged.length, 2);
});

test("mergeSameSpeaker merges unlabelled segments too", () => {
  const merged = mergeSameSpeaker(
    [
      { start: 0, end: 2, text: "One." },
      { start: 2, end: 4, text: "Two." },
    ],
    15
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, "One. Two.");
});

test("segmentsToRawText prefixes each speaker change", () => {
  const raw = segmentsToRawText([
    { start: 0, end: 2, text: "Good morning.", speaker: "Dr Vos" },
    { start: 2, end: 4, text: "Morning.", speaker: "Berend Liem" },
    { start: 4, end: 6, text: "No label here." },
  ]);
  assert.equal(raw, "Dr Vos: Good morning.\n\nBerend Liem: Morning.\n\nNo label here.");
});

test("parseExternalTranscript sniffs content when the extension lies", () => {
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v Dr Vos>Hello.</v>\n";
  const parsed = parseExternalTranscript("meeting.txt", vtt);
  assert.equal(parsed.format, "vtt");
  assert.deepEqual(parsed.speakers, ["Dr Vos"]);
  assert.equal(parsed.segments.length, 1);
});

test("parseExternalTranscript returns nothing for text with no timestamps", () => {
  const parsed = parseExternalTranscript("notes.txt", "Just some prose with no times at all.");
  assert.equal(parsed.segments.length, 0);
});

test("createPageFromTextSchema rejects a segment whose end precedes its start", () => {
  const result = createPageFromTextSchema.safeParse({
    title: "Reversed cue",
    text: "Hello.",
    segments: [{ start: 10, end: 5, text: "Hello." }],
  });
  assert.equal(result.success, false);
  assert.ok(
    result.error.issues.some((i) => i.message.includes("end time must not be before")),
    "expected an actionable end-before-start error message"
  );
});

test("splitSpeaker accepts generic and particle speaker names, still rejects prose", () => {
  assert.equal(splitSpeaker("Speaker 1: Good morning.").speaker, "Speaker 1");
  assert.equal(splitSpeaker("Dr. van Vos: Good morning.").speaker, "Dr. van Vos");
  assert.equal(splitSpeaker("Remember this: it matters.").speaker, undefined);
  // A trailing number alone must not make a speaker, or slide-style cue text
  // would lose its prefix into a speaker label.
  assert.equal(splitSpeaker("Chapter 3: Photosynthesis.").speaker, undefined);
  assert.equal(splitSpeaker("Question 1: define enthalpy.").speaker, undefined);
});

test("parseTimestampedText attributes anonymous Speaker N turns separately", () => {
  const segs = parseTimestampedText(
    [
      "Speaker 1  0:03",
      "Okay so the mitochondrion.",
      "Speaker 2  0:22",
      "And the inner membrane?",
    ].join("\n")
  );

  assert.equal(segs.length, 2);
  assert.equal(segs[0].speaker, "Speaker 1");
  assert.equal(segs[0].text, "Okay so the mitochondrion.");
  assert.equal(segs[1].speaker, "Speaker 2");
  assert.equal(segs[1].text, "And the inner membrane?");
});

test("parseTimestampedText does not fold a particle-surname turn into the previous speaker", () => {
  const segs = parseTimestampedText(
    [
      "Berend Liem   0:03",
      "Right, let us get started.",
      "Dr. van Vos   0:41",
      "Quick question before you go on.",
      "Berend Liem   1:02",
      "Go ahead.",
    ].join("\n")
  );

  assert.equal(segs.length, 3);
  assert.equal(segs[1].speaker, "Dr. van Vos");
  assert.equal(segs[1].text, "Quick question before you go on.");
  assert.equal(segs[2].text, "Go ahead.");
});

test("parseExternalTranscript skips reversed cues instead of failing the whole file", () => {
  const vtt = [
    "WEBVTT",
    "",
    "00:00:01.000 --> 00:00:04.000",
    "<v Dr Vos>Good cue.</v>",
    "",
    "00:00:20.000 --> 00:00:10.000",
    "<v Dr Vos>Reversed cue.</v>",
    "",
  ].join("\n");

  const parsed = parseExternalTranscript("meeting.vtt", vtt);
  assert.equal(parsed.segments.length, 1);
  assert.equal(parsed.segments[0].text, "Good cue.");
  assert.equal(parsed.skipped, 1);
});

test("parseExternalTranscript clamps an over-long speaker name to the stored limit", () => {
  const longName = "A".repeat(400);
  const vtt = `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<v ${longName}>Hello.</v>\n`;

  const parsed = parseExternalTranscript("meeting.vtt", vtt);
  assert.equal(parsed.segments.length, 1);
  assert.equal(parsed.segments[0].speaker?.length, 120);
  assert.equal(
    createPageFromTextSchema.safeParse({
      title: "Long name",
      text: "Hello.",
      segments: parsed.segments,
    }).success,
    true
  );
});

test("mergeSameSpeaker keeps word timings when only one side carries them", () => {
  const merged = mergeSameSpeaker(
    [
      { start: 0, end: 2, text: "One.", speaker: "Dr Vos" },
      { start: 2, end: 4, text: "Two.", speaker: "Dr Vos", words: [{ word: "Two.", start: 2, end: 4, probability: 1 }] },
    ],
    15
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].words?.length, 1);
});
