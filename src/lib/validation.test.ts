import { test } from "node:test";
import assert from "node:assert/strict";
import { createActionItemsSchema } from "./validation.ts";

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
