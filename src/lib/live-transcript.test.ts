import { test } from "node:test";
import assert from "node:assert/strict";
import { fixCards, transcriptLines, transcriptMarkdown, tutorName, type TranscriptTurn } from "./live-transcript.ts";

function turn(p: Partial<TranscriptTurn> & { id: string; order: number }): TranscriptTurn {
  return { speaker: null, question: "", answer: null, feedback: null, spoken: null, interruptedAt: null, retryOf: null, ...p };
}
const grade = (verdict: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ score: verdict === "right" ? 5 : 2, verdict, improvement: "imp", correction: "corr", example: "ex", ...extra });

const viva: TranscriptTurn[] = [
  turn({ id: "t0", order: 0, question: "What is entropy?", answer: "Disorder", feedback: grade("wrong", { transcriptSource: "browser" }), spoken: "Not quite. Try this: what happens to a gas?" }),
  turn({ id: "t1", order: 1, question: "Try this: what happens to a gas?", answer: "It spreads", feedback: grade("right"), spoken: "Yes. Next: what is heat?", interruptedAt: 4, retryOf: "t0" }),
  turn({ id: "t2", order: 2, question: "Next: what is heat?" }),
];

test("tutorName", () => {
  assert.equal(tutorName("VIVA"), "Tutor");
  assert.equal(tutorName("PROTEGE"), "Classmate");
});

test("viva lines: the first question, then answers and replies; a cut reply is truncated", () => {
  assert.deepEqual(transcriptLines(viva, "Tutor"), [
    { speaker: "Tutor", text: "What is entropy?", interrupted: false },
    { speaker: "You", text: "Disorder", interrupted: false, source: "browser" },
    { speaker: "Tutor", text: "Not quite. Try this: what happens to a gas?", interrupted: false },
    { speaker: "You", text: "It spreads", interrupted: false, source: undefined },
    { speaker: "Tutor", text: "Yes.", interrupted: true },
  ]);
});

test("a typed turn in a live session keeps its question line", () => {
  const lines = transcriptLines(
    [
      turn({ id: "a", order: 0, question: "Q1", answer: "A1", feedback: grade("right") }),
      turn({ id: "b", order: 1, question: "Q2" }),
    ],
    "Tutor"
  );
  assert.deepEqual(lines.map((l) => l.text), ["Q1", "A1", "Q2"]);
});

test("debate lines, with an unheard agent turn dropped", () => {
  const lines = transcriptLines(
    [
      turn({ id: "p", order: 0, speaker: "Proponent", question: "It holds." }),
      turn({ id: "s", order: 1, speaker: "Skeptic", question: "Not always, because of friction.", interruptedAt: 12 }),
      turn({ id: "y", order: 2, speaker: "You", question: "Interjection", answer: "Friction is heat." }),
      turn({ id: "q", order: 3, speaker: "Proponent", question: "Never heard.", interruptedAt: 0 }),
    ],
    "Tutor"
  );
  assert.deepEqual(lines, [
    { speaker: "Proponent", text: "It holds.", interrupted: false },
    { speaker: "Skeptic", text: "Not always,", interrupted: true },
    { speaker: "You", text: "Friction is heat.", interrupted: false },
  ]);
});

test("fix cards pair a miss with its retry", () => {
  assert.deepEqual(fixCards(viva), [
    { question: "What is entropy?", answer: "Disorder", correction: "corr", example: "ex", retry: { answer: "It spreads", verdict: "right" } },
  ]);
});

test("fix cards skip right answers and read typed-mode feedback", () => {
  const cards = fixCards([
    turn({ id: "a", order: 0, question: "Q1", answer: "A1", feedback: grade("right") }),
    turn({ id: "b", order: 1, question: "Q2", answer: "A2", feedback: JSON.stringify({ strengths: ["s"], improvements: ["do x"], score: 1, modelAnswer: "m" }) }),
  ]);
  assert.deepEqual(cards, [{ question: "Q2", answer: "A2", correction: "do x", example: "m", retry: null }]);
});

test("markdown export", () => {
  const md = transcriptMarkdown("Entropy viva", transcriptLines(viva, "Tutor"), fixCards(viva));
  assert.match(md, /^# Entropy viva\n/);
  assert.match(md, /\*\*You:\*\* Disorder _\(browser transcript\)_/);
  assert.match(md, /\*\*Tutor:\*\* Yes\. — \(you cut in\)/);
  assert.match(md, /### 1\. What is entropy\?/);
  assert.match(md, /- \*\*Retry:\*\* It spreads \(right\)/);
});

test("markdown export with nothing to fix", () => {
  assert.match(transcriptMarkdown("T", [], []), /Nothing to fix/);
});

test("markdown export escapes what the student and the tutor said", () => {
  const md = transcriptMarkdown(
    "T",
    [{ speaker: "You", text: "# see [link](http://x) *now* <b>_a_</b> \\ `c` !", interrupted: false }],
    [{ question: "# Q", answer: "a*b", correction: "[c]", example: "e_f", retry: null }]
  );
  assert.ok(md.includes("**You:** \\# see \\[link\\]\\(http://x\\) \\*now\\* \\<b\\>\\_a\\_\\</b\\> \\\\ \\`c\\` \\!"));
  assert.ok(md.includes("### 1. \\# Q"));
  assert.ok(md.includes("- **You said:** a\\*b"));
  assert.ok(md.includes("- **Correction:** \\[c\\]"));
  assert.ok(md.includes("- **Example:** e\\_f"));
});
