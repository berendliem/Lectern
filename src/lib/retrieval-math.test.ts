import { test } from "node:test";
import assert from "node:assert/strict";
import { packContext, spread, scopeFilter } from "./retrieval-math.ts";

function hit(text: string, pageId: string | null = "p1", materialId: string | null = null) {
  return { text, title: "T", pageId, materialId };
}

test("packContext keeps hits in rank order until the budget is spent", () => {
  const kept = packContext([hit("a".repeat(30)), hit("b".repeat(30)), hit("c".repeat(30))], 10, 70);
  assert.equal(kept.length, 2);
  assert.ok(kept[0].text.startsWith("a"));
  assert.ok(kept[1].text.startsWith("b"));
});

test("packContext stops at maxHits even when the budget allows more", () => {
  const kept = packContext([hit("a"), hit("b"), hit("c")], 2, 10_000);
  assert.equal(kept.length, 2);
});

test("packContext returns one block when the first hit alone exceeds the budget", () => {
  const kept = packContext([hit("x".repeat(9_000)), hit("y")], 4, 5_000);
  assert.equal(kept.length, 1);
});

test("packContext returns an empty array for no hits", () => {
  assert.deepEqual(packContext([], 4, 5_000), []);
});

test("spread counts distinct sources, not chunks", () => {
  assert.equal(spread([hit("a", "p1"), hit("b", "p1"), hit("c", "p2")]), 2);
});

test("spread counts a material separately from a page", () => {
  assert.equal(spread([hit("a", "p1", null), hit("b", null, "m1")]), 2);
});

test("scopeFilter always carries the model filter", () => {
  const model = "local:Xenova/all-MiniLM-L6-v2";
  for (const scope of [
    { kind: "page", pageId: "p1" },
    { kind: "course", folderId: "f1" },
    { kind: "all", pageIds: ["p1"], folderIds: ["f1"] },
  ] as const) {
    assert.equal(scopeFilter(scope, model).model, model);
  }
});

test("scopeFilter for page scope filters on that page", () => {
  const where = scopeFilter({ kind: "page", pageId: "p1" }, "m");
  assert.equal(where.pageId, "p1");
});

test("scopeFilter for all scope matches the FTS pages and their folders' materials", () => {
  const where = scopeFilter({ kind: "all", pageIds: ["p1", "p2"], folderIds: ["f1"] }, "m");
  assert.deepEqual(where.OR, [
    { pageId: { in: ["p1", "p2"] } },
    { material: { folderId: { in: ["f1"] } } },
  ]);
});

test("scopeFilter for all scope with no FTS hits matches nothing rather than everything", () => {
  const where = scopeFilter({ kind: "all", pageIds: [], folderIds: [] }, "m");
  assert.deepEqual(where.OR, [{ pageId: { in: [] } }, { material: { folderId: { in: [] } } }]);
});
