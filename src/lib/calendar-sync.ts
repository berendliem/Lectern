/**
 * Pull the next two weeks from Google Calendar (over MCP), classify, and
 * replace the rows in that window. Home reads the table, never this.
 */
import { db } from "@/lib/db";
import { loadMcpServers } from "@/lib/mcp/config";
import { CALENDAR_SERVER, listUpcomingEventsText, parseEventsList } from "@/lib/mcp/calendar";
import { externalKeyFor, parseEventStart, SYNC_WINDOW_DAYS } from "@/lib/calendar-events";

const DAY_MS = 24 * 60 * 60 * 1000;

export class CalendarNotConfiguredError extends Error {
  constructor() {
    super('Google Calendar is not connected. Add a "google-calendar" server to mcp.config.json.');
    this.name = "CalendarNotConfiguredError";
  }
}

export async function isCalendarConfigured(): Promise<boolean> {
  const servers = await loadMcpServers().catch(() => ({}));
  return CALENDAR_SERVER in servers;
}

export async function syncCalendarEvents(
  now: Date = new Date()
): Promise<{ synced: number; syncedAt: Date; skippedPrune: boolean }> {
  // Not isCalendarConfigured(): that helper swallows a broken mcp.config.json
  // into "not configured". Here the contract is narrower — missing server
  // key is 409, any other failure to even read the config is a real 502.
  const servers = await loadMcpServers();
  if (!(CALENDAR_SERVER in servers)) throw new CalendarNotConfiguredError();

  const folders = await db.folder.findMany({ select: { id: true, name: true } });
  const folderIdByName = new Map(folders.map((f) => [f.name, f.id]));

  const text = await listUpcomingEventsText(SYNC_WINDOW_DAYS);
  const { events: parsed, rejected } = await parseEventsList(text, folders.map((f) => f.name));

  const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowEnd = new Date(windowStart.getTime() + SYNC_WINDOW_DAYS * DAY_MS);

  // A pinned course survives whatever the classifier says this time.
  const existing = await db.calendarEvent.findMany({
    where: { start: { gte: windowStart, lt: windowEnd } },
    select: { externalKey: true, folderPinned: true, folderId: true },
  });
  const pinned = new Map(existing.filter((e) => e.folderPinned).map((e) => [e.externalKey, e.folderId]));

  const syncedAt = now;
  const keys: string[] = [];
  const writes = [];
  let unparseable = 0;
  for (const e of parsed) {
    const when = parseEventStart(e.start);
    if (!when) {
      unparseable += 1;
      continue;
    }
    if (when.start < windowStart || when.start >= windowEnd) continue;
    const end = e.end ? (parseEventStart(e.end)?.start ?? null) : null;
    const externalKey = externalKeyFor(e.title, when.start.toISOString());
    keys.push(externalKey);
    const matchedFolderId = e.course ? (folderIdByName.get(e.course) ?? null) : null;
    const folderId = pinned.has(externalKey) ? (pinned.get(externalKey) ?? null) : matchedFolderId;
    const fields = {
      title: e.title,
      start: when.start,
      end,
      allDay: when.allDay,
      location: e.location ?? null,
      kind: e.kind,
      syncedAt,
    };
    writes.push(
      db.calendarEvent.upsert({
        where: { externalKey },
        create: { externalKey, ...fields, folderId },
        // folderPinned is deliberately absent from update: only the student sets it.
        update: { ...fields, folderId },
      })
    );
  }

  // A per-event rejection must not be read as a cancellation: pruning on a
  // partly bad run would delete the rows the classifier merely stumbled on,
  // taking a pinned folder with them. The upserts that did parse still run
  // either way — only the deleteMany is conditional.
  if (rejected + unparseable > 0) {
    console.warn(
      `[calendar] sync produced ${rejected} rejected and ${unparseable} unparseable event(s); skipping the window prune`
    );
    await db.$transaction([...writes]);
    return { synced: keys.length, syncedAt, skippedPrune: true };
  }

  await db.$transaction([
    ...writes,
    // A cancelled exam disappears; a row outside the window is someone else's.
    db.calendarEvent.deleteMany({
      where: { start: { gte: windowStart, lt: windowEnd }, externalKey: { notIn: keys } },
    }),
  ]);

  return { synced: keys.length, syncedAt, skippedPrune: false };
}
