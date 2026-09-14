import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMissesQuizUserPrompt } from "./prompts/quiz.ts";
import { quizResponseSchema } from "./validation.ts";

test("every missed question reaches the prompt with its correct answer", () => {
  const out = buildMissesQuizUserPrompt("## Notes\n- ATP is made in the mitochondrion.", [
    { prompt: "Where is ATP produced?", correctAnswer: "the mitochondrion" },
    { prompt: "What does glycolysis yield?", correctAnswer: "pyruvate" },
  ]);

  assert.match(out, /Where is ATP produced\?/);
  assert.match(out, /the mitochondrion/);
  assert.match(out, /What does glycolysis yield\?/);
  assert.match(out, /pyruvate/);
  assert.match(out, /ATP is made in the mitochondrion/);
});

test("the prompt tells the model not to re-ask the missed questions verbatim", () => {
  const out = buildMissesQuizUserPrompt("notes", [{ prompt: "q", correctAnswer: "a" }]);
  assert.match(out, /Do not repeat any missed question as written/);
});

test("a cloze question with a marked gap parses", () => {
  const parsed = quizResponseSchema.parse({
    questions: [
      { type: "CLOZE", prompt: "ATP is produced in the {{mitochondrion}}.", correctAnswer: "mitochondrion" },
    ],
  });
  assert.equal(parsed.questions[0].type, "CLOZE");
});

test("a cloze question with no gap is rejected rather than shown as a blankless blank", () => {
  assert.throws(() =>
    quizResponseSchema.parse({
      questions: [{ type: "CLOZE", prompt: "ATP is produced in the mitochondrion.", correctAnswer: "mitochondrion" }],
    })
  );
});

test("the existing question types still parse", () => {
  const parsed = quizResponseSchema.parse({
    questions: [
      { type: "SHORT_ANSWER", prompt: "Where is ATP made?", correctAnswer: "the mitochondrion" },
      {
        type: "MULTIPLE_CHOICE",
        prompt: "Where?",
        correctAnswer: "Mitochondrion",
        options: ["Mitochondrion", "Nucleus"],
      },
    ],
  });
  assert.equal(parsed.questions.length, 2);
});
