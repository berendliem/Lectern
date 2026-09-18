import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { listOnqCourses } from "@/lib/mcp/onq";

export async function GET() {
  try {
    return NextResponse.json({ courses: await listOnqCourses() });
  } catch (e) {
    // 502: Lectern is fine, the thing behind it is not. The message is
    // onq-mcp's own (or the MCP client's "not configured" text) and already
    // says what to do.
    return jsonError(e instanceof Error ? e.message : "Could not reach onQ.", 502);
  }
}
