import { test } from "node:test";
import assert from "node:assert/strict";
import { toolResultJson, toolResultText } from "./tool-json.ts";

test("joins text blocks and ignores non-text ones", () => {
  const text = toolResultText({
    content: [{ type: "text", text: "a" }, { type: "image", data: "…" }, { type: "text", text: "b" }],
  });
  assert.equal(text, "a\nb");
});

test("unwraps FastMCP's { result } envelope around a list", () => {
  // A list[dict] tool: one text block per element, which joined is not JSON.
  // The structured form is the only faithful one.
  const out = toolResultJson({
    content: [{ type: "text", text: '{"a":1}' }, { type: "text", text: '{"a":2}' }],
    structuredContent: { result: [{ a: 1 }, { a: 2 }] },
  });
  assert.deepEqual(out, [{ a: 1 }, { a: 2 }]);
});

test("an empty list has no text blocks at all", () => {
  assert.deepEqual(toolResultJson({ content: [], structuredContent: { result: [] } }), []);
});

test("returns a structured object as is when it is not the envelope", () => {
  const out = toolResultJson({ content: [], structuredContent: { topic_id: 1, result: "x" } });
  assert.deepEqual(out, { topic_id: 1, result: "x" });
});

test("falls back to parsing the text when nothing is structured", () => {
  // A `-> dict` FastMCP tool sends one JSON text block and no structuredContent.
  assert.deepEqual(toolResultJson({ content: [{ type: "text", text: '{"topic_id":1}' }] }), { topic_id: 1 });
});

test("says what it got when the text is not JSON", () => {
  assert.throws(
    () => toolResultJson({ content: [{ type: "text", text: "Sorry, something went wrong." }] }),
    /not JSON.*Sorry, something went wrong/
  );
});
