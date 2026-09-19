import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_LIVE_STATE,
  createVad,
  heardAnswer,
  isEndCommand,
  liveGradeSchema,
  liveReducer,
  nextTurnKind,
  questionsAnswered,
  readLiveFeedback,
  sensitivityToThreshold,
  toLiveFeedback,
  verdictFromScore,
  type LiveState,
} from "./live-interview.ts";

test("liveGradeSchema scores on the mode's scale", () => {
  const viva = liveGradeSchema("VIVA");
  assert.equal(viva.safeParse({ score: 4, verdict: "right" }).success, true);
  assert.equal(viva.safeParse({ score: 40, verdict: "right" }).success, false);
  const protege = liveGradeSchema("PROTEGE");
  assert.equal(protege.safeParse({ score: 40, verdict: "partial" }).success, true);
  assert.equal(protege.safeParse({ score: 4, verdict: "maybe" }).success, false);
});

test("liveGradeSchema fills defaults", () => {
  const parsed = liveGradeSchema("VIVA").parse({ score: 2, verdict: "wrong" });
  assert.deepEqual(parsed, { score: 2, verdict: "wrong", improvement: "", correction: "", example: "", nextQuestion: null });
});

test("verdictFromScore", () => {
  assert.equal(verdictFromScore("INTERVIEWER", 5), "right");
  assert.equal(verdictFromScore("INTERVIEWER", 3), "partial");
  assert.equal(verdictFromScore("INTERVIEWER", 2), "wrong");
  assert.equal(verdictFromScore("FEYNMAN", 80), "right");
  assert.equal(verdictFromScore("FEYNMAN", 60), "partial");
  assert.equal(verdictFromScore("FEYNMAN", 20), "wrong");
});

test("toLiveFeedback maps the interviewer grader", () => {
  assert.deepEqual(
    toLiveFeedback({ strengths: ["a"], improvements: ["fix x"], score: 2, modelAnswer: "model" }),
    { score: 2, verdict: "wrong", improvement: "fix x", correction: "fix x", example: "model" }
  );
});

test("toLiveFeedback maps the Feynman grader", () => {
  assert.deepEqual(
    toLiveFeedback({ score: 55, verdict: "ok", strengths: [], gaps: ["gap"], jargon: [], followUp: "" }),
    { score: 55, verdict: "partial", improvement: "gap", correction: "gap", example: "" }
  );
});

test("readLiveFeedback reads every stored shape", () => {
  const live = { score: 3, verdict: "partial", improvement: "i", correction: "c", example: "e" };
  assert.deepEqual(readLiveFeedback(JSON.stringify(live)), live);
  assert.equal(readLiveFeedback(JSON.stringify({ strengths: ["s"], improvements: ["i"], score: 5, modelAnswer: "m" }))?.verdict, "right");
  assert.equal(readLiveFeedback(JSON.stringify({ score: 10, verdict: "weak", gaps: ["g"] }))?.verdict, "wrong");
  assert.equal(readLiveFeedback(null), null);
  assert.equal(readLiveFeedback("not json"), null);
  assert.equal(readLiveFeedback("{}"), null);
});

test("one retry per missed question", () => {
  assert.equal(nextTurnKind("wrong", false), "retry");
  assert.equal(nextTurnKind("partial", false), "retry");
  assert.equal(nextTurnKind("right", false), "new");
  assert.equal(nextTurnKind("wrong", true), "new");
});

test("retries do not count toward the question limit", () => {
  assert.equal(
    questionsAnswered([
      { answer: "a", retryOf: null },
      { answer: "b", retryOf: "t1" },
      { answer: null, retryOf: null },
      { answer: "c", retryOf: null },
    ]),
    2
  );
});

test("sensitivityToThreshold is clamped and inverse", () => {
  assert.ok(sensitivityToThreshold(1) < sensitivityToThreshold(0));
  assert.equal(sensitivityToThreshold(5), sensitivityToThreshold(1));
  assert.equal(sensitivityToThreshold(-1), sensitivityToThreshold(0));
});

test("vad: speech starts only after the onset holds", () => {
  const vad = createVad({ threshold: 0.1, silenceMs: 1000 });
  assert.equal(vad.step(0.5, 0, 300), "rise");
  assert.equal(vad.step(0.5, 200, 300), null);
  assert.equal(vad.step(0.5, 300, 300), "start");
  assert.equal(vad.step(0.5, 400, 300), null);
});

test("vad: a blip shorter than the onset is ignored", () => {
  const vad = createVad({ threshold: 0.1, silenceMs: 1000 });
  vad.step(0.5, 0, 300);
  vad.step(0.0, 100, 300);
  // A fresh rise, not a start: the blip's time doesn't count toward the onset.
  assert.equal(vad.step(0.5, 350, 300), "rise");
});

