import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// Claude-Desktop-style MCP config: { "mcpServers": { name: {command,args,env} } }.
// Lives in mcp.config.json at the repo root (gitignored — it can carry tokens);
// override the location with MCP_CONFIG_PATH.
const serverEntrySchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).default({}),
});

const mcpConfigSchema = z.object({
  mcpServers: z.record(z.string().min(1).max(64), serverEntrySchema).default({}),
});

export type McpServerEntry = z.infer<typeof serverEntrySchema>;

export function mcpConfigPath(): string {
  return process.env.MCP_CONFIG_PATH || path.join(process.cwd(), "mcp.config.json");
}

/** Returns the configured servers, or {} when no config file exists. */
export async function loadMcpServers(): Promise<Record<string, McpServerEntry>> {
  let raw: string;
  try {
    raw = await readFile(mcpConfigPath(), "utf8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${mcpConfigPath()} is not valid JSON.`);
  }

  const result = mcpConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `${mcpConfigPath()} doesn't match the expected shape { "mcpServers": { "<name>": { "command", "args", "env" } } }.`
    );
  }
  return result.data.mcpServers;
}
