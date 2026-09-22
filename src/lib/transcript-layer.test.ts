import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contextKind,
  contextPreview,
  isImported,
  lectureText,
  planTranscribeWrite,
  recordingWouldDestroyImport,
  staleNotesMessage,
} from "./transcript-layer.ts";

const imported = { rawText: "Slide 1: Bayes' rule", modelUsed: "import:slides", contextText: null };
const recorded = { rawText: "so today we look at Bayes", modelUsed: "apple-speech+fluidaudio", contextText: null };

test("an import is recognised whatever it was imported from", () => {
  assert.equal(isImported("import"), true);
  assert.equal(isImported("import:slides"), true);
  assert.equal(isImported("import:subtitles"), true);
  assert.equal(isImported("apple-speech+fluidaudio"), false);
  assert.equal(isImported("small"), false);
  assert.equal(isImported(null), false);
  // A model whose name merely starts with those letters is not an import.
  assert.equal(isImported("importer-v2"), false);
});

test("recording onto imported text moves it into the context layer", () => {
  assert.deepEqual(planTranscribeWrite(imported), {
    cleanText: null,
    chapters: null,
    contextText: "Slide 1: Bayes' rule",
    contextSource: "import:slides",
  });
});

test("re-recording over a recording clears the stale cleanup but moves nothing", () => {
  // cleanText and chapters described the audio being replaced; leaving them
  // shows the old cleaned text beside the new recording's timestamps.
  assert.deepEqual(planTranscribeWrite(recorded), { cleanText: null, chapters: null });
});

test("a page with no transcript yet writes no context", () => {
  assert.deepEqual(planTranscribeWrite(null), { cleanText: null, chapters: null });
});

test("a re-record leaves an attached deck alone", () => {
  const withDeck = { ...recorded, contextText: "the deck" };
  assert.deepEqual(planTranscribeWrite(withDeck), { cleanText: null, chapters: null });
});

test("empty imported text is not worth keeping as a layer", () => {
  assert.deepEqual(planTranscribeWrite({ rawText: "   ", modelUsed: "import", contextText: null }), {
    cleanText: null,
    chapters: null,
  });
});

test("unmoved imported text under an attached deck refuses the recording", () => {
  // Both layers hold irreplaceable text: the import has nowhere left to move to.
  const already = { rawText: "spoken words", modelUsed: "import", contextText: "the deck" };
  assert.equal(recordingWouldDestroyImport(already), true);
});

test("a plain re-record over audio is allowed", () => {
  assert.equal(recordingWouldDestroyImport(recorded), false);
  assert.equal(recordingWouldDestroyImport({ ...recorded, contextText: "the deck" }), false);
});

test("a first recording on imported text with no context is allowed", () => {
  assert.equal(recordingWouldDestroyImport(imported), false);
  assert.equal(recordingWouldDestroyImport(null), false);
  // Empty imported text is nothing to lose.
  assert.equal(
    recordingWouldDestroyImport({ rawText: "  ", modelUsed: "import", contextText: "the deck" }),
    false
  );
});

test("the context layer is named from where it came", () => {
  assert.equal(contextKind("import:slides"), "slides");
  assert.equal(contextKind("import"), "reading");
  assert.equal(contextKind(null), "reading");
});

test("a context preview is one line, short enough to quote", () => {
  assert.equal(contextPreview("Slide 1: Bayes' rule\nSlide 2: priors"), "Slide 1: Bayes' rule");
  assert.equal(contextPreview(null), null);
  assert.equal(contextPreview("   \n  "), null);
  const long = contextPreview("x".repeat(200));
  assert.equal(long, `${"x".repeat(60)}…`);
});

test("both layers join under labels, and the cleaned transcript wins", () => {
  const text = lectureText({
    rawText: "so uh today, Bayes",
    cleanText: "Today: Bayes' rule.",
    contextText: "Slide 1: Bayes' rule",
    contextSource: "import:slides",
  });
  assert.equal(text, "SLIDES:\nSlide 1: Bayes' rule\n\nLECTURE TRANSCRIPT:\nToday: Bayes' rule.");
});

test("a reading is labelled as source text, not as slides", () => {
  const text = lectureText({
    rawText: "spoken",
    cleanText: null,
    contextText: "chapter three",
    contextSource: "import",
  });
  assert.equal(text, "SOURCE TEXT:\nchapter three\n\nLECTURE TRANSCRIPT:\nspoken");
});

test("one layer alone is returned unlabelled", () => {
  assert.equal(
    lectureText({ rawText: "spoken", cleanText: null, contextText: null, contextSource: null }),
    "spoken"
  );
  assert.equal(lectureText(null), "");
});

const older = { updatedAt: new Date("2026-09-20T10:00:00Z") };
const transcriptAt = (extra: { contextText?: string; contextSource?: string } = {}) => ({
  updatedAt: new Date("2026-09-20T11:00:00Z"),
  rawText: "spoken",
  cleanText: null,
  contextText: null,
  contextSource: null,
  ...extra,
});

test("with no context layer the message just says the notes are behind", () => {
  assert.equal(
    staleNotesMessage(older, transcriptAt(), true),
    "These notes were written before the current transcript."
  );
});

test("a context layer and no audio names the attached material", () => {
  assert.equal(
    staleNotesMessage(older, transcriptAt({ contextText: "Slide 1", contextSource: "import:slides" }), false),
    "These notes don't include the slides attached to this lecture."
  );
  assert.equal(
    staleNotesMessage(older, transcriptAt({ contextText: "chapter three", contextSource: "import" }), false),
    "These notes don't include the reading attached to this lecture."
  );
});

test("with both layers the message claims nothing about which one changed", () => {
  // Attaching a deck to a recorded lecture used to claim the recording was
  // missing from the notes, which was backwards.
  assert.equal(
    staleNotesMessage(older, transcriptAt({ contextText: "Slide 1", contextSource: "import:slides" }), true),
    "These notes were written before the current transcript."
  );
});

test("notes newer than the transcript are not stale", () => {
  assert.equal(
    staleNotesMessage(
      { updatedAt: new Date("2026-09-20T12:00:00Z") },
      transcriptAt({ contextText: "Slide 1", contextSource: "import:slides" }),
      true
    ),
    null
  );
});

test("a page with no notes has nothing to call stale", () => {
  assert.equal(staleNotesMessage(null, transcriptAt(), true), null);
});
