import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadMcpServers } from "@/lib/mcp/config";
import { toolResultJson, toolResultText, type ToolResultLike } from "@/lib/mcp/tool-json";

// MCP servers are spawned child processes (npx cold starts take seconds), so
// clients are cached for the app's lifetime. The globalThis indirection keeps
// the cache — and the child processes — alive across Next dev HMR reloads,
// mirroring the Prisma singleton in src/lib/db.ts.
type Entry = { client: Client; connecting: Promise<void> | null };

const globalForMcp = globalThis as unknown as { __mcpClients?: Map<string, Entry> };
const clients: Map<string, Entry> = (globalForMcp.__mcpClients ??= new Map());

const CALL_TIMEOUT_MS = 60_000;

type CallOptions = { timeoutMs?: number };

async function connectServer(name: string): Promise<Client> {
  const servers = await loadMcpServers();
  const entry = servers[name];
  if (!entry) {
    throw new Error(
      `No MCP server named "${name}" is configured. Add it to mcp.config.json (see mcp.config.example.json).`
    );
  }

  const client = new Client({ name: "lectern", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: entry.command,
    args: entry.args,
    // The SDK merges this over a minimal safe default env (PATH, HOME, …);
    // everything else the server needs must be listed in the config file.
    env: entry.env,
    stderr: "ignore",
  });

  try {
    await client.connect(transport);
  } catch (e) {
    await client.close().catch(() => undefined);
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not start the "${name}" MCP server (${entry.command} ${entry.args.join(" ")}): ${detail}`
    );
  }
  return client;
}

export async function getMcpClient(name: string): Promise<Client> {
  const existing = clients.get(name);
  if (existing) {
    if (existing.connecting) await existing.connecting;
    return existing.client;
  }

  let resolveConnecting: () => void;
  let rejectConnecting: (e: unknown) => void;
  const connecting = new Promise<void>((res, rej) => {
    resolveConnecting = res;
    rejectConnecting = rej;
  });
  // Reserve the slot before awaiting so concurrent requests share one spawn.
  const placeholder: Entry = { client: null as unknown as Client, connecting };
  clients.set(name, placeholder);

  try {
    const client = await connectServer(name);
    placeholder.client = client;
    placeholder.connecting = null;
    resolveConnecting!();
    return client;
  } catch (e) {
    clients.delete(name);
    rejectConnecting!(e);
    // The shared promise rejection is consumed by concurrent waiters; the
    // primary caller gets the error thrown directly.
    connecting.catch(() => undefined);
    throw e;
  }
}

export async function disconnectMcpClient(name: string): Promise<void> {
  const entry = clients.get(name);
  clients.delete(name);
  if (entry?.client) await entry.client.close().catch(() => undefined);
}

async function callRaw(serverName: string, toolName: string, args: Record<string, unknown>, opts?: CallOptions) {
  const client = await getMcpClient(serverName);

  let result: ToolResultLike & { isError: boolean };
  try {
    const raw = await client.callTool({ name: toolName, arguments: args }, undefined, {
      timeout: opts?.timeoutMs ?? CALL_TIMEOUT_MS,
    });
    result = { content: raw.content, structuredContent: raw.structuredContent, isError: raw.isError === true };
  } catch (e) {
    // A dead child process (server crashed, laptop slept) leaves a wedged
    // client; drop it so the next call reconnects fresh. Per-call failures
    // (timeouts, validation errors) keep the client — the process is alive,
    // and respawning it would defeat the whole point of caching.
    const message = e instanceof Error ? e.message : String(e);
    if (/connection closed|not connected|transport|EPIPE|ECONNRESET|write after end/i.test(message)) {
      await disconnectMcpClient(serverName);
    }
    throw e;
  }

  if (result.isError) {
    throw new Error(toolResultText(result) || `The ${serverName} MCP tool "${toolName}" returned an error.`);
  }
  return result;
}

/** Calls a tool and returns the concatenated text content blocks. */
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  opts?: CallOptions
): Promise<string> {
  return toolResultText(await callRaw(serverName, toolName, args, opts));
}

/** Calls a tool whose result is JSON and returns it parsed. See toolResultJson. */
export async function callMcpToolJson(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  opts?: CallOptions
): Promise<unknown> {
  return toolResultJson(await callRaw(serverName, toolName, args, opts));
}

/** True when a live (cached) client exists for the server. */
export function isMcpClientConnected(name: string): boolean {
  const entry = clients.get(name);
  return !!entry && entry.connecting === null;
}

export async function listMcpTools(serverName: string): Promise<{ name: string; description?: string }[]> {
  const client = await getMcpClient(serverName);
  const { tools } = await client.listTools();
  return tools.map((t) => ({ name: t.name, description: t.description }));
}

// Close child processes when the dev/prod server shuts down. Guarded so HMR
// re-evaluation doesn't stack duplicate handlers.
const globalForHooks = globalThis as unknown as { __mcpExitHooked?: boolean };
if (!globalForHooks.__mcpExitHooked) {
  globalForHooks.__mcpExitHooked = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      for (const [, entry] of clients) void entry.client?.close().catch(() => undefined);
    });
  }
}
