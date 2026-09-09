import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentLine } from "./stream.ts";

test("a tool call becomes a tool event under its bare name", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "mcp__lectern__topic_coverage", input: {} }] },
  });
  assert.deepEqual(parseAgentLine(line), { type: "tool", name: "topic_coverage" });
});

test("assistant text becomes a text event", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "Looking at week 3." }] },
  });
  assert.deepEqual(parseAgentLine(line), { type: "text", text: "Looking at week 3." });
});

test("the final result carries the plan", () => {
  const line = JSON.stringify({ type: "result", subtype: "success", result: "# Your week", is_error: false });
  assert.deepEqual(parseAgentLine(line), { type: "result", text: "# Your week", isError: false });
});

test("an errored result is flagged, not dropped", () => {
  const line = JSON.stringify({ type: "result", subtype: "error_during_execution", result: "ran out", is_error: true });
  assert.deepEqual(parseAgentLine(line), { type: "result", text: "ran out", isError: true });
});

test("lines this UI has no use for are ignored, not thrown on", () => {
  // The CLI's event vocabulary is larger than what the panel renders, and it
  // grows between versions — an unknown line must never kill a run.
  assert.equal(parseAgentLine(JSON.stringify({ type: "system", subtype: "init" })), null);
  assert.equal(parseAgentLine(JSON.stringify({ type: "user", message: { content: [] } })), null);
  assert.equal(parseAgentLine("not json at all"), null);
  assert.equal(parseAgentLine(""), null);
});
