import { test } from "node:test";
import assert from "node:assert/strict";
import { createActionItemsSchema, learnMoreResponseSchema } from "./validation.ts";

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
