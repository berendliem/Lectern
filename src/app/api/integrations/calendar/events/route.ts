import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { listUpcomingEventsText, parseEventsList } from "@/lib/mcp/calendar";

export const runtime = "nodejs";

// GET /api/integrations/calendar/events?days=7 — upcoming events from the
// Google Calendar MCP server, both as the server's text and (best-effort)
// LLM-parsed into structured events.
export async function GET(req: NextRequest) {
  const daysRaw = Number(req.nextUrl.searchParams.get("days") ?? 7);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.trunc(daysRaw), 1), 31) : 7;

  try {
    const text = await listUpcomingEventsText(days);
    const events = await parseEventsList(text).catch(() => []);
    return NextResponse.json({ text, events });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not load calendar events", 502);
  }
}
