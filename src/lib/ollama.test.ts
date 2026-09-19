// src/lib/ollama.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createThinkStripper, ollamaDelta } from "./ollama.ts";

test("ollamaDelta reads message content", () => {
  assert.equal(ollamaDelta({ message: { content: "Hi" }, done: false }), "Hi");
  assert.equal(ollamaDelta({ done: true }), "");
});

test("ollamaDelta throws on an error event", () => {
  assert.throws(() => ollamaDelta({ error: "model not found" }), /model not found/);
});

test("think stripper passes plain text straight through", () => {
  const s = createThinkStripper();
  assert.equal(s.push("Hello"), "Hello");
  assert.equal(s.push(" there"), " there");
});

test("think stripper drops a leading think block split across chunks", () => {
  const s = createThinkStripper();
  assert.equal(s.push("<th"), "");
  assert.equal(s.push("ink>hmm, let me"), "");
  assert.equal(s.push(" see</think>  Hello"), "Hello");
  assert.equal(s.push(" world"), " world");
});

test("think stripper does not swallow other tags", () => {
  const s = createThinkStripper();
  assert.equal(s.push("<b>bold"), "<b>bold");
});
