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
  // Named
  "http://localhost:3000/admin",
  "http://nas.local/",
  "http://wiki.internal/",
  "http://printer.home.arpa/",
  // Plain IPv4
  "http://127.0.0.1/",
  "http://192.168.1.1/",
  "http://10.0.0.5/",
  "http://172.16.0.1/",
  "http://172.31.255.255/",
  "http://100.64.0.1/",
  "http://0.0.0.0/",
  "http://169.254.169.254/latest/meta-data/",
  // IPv4 in disguise — the URL parser normalizes these back to dotted decimal
  "http://2130706433/",
  "http://017700000001/",
  "http://0/",
  // IPv6, including the IPv4-mapped forms that read as public as plain text
  "http://[::1]/",
  "http://[fe80::1]/",
  "http://[fd00::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:10.0.0.1]/",
  "http://[::ffff:192.168.1.1]/",
  "http://[::ffff:169.254.169.254]/latest/meta-data/",
  "http://[64:ff9b::127.0.0.1]/",
]) {
  test(`a local or private address is refused: ${host}`, () => {
    assert.throws(() => assertFetchableMediaUrl(host), MediaUrlError);
  });
}

for (const host of [
  "https://172.32.0.1/lecture",
  "https://8.8.8.8/lecture",
  "https://99.63.255.1/lecture",
  "https://[2001:4860:4860::8888]/lecture",
  "https://[::ffff:8.8.8.8]/lecture",
]) {
  test(`a public address is still allowed: ${host}`, () => {
    assert.doesNotThrow(() => assertFetchableMediaUrl(host));
  });
}

test("text that is not a URL is rejected with advice rather than a crash", () => {
  assert.throws(() => assertFetchableMediaUrl("lecture 3 recording"), MediaUrlError);
});
