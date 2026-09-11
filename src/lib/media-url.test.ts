import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFetchableMediaUrl, MediaUrlError } from "./media-url.ts";

test("an ordinary lecture link is accepted", () => {
  const url = assertFetchableMediaUrl("https://www.youtube.com/watch?v=abc123");
  assert.equal(url.hostname, "www.youtube.com");
});

test("surrounding whitespace from a paste is tolerated", () => {
  assert.equal(assertFetchableMediaUrl("  https://example.com/lecture.mp4  ").protocol, "https:");
});

test("a file:// path cannot make the server read the disk", () => {
  assert.throws(() => assertFetchableMediaUrl("file:///etc/passwd"), MediaUrlError);
});

for (const host of [
  "http://localhost:3000/admin",
  "http://127.0.0.1/",
  "http://192.168.1.1/",
  "http://10.0.0.5/",
  "http://172.16.0.1/",
  "http://169.254.169.254/latest/meta-data/",
  "http://nas.local/",
]) {
  test(`a local or private address is refused: ${host}`, () => {
    assert.throws(() => assertFetchableMediaUrl(host), MediaUrlError);
  });
}

test("a public address that merely looks private-adjacent is still allowed", () => {
  assert.equal(assertFetchableMediaUrl("https://172.32.0.1/lecture").hostname, "172.32.0.1");
});

test("text that is not a URL is rejected with advice rather than a crash", () => {
  assert.throws(() => assertFetchableMediaUrl("lecture 3 recording"), MediaUrlError);
});
