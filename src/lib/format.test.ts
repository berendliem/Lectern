import { test } from "node:test";
import assert from "node:assert/strict";
import { shortDate } from "./format";

test("shortDate renders a date without throwing", () => {
  const out = shortDate(new Date("2026-01-15T12:00:00Z"));
  assert.equal(typeof out, "string");
  assert.ok(out.length > 0);
});
