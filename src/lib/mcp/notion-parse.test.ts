import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCreatedPage } from "./notion-parse.ts";

const DASHED = "195de922-1179-449f-ab80-75a27c979105";
const FLAT = "195de9221179449fab8075a27c979105";

test("reads the id and url out of a JSON reply", () => {
  const out = parseCreatedPage(
    JSON.stringify({ pages: [{ id: DASHED, url: `https://www.notion.so/Lecture-${FLAT}` }] })
  );
  assert.equal(out.pageId, FLAT);
  assert.equal(out.url, `https://www.notion.so/Lecture-${FLAT}`);
});

test("reads the id out of a page URL in prose", () => {
  const out = parseCreatedPage(`Created page "Lecture 2" at https://www.notion.so/Lecture-2-${FLAT}`);
  assert.equal(out.pageId, FLAT);
  assert.equal(out.url, `https://www.notion.so/Lecture-2-${FLAT}`);
});

test("falls back to a bare id when there is no url", () => {
  assert.deepEqual(parseCreatedPage(`Created page ${DASHED}.`), { pageId: FLAT, url: null });
});

test("returns no id rather than a wrong one when the reply carries none", () => {
  // The caller turns this into an error naming what the server said; silently
  // storing a wrong id would break every later re-sync of that lecture.
  assert.deepEqual(parseCreatedPage("Sorry, something went wrong."), { pageId: null, url: null });
});
