import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionKey } from "./review-keys.ts";

const free = { metaKey: false, ctrlKey: false, inField: false, onButton: false };

test("enter and space are commands when nothing has focus", () => {
  assert.deepEqual(sessionKey({ ...free, key: "Enter" }), { type: "enter" });
  assert.deepEqual(sessionKey({ ...free, key: " " }), { type: "space" });
});

test("digits are commands, other letters are not", () => {
  assert.deepEqual(sessionKey({ ...free, key: "3" }), { type: "digit", n: 3 });
  assert.equal(sessionKey({ ...free, key: "0" }), null);
  assert.equal(sessionKey({ ...free, key: "g" }), null);
});

test("typing into a field is text, not a command", () => {
  const inField = { ...free, inField: true };
  assert.equal(sessionKey({ ...inField, key: "Enter" }), null);
  assert.equal(sessionKey({ ...inField, key: " " }), null);
  assert.equal(sessionKey({ ...inField, key: "2" }), null);
});

test("a held key repeats nothing", () => {
  assert.equal(sessionKey({ ...free, key: "Enter", repeat: true }), null);
  assert.equal(sessionKey({ ...free, key: "3", repeat: true }), null);
});

test("cmd or ctrl plus enter submits from inside a field", () => {
  assert.deepEqual(sessionKey({ ...free, key: "Enter", inField: true, metaKey: true }), { type: "enter" });
  assert.deepEqual(sessionKey({ ...free, key: "Enter", inField: true, ctrlKey: true }), { type: "enter" });
});

test("a focused button keeps enter and space, digits still work", () => {
  const onButton = { ...free, onButton: true };
  assert.equal(sessionKey({ ...onButton, key: "Enter" }), null);
  assert.equal(sessionKey({ ...onButton, key: " " }), null);
  assert.deepEqual(sessionKey({ ...onButton, key: "4" }), { type: "digit", n: 4 });
});

test("modified digits are shortcuts for something else", () => {
  assert.equal(sessionKey({ ...free, key: "1", metaKey: true }), null);
});
