import { test } from "node:test";
import assert from "node:assert/strict";
import { pinnedFolderId, resolveFolderId } from "./mcp-scope.ts";

function withEnv(value: string | undefined, body: () => void) {
  const previous = process.env.LECTERN_FOLDER_ID;
  if (value === undefined) delete process.env.LECTERN_FOLDER_ID;
  else process.env.LECTERN_FOLDER_ID = value;
  try {
    body();
  } finally {
    if (previous === undefined) delete process.env.LECTERN_FOLDER_ID;
    else process.env.LECTERN_FOLDER_ID = previous;
  }
}

test("an unset env var means unpinned", () => {
  withEnv(undefined, () => assert.equal(pinnedFolderId(), null));
});

test("a set env var pins that course, trimmed", () => {
  withEnv("  folder-1  ", () => assert.equal(pinnedFolderId(), "folder-1"));
});

test("an empty env var is a misconfiguration, not unpinned mode", () => {
  // The dangerous reading: treat "" as unset and hand an unattended agent every
  // course. It must fail loudly instead.
  withEnv("   ", () => assert.throws(() => pinnedFolderId(), /set but empty/));
});

test("a pinned server ignores the caller's folderId", () => {
  assert.equal(resolveFolderId("folder-1", { folderId: "folder-2" }), "folder-1");
});

test("an unpinned server uses the caller's folderId", () => {
  assert.equal(resolveFolderId(null, { folderId: "folder-2" }), "folder-2");
});

test("an unpinned server with no folderId says how to find one", () => {
  assert.throws(() => resolveFolderId(null, {}), /list_courses/);
  assert.throws(() => resolveFolderId(null, { folderId: "  " }), /list_courses/);
});
