import path from "node:path";

/**
 * How the study-plan run is invoked. The flags here are the agent's sandbox,
 * not preferences — see args.test.ts, which fails if one goes missing.
 */

export function claudeBinary(): string {
  return process.env.CLAUDE_BIN || "claude";
}

/**
 * The MCP config is passed inline rather than as a temp file, so a killed run
 * leaves nothing to clean up. The server is spawned the way package.json runs
 * its other scripts: node with tsx's loader.
 */
export function mcpConfigJson(folderId: string): string {
  return JSON.stringify({
    mcpServers: {
      lectern: {
        command: process.execPath,
        args: ["--import", "tsx", path.join(process.cwd(), "scripts", "lectern-mcp.ts")],
        env: {
          LECTERN_FOLDER_ID: folderId,
          LECTERN_BASE_URL: process.env.LECTERN_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`,
          // tsx resolves from node_modules, and the loader needs PATH/HOME
          // like any other child process.
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
        },
      },
    },
  });
}

export function claudeArgs(opts: {
  prompt: string;
  systemPrompt: string;
  folderId: string;
  model?: string;
  effort?: string;
}): string[] {
  return [
    "-p",
    opts.prompt,
    "--model",
    opts.model ?? process.env.AGENT_MODEL ?? "opus",
    "--effort",
    opts.effort ?? process.env.AGENT_EFFORT ?? "medium",
    "--append-system-prompt",
    opts.systemPrompt,
    "--mcp-config",
    mcpConfigJson(opts.folderId),
    // Ignore the user's own Claude Code MCP servers: a study plan must not
    // reach their Notion or their filesystem because it happens to be
    // configured there.
    "--strict-mcp-config",
    // Pre-approve Lectern's tools; anything else is denied rather than
    // blocking on a permission prompt no human is watching.
    "--allowedTools",
    "mcp__lectern__*",
    "--permission-prompts",
    "none",
    // No Bash, no other code runners, no WebFetch.
    "--restricted",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    // The CLI requires --verbose when --print is combined with --output-format stream-json.
    "--verbose",
  ];
}
