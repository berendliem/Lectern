import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { CalendarNotConfiguredError, syncCalendarEvents } from "@/lib/calendar-sync";

export const runtime = "nodejs";

// POST: this reads an external calendar and calls a model, so it is a
// mutating verb and covered by the cross-site guard in src/proxy.ts.
export async function POST() {
  try {
    const { synced, syncedAt } = await syncCalendarEvents();
    return NextResponse.json({ synced, syncedAt: syncedAt.toISOString() });
  } catch (e) {
    if (e instanceof CalendarNotConfiguredError) return jsonError(e.message, 409);
    return jsonError(e instanceof Error ? e.message : "Could not sync calendar events", 502);
  }
}
