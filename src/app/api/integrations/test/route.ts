import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, withValidation } from "@/lib/api-utils";
import { listMcpTools } from "@/lib/mcp/client";

export const runtime = "nodejs";

const testSchema = z.object({ server: z.string().trim().min(1).max(64) });

// Connects to (spawning if needed) one configured MCP server and lists its
// tools — the "test connection" button.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(testSchema, body);
  if ("error" in result) return result.error;

  try {
    const tools = await listMcpTools(result.data.server);
    return NextResponse.json({ ok: true, toolCount: tools.length, tools: tools.map((t) => t.name) });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not connect to the MCP server", 502);
  }
}
