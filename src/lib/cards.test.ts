import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSingleParent, cardSource, courseScopeFilter } from "./cards.ts";

test("assertSingleParent accepts a lecture-parented card", () => {
  assert.deepEqual(assertSingleParent({ pageId: "p1" }), { pageId: "p1", materialId: null });
});

test("assertSingleParent accepts a material-parented card", () => {
  assert.deepEqual(assertSingleParent({ materialId: "m1" }), { pageId: null, materialId: "m1" });
});

test("assertSingleParent rejects a card with no parent", () => {
  assert.throws(() => assertSingleParent({}), /exactly one/i);
  assert.throws(() => assertSingleParent({ pageId: null, materialId: null }), /exactly one/i);
});

test("assertSingleParent rejects a card parented to both", () => {
  assert.throws(() => assertSingleParent({ pageId: "p1", materialId: "m1" }), /exactly one/i);
});

test("courseScopeFilter matches cards through either relation", () => {
  assert.deepEqual(courseScopeFilter("f1"), {
    OR: [{ page: { folderId: "f1" } }, { material: { folderId: "f1" } }],
  });
});

test("cardSource describes a lecture-parented card", () => {
  const out = cardSource({ page: { id: "p1", title: "Photosynthesis" }, material: null });
  assert.deepEqual(out, { kind: "lecture", id: "p1", title: "Photosynthesis" });
});

test("cardSource describes a material-parented card", () => {
  const out = cardSource({ page: null, material: { id: "m1", title: "Week 2 slides" } });
  assert.deepEqual(out, { kind: "material", id: "m1", title: "Week 2 slides" });
});

test("cardSource returns null when a card has lost its parent", () => {
  assert.equal(cardSource({ page: null, material: null }), null);
});
