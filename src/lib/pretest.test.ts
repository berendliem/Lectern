import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPretestUserPrompt } from "./prompts/pretest.ts";
import { pretestResponseSchema } from "./validation.ts";

test("the prompt is built from the topic and the syllabus", () => {
  const prompt = buildPretestUserPrompt({
    topicTitle: "Fourier transforms",
    syllabusText: "Week 3: Fourier transforms and the frequency domain.",
  });
  assert.match(prompt, /Fourier transforms/);
  assert.match(prompt, /Week 3/);
});

test("a pretest cannot see the lecture", () => {
  // The lecture has not been watched — that is what makes this a prediction.
  // The builder takes two fields and there is no third for a lecture to arrive
  // through, so a full call cannot produce the sections the other prompt
  // modules use to carry one.
  const prompt = buildPretestUserPrompt({
    topicTitle: "Fourier transforms",
    syllabusText: "Week 3: Fourier transforms.",
  });
  assert.equal(prompt.includes("LECTURE"), false);
  assert.equal(prompt.includes("TRANSCRIPT"), false);
  assert.equal(prompt.includes("NOTES"), false);
});

test("a pretest is exactly three questions with four options each", () => {
  const q = {
    prompt: "What does the transform map between?",
    options: ["a", "b", "c", "d"],
    correctIndex: 2,
    explanation: "because",
  };
  assert.equal(pretestResponseSchema.safeParse({ questions: [q, q, q] }).success, true);
  assert.equal(pretestResponseSchema.safeParse({ questions: [q, q] }).success, false);
  assert.equal(
    pretestResponseSchema.safeParse({ questions: [{ ...q, options: ["a", "b", "c"] }, q, q] }).success,
    false
  );
  assert.equal(
    pretestResponseSchema.safeParse({ questions: [{ ...q, correctIndex: 4 }, q, q] }).success,
    false
  );
});
