import { callMcpTool } from "@/lib/mcp/client";
import { callLLMJSON } from "@/lib/llm";
import {
  parsedEventSchema,
  parsedEventsEnvelopeSchema,
  buildParseEventsSystemPrompt,
  type ParsedEvent,
} from "@/lib/mcp/calendar-schema";

export type { ParsedEvent };

export const CALENDAR_SERVER = "google-calendar";

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** "YYYY-MM-DDTHH:mm:ss" in local time — the format the calendar server expects. */
function toLocalIso(d: Date): string {
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Raw, human-readable listing of events over the coming days. */
export async function listUpcomingEventsText(days: number): Promise<string> {
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return callMcpTool(CALENDAR_SERVER, "list-events", {
    calendarId: "primary",
    timeMin: toLocalIso(now),
    timeMax: toLocalIso(end),
    timeZone: localTimeZone(),
  });
}

/**
 * The calendar MCP server returns formatted text, not JSON — run it through
 * the configured LLM to get structured events. `courseNames` are offered to
 * the model as the only legal values for `course`; anything else is dropped
 * per event, so one bad guess costs one row rather than the whole listing.
 */
export async function parseEventsList(listingText: string, courseNames: string[]): Promise<ParsedEvent[]> {
  const raw = await callLLMJSON({
    model: process.env.OPENROUTER_MODEL_SUMMARY ?? "openrouter/free",
    stage: "summary",
    systemPrompt: buildParseEventsSystemPrompt(courseNames),
    userPrompt: `EVENT LISTING:\n"""\n${listingText.slice(0, 24_000)}\n"""`,
  });
  const envelope = await parsedEventsEnvelopeSchema.parseAsync(raw);
  const eventSchema = parsedEventSchema(courseNames);
  const events: ParsedEvent[] = [];
  let rejected = 0;
  for (const candidate of envelope.events) {
    const r = eventSchema.safeParse(candidate);
    if (r.success) events.push(r.data);
    else rejected += 1;
  }
  if (rejected > 0) console.warn(`[calendar] dropped ${rejected} event(s) the classifier returned malformed`);
  return events;
}

/** Creates a calendar event; returns the server's confirmation text. */
export async function createCalendarEvent(opts: {
  summary: string;
  description?: string;
  start: Date;
  durationMinutes: number;
}): Promise<string> {
  const end = new Date(opts.start.getTime() + opts.durationMinutes * 60 * 1000);
  return callMcpTool(CALENDAR_SERVER, "create-event", {
    calendarId: "primary",
    summary: opts.summary,
    ...(opts.description ? { description: opts.description } : {}),
    start: toLocalIso(opts.start),
    end: toLocalIso(end),
    timeZone: localTimeZone(),
  });
}
