import { test } from "node:test";
import assert from "node:assert/strict";
import { modelField, webPluginField } from "./openrouter.ts";

test("the free default is sent as a chat-model chain, not the router", () => {
  const field = modelField("openrouter/free");
  assert.ok("models" in field && field.models.length > 0);
  assert.ok(!("model" in field));
  assert.ok(!(field as { models: string[] }).models.some((m) => m.includes("safety")));
  // The chain is the free tier's; a paid model here would bill the student.
  assert.ok((field as { models: string[] }).models.every((m) => m.endsWith(":free")));
});

test("an explicitly named model is sent untouched", () => {
  assert.deepEqual(modelField("nvidia/nemotron-3-super-120b-a12b:free"), {
    model: "nvidia/nemotron-3-super-120b-a12b:free",
  });
});

test("web search is a plugin field only when the toggle is on", () => {
  assert.deepEqual(webPluginField(true), { plugins: [{ id: "web" }] });
  assert.deepEqual(webPluginField(false), {});
  assert.deepEqual(webPluginField(undefined), {});
});
