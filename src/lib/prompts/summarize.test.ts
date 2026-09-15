import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLIDES_SUMMARIZE_SYSTEM_PROMPT,
  SLIDES_TRANSCRIPT_SOURCE,
  SUMMARIZE_SYSTEM_PROMPT,
  summarizePromptsFor,
} from "./summarize.ts";
import { createPageFromTextSchema } from "../validation.ts";

test("the slides source the import route accepts is the one summarize recognizes", async () => {
  const { source } = await createPageFromTextSchema.parseAsync({
    title: "Week 3",
    text: "Slide 1: Demand",
    source: "slides",
  });
  // The from-text route stores `import:${source}` in Transcript.modelUsed.
  assert.equal(`import:${source}`, SLIDES_TRANSCRIPT_SOURCE);
});

test("a page made from slides gets the slides prompt", () => {
  assert.equal(summarizePromptsFor("import:slides").systemPrompt, SLIDES_SUMMARIZE_SYSTEM_PROMPT);
});

test("a long deck's final pass is still told its notes came from slides", () => {
  assert.match(summarizePromptsFor("import:slides").buildReduceUserPrompt("- a point"), /slides/);
  assert.doesNotMatch(summarizePromptsFor(null).buildReduceUserPrompt("- a point"), /slides/);
});

test("recordings and other imports keep the transcript prompt, which adds nothing", () => {
  for (const modelUsed of [null, "import", "import:subtitles", "whisper-1"]) {
    assert.equal(summarizePromptsFor(modelUsed).systemPrompt, SUMMARIZE_SYSTEM_PROMPT);
  }
});
