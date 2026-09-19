import { test } from "node:test";
import assert from "node:assert/strict";
import { GRADE_MARKER } from "../live-text.ts";
import { buildLiveTurnUserPrompt, liveSystemPrompt, nextStep } from "./live.ts";
import { DEBATE_LIVE_SYSTEM_PROMPT, buildDebateUtterancePrompt } from "./debate.ts";
import { UNTRUSTED_CONTENT_CLAUSE } from "./shared.ts";

test("system prompts carry the grade format on the mode's scale, and the security clause", () => {
  const viva = liveSystemPrompt("VIVA");
  assert.ok(viva.includes(GRADE_MARKER));
  assert.match(viva, /integer 1-5/);
  assert.ok(viva.includes(UNTRUSTED_CONTENT_CLAUSE));
  assert.match(liveSystemPrompt("PROTEGE"), /0 to 100/);
});

test("a first attempt asks for a variant when missed", () => {
  const step = nextStep({ mode: "VIVA", answeringRetry: false, lastQuestion: false });
  assert.match(step, /variant/);
  assert.match(step, /new question/);
});

test("a retry never asks another variant", () => {
  const step = nextStep({ mode: "VIVA", answeringRetry: true, lastQuestion: false });
  assert.match(step, /Do not ask another variant/);
});

test("the last question closes when right", () => {
  assert.match(nextStep({ mode: "VIVA", answeringRetry: false, lastQuestion: true }), /close the session/);
  assert.match(nextStep({ mode: "PROTEGE", answeringRetry: true, lastQuestion: true }), /close the session/);
});

test("the protege pushes back instead of correcting outright", () => {
  assert.match(nextStep({ mode: "PROTEGE", answeringRetry: false, lastQuestion: false }), /push back/);
  assert.match(nextStep({ mode: "PROTEGE", answeringRetry: true, lastQuestion: false }), /looked it up/);
});

test("the turn prompt carries the answer, grounding and history", () => {
  const prompt = buildLiveTurnUserPrompt({
    mode: "VIVA",
    context: { title: "Thermo", source: "TOPIC", topicText: "Entropy" },
    history: [{ question: "Q0", answer: "A0" }],
    question: "What is entropy?",
    answer: "It is disorder",
    answeringRetry: false,
    lastQuestion: false,
    grounding: [{ title: "Lecture 3", text: "Entropy measures microstates." }],
  });
  assert.match(prompt, /It is disorder/);
  assert.match(prompt, /Lecture 3/);
  assert.match(prompt, /Q1: Q0/);
  assert.ok(prompt.includes(GRADE_MARKER));
});

test("live debate prompt: a wrong interjection is corrected, with no JSON", () => {
  const prompt = buildDebateUtterancePrompt({
    speaker: "Skeptic",
    concept: "Energy is conserved",
    persona: null,
    grounding: [],
    turns: [{ order: 0, speaker: "You", answer: "Energy can be created" }],
    texts: new Map([[0, "Energy can be created"]]),
    pending: { order: 0, speaker: "You", answer: "Energy can be created" },
    live: { pendingGrade: { verdict: "wrong", correction: "Energy is never created" } },
  });
  assert.match(prompt, /Correct them/);
  assert.match(prompt, /Energy is never created/);
  assert.doesNotMatch(prompt, /required JSON/);
  assert.doesNotMatch(DEBATE_LIVE_SYSTEM_PROMPT, /JSON/);
});

test("live debate prompt: a right interjection is conceded", () => {
  const prompt = buildDebateUtterancePrompt({
    speaker: "Proponent",
    concept: "c",
    persona: null,
    grounding: [],
    turns: [],
    texts: new Map(),
    pending: { order: 0, speaker: "You", answer: "good point" },
    live: { pendingGrade: { verdict: "right", correction: "" } },
  });
  assert.match(prompt, /Concede/);
});

test("typed debate prompt is unchanged", () => {
  const prompt = buildDebateUtterancePrompt({
    speaker: "Proponent",
    concept: "c",
    persona: null,
    grounding: [],
    turns: [],
    texts: new Map(),
    pending: null,
  });
  assert.match(prompt, /Return the required JSON/);
});
