import { z } from "zod";
import { callMcpTool } from "@/lib/mcp/client";
import { callLLMJSON } from "@/lib/llm";
import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

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

export const parsedEventSchema = z.object({
  title: z.string().min(1).max(200),
  start: z.string().min(1).max(64),
  end: z.string().max(64).optional(),
  location: z.string().max(200).optional(),
});
export type ParsedEvent = z.infer<typeof parsedEventSchema>;

const parsedEventsResponseSchema = z.object({ events: z.array(parsedEventSchema).max(50) });

const PARSE_EVENTS_SYSTEM_PROMPT = `You convert a calendar tool's human-readable event listing into structured JSON.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "events": [ { "title": string, "start": string, "end": string, "location": string } ]
}

Rules:
- One entry per event in the listing, in the listed order. "end" and "location" may be omitted when not shown.
- "start"/"end" are the event's date-times as shown, normalized to "YYYY-MM-DDTHH:mm" (all-day events: "YYYY-MM-DD").
- If the listing says there are no events, return { "events": [] }.
- Do not invent events that aren't in the listing.

${UNTRUSTED_CONTENT_CLAUSE}`;

/**
 * The calendar MCP server returns formatted text, not JSON — run it through
 * the configured LLM to get structured events for the UI.
 */
export async function parseEventsList(listingText: string): Promise<ParsedEvent[]> {
  const raw = await callLLMJSON({
    model: process.env.OPENROUTER_MODEL_SUMMARY ?? "meta-llama/llama-3.3-70b-instruct:free",
    stage: "summary",
    systemPrompt: PARSE_EVENTS_SYSTEM_PROMPT,
    userPrompt: `EVENT LISTING:\n"""\n${listingText.slice(0, 24_000)}\n"""`,
  });
  return (await parsedEventsResponseSchema.parseAsync(raw)).events;
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
