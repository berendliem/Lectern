import { NextResponse } from "next/server";
import { loadMcpServers } from "@/lib/mcp/config";
import { isMcpClientConnected } from "@/lib/mcp/client";

export const runtime = "nodejs";

// Configured MCP servers and whether each has a live client. Doesn't spawn
// anything — connecting happens lazily on first use or via the test endpoint.
export async function GET() {
  try {
    const servers = await loadMcpServers();
    return NextResponse.json({
      servers: Object.entries(servers).map(([name, entry]) => ({
        name,
        command: `${entry.command} ${entry.args.join(" ")}`.trim(),
        connected: isMcpClientConnected(name),
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not read the MCP config";
    return NextResponse.json({ servers: [], configError: message });
  }
}
