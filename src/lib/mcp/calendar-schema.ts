/**
 * The shape one calendar event takes after the model has read the MCP text
 * listing. Pure so the schema tests run without the LLM client.
 */
import { z } from "zod";
import { CALENDAR_EVENT_KINDS, type CalendarEventKind } from "../calendar-events.ts";
import { UNTRUSTED_CONTENT_CLAUSE } from "../prompts/shared.ts";

export type ParsedEvent = {
  title: string;
  start: string;
  end?: string;
  location?: string;
  kind: CalendarEventKind;
  course: string | null;
};

/**
 * Per-event, not per-response: a single hallucinated course name should drop
 * that event, not the whole sync.
 */
export function parsedEventSchema(courseNames: string[]): z.ZodType<ParsedEvent> {
  const allowed = new Set(courseNames);
  return z.object({
    title: z.string().min(1).max(200),
    start: z.string().min(1).max(64),
    end: z.string().max(64).optional(),
    location: z.string().max(200).optional(),
    kind: z.enum(CALENDAR_EVENT_KINDS as [CalendarEventKind, ...CalendarEventKind[]]).default("OTHER"),
    course: z
      .string()
      .max(200)
      .nullable()
      .default(null)
      .refine((c) => c === null || allowed.has(c), { message: "course is not one of the offered names" }),
  }) as z.ZodType<ParsedEvent>;
}

/** The outer envelope only; each event is validated on its own afterwards. */
export const parsedEventsEnvelopeSchema = z.object({ events: z.array(z.unknown()).max(50) });

export function buildParseEventsSystemPrompt(courseNames: string[]): string {
  const courseList = courseNames.length > 0 ? courseNames.map((c) => `- ${c}`).join("\n") : "- (no courses yet)";
  return `You convert a calendar tool's human-readable event listing into structured JSON for a student's study app.

Respond with ONLY a JSON object (no markdown code fences, no commentary) matching exactly this shape:
{
  "events": [ { "title": string, "start": string, "end": string, "location": string, "kind": string, "course": string | null } ]
}

Rules:
- One entry per event in the listing, in the listed order. "end" and "location" may be omitted when not shown.
- "start"/"end" are the event's date-times as shown, normalized to "YYYY-MM-DDTHH:mm" (all-day events: "YYYY-MM-DD").
- "kind" is exactly one of: EXAM (a test, exam, midterm, final, quiz), ASSIGNMENT (something due: homework, problem set, essay, project deadline), CLASS (a lecture, seminar, lab, tutorial), OTHER (anything else).
- "course" is the student's course this event belongs to, copied EXACTLY from this list, or null when none clearly fits:
${courseList}
- Never invent a course name that is not in the list. When unsure, use null.
- If the listing says there are no events, return { "events": [] }.
- Do not invent events that aren't in the listing.

${UNTRUSTED_CONTENT_CLAUSE}`;
}
