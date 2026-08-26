import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { upcomingSchedule } from "@/lib/planner";
import { createCalendarEvent } from "@/lib/mcp/calendar";

export const runtime = "nodejs";

// Review sessions land at this local hour by default (evening study block).
const DEFAULT_HOUR = 18;
const SESSION_MINUTES = 30;

// Creates one "Review flashcards" calendar event per upcoming day that has
// cards due (next 7 days), so spaced repetition shows up in the student's
// real schedule.
export async function POST() {
  const cards = await db.flashcard.findMany({ select: { nextReviewAt: true } });
  const schedule = upcomingSchedule(cards.map((c) => c.nextReviewAt), 7);
  const daysWithReviews = schedule.filter((d) => d.count > 0);

  if (daysWithReviews.length === 0) {
    return jsonError("No flashcards are due in the next 7 days — nothing to schedule", 422);
  }

  const hourRaw = Number(process.env.REVIEW_EVENT_HOUR ?? DEFAULT_HOUR);
  const hour = Number.isInteger(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? hourRaw : DEFAULT_HOUR;

  const created: string[] = [];
  try {
    for (const day of daysWithReviews) {
      const start = new Date(day.date);
      start.setHours(hour, 0, 0, 0);
      // Skip a slot that's already in the past (e.g. today, evening gone).
      if (start.getTime() < Date.now()) continue;

      await createCalendarEvent({
        summary: `Review flashcards (${day.count} due)`,
        description: "Spaced-repetition review session — created by AI Notetaker.",
        start,
        durationMinutes: SESSION_MINUTES,
      });
      created.push(day.key);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Creating calendar events failed";
    // Partial progress is worth reporting — some events may already exist.
    return jsonError(
      created.length > 0 ? `${message} (created ${created.length} event(s) before failing)` : message,
      502
    );
  }

  if (created.length === 0) {
    return jsonError("All upcoming review slots are already in the past — try REVIEW_EVENT_HOUR later in the day", 422);
  }
  return NextResponse.json({ createdDays: created });
}
