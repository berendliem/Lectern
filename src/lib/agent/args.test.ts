import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeArgs, claudeBinary, mcpConfigJson } from "./args.ts";

const opts = { prompt: "plan my week", systemPrompt: "you are Lectern", folderId: "folder-1" };

test("the sandbox flags are all present", () => {
  const args = claudeArgs(opts);
  // Each of these is load-bearing: without them the run inherits the user's
  // own MCP servers, gains a shell, or hangs on a prompt nobody can answer.
  for (const flag of ["--strict-mcp-config", "--restricted", "--permission-prompts", "--allowedTools"]) {
    assert.ok(args.includes(flag), `missing ${flag}`);
  }
  assert.equal(args[args.indexOf("--permission-prompts") + 1], "none");
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__lectern__*");
});

test("it runs in print mode and streams json", () => {
  const args = claudeArgs(opts);
  assert.ok(args.includes("-p"));
  assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
  assert.ok(args.includes("--include-partial-messages"));
});

test("the prompt is an argument value, never interpolated into a shell string", () => {
  const args = claudeArgs({ ...opts, prompt: "; rm -rf /" });
  assert.ok(args.includes("; rm -rf /"));
  assert.equal(args[args.indexOf("--append-system-prompt") + 1], "you are Lectern");
});

test("the mcp config names the server 'lectern' and pins the folder", () => {
  const config = JSON.parse(mcpConfigJson("folder-1"));
  const server = config.mcpServers.lectern;
  assert.equal(server.env.LECTERN_FOLDER_ID, "folder-1");
  assert.ok(server.args.some((a: string) => a.endsWith("scripts/lectern-mcp.ts")));
});

test("the binary is overridable, so tests can stub the CLI", () => {
  const previous = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = "/tmp/fake-claude";
  assert.equal(claudeBinary(), "/tmp/fake-claude");
  if (previous === undefined) delete process.env.CLAUDE_BIN;
  else process.env.CLAUDE_BIN = previous;
});
