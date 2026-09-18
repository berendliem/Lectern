import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runStudyPlan } from "./study-plan.ts";

/** A stand-in for the CLI: a node script that prints stream-json lines. */
async function fakeClaude(body: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lectern-fake-claude-"));
  const file = path.join(dir, "fake-claude.mjs");
  await writeFile(file, body);
  return file;
}

async function collect(script: string) {
  const previousBin = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = process.execPath;
  process.env.AGENT_FAKE_SCRIPT = script;
  try {
    const events = [];
    for await (const event of runStudyPlan({ folderId: "f1", courseName: "Stats", topics: ["Bayes"] })) {
      events.push(event);
    }
    return events;
  } finally {
    delete process.env.AGENT_FAKE_SCRIPT;
    if (previousBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = previousBin;
  }
}

test("events stream out in order and the plan arrives as the result", async () => {
  const script = await fakeClaude(`
    console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__lectern__list_lectures" }] } }));
    console.log(JSON.stringify({ type: "result", subtype: "success", result: "# Your week", is_error: false }));
  `);
  const events = await collect(script);
  assert.deepEqual(events[0], { type: "tool", name: "list_lectures" });
  assert.deepEqual(events.at(-1), { type: "result", text: "# Your week", isError: false });
});

test("a crash with no result event is an error, not a silent empty plan", async () => {
  const script = await fakeClaude(`process.stderr.write("boom\\n"); process.exit(2);`);
  await assert.rejects(() => collect(script), /boom|without producing a plan/);
});

test("a missing claude binary says how to fix it", async () => {
  const previous = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = "/nonexistent/claude";
  try {
    await assert.rejects(async () => {
      for await (const _event of runStudyPlan({ folderId: "f1", courseName: "Stats", topics: [] })) {
        // drained only so the generator runs
      }
    }, /was not found/);
    // A failed spawn never emits "exit", so a timer tied to it would outlive
    // the run and hold the process open for the whole timeout.
    assert.equal(process.getActiveResourcesInfo().includes("Timeout"), false);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = previous;
  }
});
