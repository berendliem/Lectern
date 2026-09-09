import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TEXT_CHARS, lecternBaseUrl, lecternFetch, truncate } from "./lectern-api.ts";

test("text at the cap is returned untouched", () => {
  const text = "x".repeat(MAX_TEXT_CHARS);
  assert.equal(truncate(text), text);
});

test("text over the cap is cut and says how much is missing", () => {
  const out = truncate("x".repeat(MAX_TEXT_CHARS + 500));
  assert.ok(out.startsWith("x".repeat(100)));
  assert.match(out, /500 more characters/);
});

test("the base URL is overridable, because this worktree runs on 3100", () => {
  const previous = process.env.LECTERN_BASE_URL;
  process.env.LECTERN_BASE_URL = "http://127.0.0.1:3100";
  assert.equal(lecternBaseUrl(), "http://127.0.0.1:3100");
  if (previous === undefined) delete process.env.LECTERN_BASE_URL;
  else process.env.LECTERN_BASE_URL = previous;
});

test("a route's own error message is what the caller sees", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Page not found" }), { status: 404 });
  try {
    await assert.rejects(() => lecternFetch("/api/pages/nope"), /Page not found/);
  } finally {
    globalThis.fetch = original;
  }
});

test("an unreachable app says the app is unreachable, not 'fetch failed'", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  try {
    await assert.rejects(() => lecternFetch("/api/folders"), /is not reachable/);
  } finally {
    globalThis.fetch = original;
  }
});
