import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalRequest } from "./local-request.ts";

test("accepts the loopback hosts, with or without a port", () => {
  assert.equal(isLocalRequest("localhost:3100", null), true);
  assert.equal(isLocalRequest("127.0.0.1:3107", null), true);
  assert.equal(isLocalRequest("[::1]:3000", null), true);
  assert.equal(isLocalRequest("localhost", null), true);
});

test("rejects any other host, including a missing one", () => {
  assert.equal(isLocalRequest("192.168.1.5:3100", null), false);
  assert.equal(isLocalRequest("evil.example", null), false);
  assert.equal(isLocalRequest("localhost.evil.example", null), false);
  assert.equal(isLocalRequest(null, null), false);
});

test("a cross-site browser request is rejected even when it names localhost", () => {
  assert.equal(isLocalRequest("localhost", "cross-site"), false);
  assert.equal(isLocalRequest("localhost", "same-origin"), true);
  assert.equal(isLocalRequest("localhost", "none"), true);
});
