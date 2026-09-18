import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createActionItemsSchema,
  importOnqTopicSchema,
  learnMoreResponseSchema,
  quizResponseSchema,
  updateFlashcardSchema,
  updateFolderSchema,
} from "./validation.ts";

test("a well-formed batch of action items parses", async () => {
  const parsed = await createActionItemsSchema.parseAsync({
    items: [{ kind: "ACTION", text: "Re-read the Bayes lecture notes" }],
  });
  assert.equal(parsed.items[0].kind, "ACTION");
});

test("an unknown kind is rejected", async () => {
  await assert.rejects(() =>
    createActionItemsSchema.parseAsync({ items: [{ kind: "REMINDER", text: "nope" }] })
  );
});

test("an empty batch is rejected, so a no-op write cannot look like a success", async () => {
  await assert.rejects(() => createActionItemsSchema.parseAsync({ items: [] }));
});

test("an oversized batch is rejected", async () => {
  const items = Array.from({ length: 51 }, () => ({ kind: "ACTION" as const, text: "x" }));
  await assert.rejects(() => createActionItemsSchema.parseAsync({ items }));
});

test("a math question is accepted", () => {
  const parsed = quizResponseSchema.parse({
    questions: [
      {
        type: "MATH",
        prompt: "What is $\\det(A)$ for $A = \\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}$?",
        correctAnswer: "-2",
        explanation: "1*4 - 2*3",
      },
    ],
  });
  assert.equal(parsed.questions[0].type, "MATH");
});

test("a math question with no answer is rejected", () => {
  assert.throws(() =>
    quizResponseSchema.parse({ questions: [{ type: "MATH", prompt: "p", correctAnswer: "" }] })
  );
});

test("an unknown question type is still rejected", () => {
  assert.throws(() =>
    quizResponseSchema.parse({ questions: [{ type: "PROOF", prompt: "p", correctAnswer: "a" }] })
  );
});

test("a well-formed learn-more response parses", async () => {
  const parsed = await learnMoreResponseSchema.parseAsync({
    items: [
      {
        concept: "Conjugate priors",
        why: "Explains why the lecture's beta-binomial update stayed in closed form.",
        nextStep: "Search: conjugate prior beta binomial",
      },
    ],
  });
  assert.equal(parsed.items[0].concept, "Conjugate priors");
});

// The model writing prose into a field it should have skipped is the likeliest
// malformation; an empty suggestion is the one that would render a blank card.
test("an item missing a field is rejected", async () => {
  await assert.rejects(() =>
    learnMoreResponseSchema.parseAsync({ items: [{ concept: "Priors", why: "Because." }] })
  );
});

test("an empty item list is rejected, so an empty tab cannot look like a success", async () => {
  await assert.rejects(() => learnMoreResponseSchema.parseAsync({ items: [] }));
});

test("a flashcard edit trims both sides and refuses an empty one", async () => {
  const parsed = await updateFlashcardSchema.parseAsync({
    prompt: "  What is entropy?  ",
    idealExplanation: "A measure of disorder.",
  });
  assert.equal(parsed.prompt, "What is entropy?");
  await assert.rejects(() => updateFlashcardSchema.parseAsync({ prompt: "   ", idealExplanation: "x" }));
});

test("a folder can be linked to and unlinked from an onQ course", async () => {
  assert.deepEqual(await updateFolderSchema.parseAsync({ onqCourseId: 1180369 }), { onqCourseId: 1180369 });
  assert.deepEqual(await updateFolderSchema.parseAsync({ onqCourseId: null }), { onqCourseId: null });
  await assert.rejects(updateFolderSchema.parseAsync({ onqCourseId: "1180369" }));
  await assert.rejects(updateFolderSchema.parseAsync({ onqCourseId: 1.5 }));
  await assert.rejects(updateFolderSchema.parseAsync({ onqCourseId: 2 ** 40 }));
});

test("an onQ import names one topic by integer id", async () => {
  assert.deepEqual(await importOnqTopicSchema.parseAsync({ topicId: 7, moduleTitle: " Unit 1 " }), {
    topicId: 7,
    moduleTitle: "Unit 1",
  });
  assert.deepEqual(await importOnqTopicSchema.parseAsync({ topicId: 7 }), { topicId: 7, moduleTitle: "" });
  await assert.rejects(importOnqTopicSchema.parseAsync({ topicId: "7" }));
  await assert.rejects(importOnqTopicSchema.parseAsync({ topicId: -1 }));
  await assert.rejects(importOnqTopicSchema.parseAsync({ topicId: 2 ** 40 }));
  await assert.rejects(importOnqTopicSchema.parseAsync({ topicId: 7, moduleTitle: "x".repeat(301) }));
});