test("vad: silence ends speech, a short pause does not", () => {
  const vad = createVad({ threshold: 0.1, silenceMs: 1000 });
  vad.step(0.5, 0, 0);
  assert.equal(vad.step(0.0, 100, 0), null);
  assert.equal(vad.step(0.5, 600, 0), null);
  assert.equal(vad.step(0.0, 700, 0), null);
  assert.equal(vad.step(0.0, 1700, 0), "end");
});

test("vad: setThreshold and reset", () => {
  const vad = createVad({ threshold: 0.1, silenceMs: 1000 });
  vad.setThreshold(0.9);
  assert.equal(vad.step(0.5, 0, 0), null);
  vad.setThreshold(0.1);
  assert.equal(vad.step(0.5, 10, 0), "start");
  vad.reset();
  assert.equal(vad.step(0.5, 20, 0), "start");
});

const at = (phase: LiveState["phase"]): LiveState => ({ phase, error: null });

test("reducer: the viva loop", () => {
  let s = liveReducer(INITIAL_LIVE_STATE, { type: "start" });
  assert.equal(s.phase, "speaking");
  s = liveReducer(s, { type: "replyDone", completed: false });
  assert.equal(s.phase, "listening");
  s = liveReducer(s, { type: "speechEnd" });
  assert.equal(s.phase, "transcribing");
  s = liveReducer(s, { type: "transcribed" });
  assert.equal(s.phase, "thinking");
  s = liveReducer(s, { type: "replyStarted" });
  assert.equal(s.phase, "speaking");
  s = liveReducer(s, { type: "replyDone", completed: true });
  assert.equal(s.phase, "done");
});

test("reducer: barge-in, empty transcript, advance", () => {
  assert.equal(liveReducer(at("speaking"), { type: "bargeIn" }).phase, "listening");
  assert.equal(liveReducer(at("transcribing"), { type: "empty" }).phase, "speaking");
  assert.equal(liveReducer(at("listening"), { type: "advance" }).phase, "thinking");
  assert.equal(liveReducer(INITIAL_LIVE_STATE, { type: "advance" }).phase, "thinking");
});

test("reducer: failure and retry", () => {
  const failed = liveReducer(at("thinking"), { type: "failed", message: "boom" });
  assert.deepEqual(failed, { phase: "error", error: "boom" });
  assert.deepEqual(liveReducer(failed, { type: "retry" }), { phase: "thinking", error: null });
  assert.equal(liveReducer(at("transcribing"), { type: "failed", message: "x" }).phase, "error");
  assert.equal(liveReducer(at("speaking"), { type: "failed", message: "x" }).phase, "error");
  // A reply can still fail after the student's barge-in already moved the phase to listening.
  assert.equal(liveReducer(at("listening"), { type: "failed", message: "x" }).phase, "error");
});

test("reducer: end from anywhere, and ignored actions keep the state", () => {
  assert.equal(liveReducer(at("listening"), { type: "end" }).phase, "done");
  const s = at("listening");
  assert.equal(liveReducer(s, { type: "bargeIn" }), s);
  assert.equal(liveReducer(at("done"), { type: "start" }).phase, "done");
});

test("heardAnswer prefers the local transcript, then the browser preview", () => {
  assert.deepEqual(heardAnswer(" Entropy rises ", "entropy rise"), { text: "Entropy rises", source: "whisper" });
  assert.deepEqual(heardAnswer("", "entropy rises"), { text: "entropy rises", source: "browser" });
  assert.deepEqual(heardAnswer(null, "  "), null);
});

test("isEndCommand", () => {
  assert.equal(isEndCommand("End session."), true);
  assert.equal(isEndCommand("please stop the interview"), true);
  assert.equal(isEndCommand("finish debate"), true);
  assert.equal(isEndCommand("The session ends when entropy peaks"), false);
});

test("vad: a rise is reported at once, and a drop when it dies before the onset", () => {
  const vad = createVad({ threshold: 0.1, silenceMs: 1000 });
  assert.equal(vad.step(0.5, 0, 300), "rise");
  assert.equal(vad.step(0.5, 100, 300), null);
  assert.equal(vad.step(0.0, 150, 300), "drop");
  assert.equal(vad.step(0.0, 200, 300), null);
  assert.equal(vad.step(0.5, 250, 300), "rise");
  assert.equal(vad.step(0.5, 550, 300), "start");
  // Neither while already speaking.
  assert.equal(vad.step(0.0, 600, 300), null);
  assert.equal(vad.step(0.5, 700, 300), null);
});

test("readLiveFeedback fills a live grade's missing text fields", () => {
  const read = readLiveFeedback(JSON.stringify({ score: 2, verdict: "wrong", correction: "c", improvement: 7 }));
  assert.equal(read?.improvement, "");
  assert.equal(read?.example, "");
  assert.equal(read?.correction, "c");
});
