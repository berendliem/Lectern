import { test } from "node:test";
import assert from "node:assert/strict";
import { createActionItemsSchema, learnMoreResponseSchema, quizResponseSchema } from "./validation.ts";

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
