# Home + Up next Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the home page around "what should I do right now": a Today row, an Up next strip fed by persisted Google Calendar events tied to courses, and course cards with a mastery ring.

**Architecture:** A new `CalendarEvent` table is filled by a sync route that reuses the existing MCP calendar listing and asks the existing parse prompt for two more fields (`kind`, `course`). Home is a server component that reads SQLite only; a small client component triggers a sync when the newest row is older than 30 minutes. Pure helpers live in `src/lib/calendar-events.ts` with `node --test` coverage, the same split as `embed-math.ts`.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 on SQLite (`@prisma/adapter-better-sqlite3`), zod 4, Tailwind 4, lucide-react, `node --test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-11-home-up-next-design.md`

## Global Constraints

- `main` is protected. Work on `feat/home-up-next` (already exists, off `main`). Land through a PR.
- Migrations are hand-authored SQL, applied with `npm run db:migrate` (snapshots first, then `prisma migrate deploy`). Never run `prisma migrate dev` against `prisma/dev.db`; it proposes dropping the FTS5 shadow tables.
- `src/generated/prisma` is git-ignored. After any schema change run `npx prisma generate`.
- Every destructive action says what it destroys before it happens. This plan adds no destructive UI.
- No new dependencies. `sha1` comes from `node:crypto`.
- Tests: `node --test` files under `src/lib/**/*.test.ts`, importing siblings with the `.ts` extension. Pure modules must not import `@/lib/db`, `@/lib/llm`, or anything that reads env at import time.
- Commit format: `<type>: <imperative lowercase phrase>`, one logical change per commit, with the session trailer:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt
  ```
- Copy rules from the spec: gold is used only for the exam countdown text and the ring arc; weights regular and semibold only; type scale 28 / 17 / 15 / 13 / 11 px; motion respects `prefers-reduced-motion`.
- Existing tokens to use: `text-ink`, `text-ink-soft`, `text-muted`, `text-muted-2`, `bg-surface`, `bg-surface-2`, `bg-surface-3`, `border-line`, `border-line-strong`, `bg-brand`, `bg-brand-soft`, `text-brand-ink`, `border-brand-border`, `text-gold`. Folder colours via `folderFamily`, `FOLDER_CHIP_CLASSES`, `FOLDER_DOT_CLASSES` in `src/lib/folder-colors.ts`.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | `CalendarEventKind` enum, `CalendarEvent` model, `Folder.calendarEvents` relation |
| `prisma/migrations/20260911180000_calendar_events/migration.sql` | Hand-authored CREATE TABLE + indexes |
| `src/lib/calendar-events.ts` | Pure helpers: keys, date parsing, academic filter, record window, day grouping, exam countdown, mastery per folder, staleness. No db, no env |
| `src/lib/calendar-events.test.ts` | Tests for the above |
| `src/lib/mcp/calendar-schema.ts` | zod schema for one parsed event with `kind` and `course`; the prompt text. Pure |
| `src/lib/mcp/calendar-schema.test.ts` | Schema rejection tests |
| `src/lib/mcp/calendar.ts` | Existing. `parseEventsList` gains `courseNames` and per-event validation |
| `src/lib/calendar-sync.ts` | `syncCalendarEvents()`: MCP read, parse, upsert, prune. Touches db |
| `src/app/api/integrations/calendar/sync/route.ts` | Thin POST wrapper, 409 when not configured |
| `src/app/api/calendar-events/[id]/route.ts` | PATCH `folderId`, sets `folderPinned` |
| `src/lib/validation.ts` | `updateCalendarEventSchema` |
| `src/components/home/TodayRow.tsx` | Due count, streak, one primary action |
| `src/components/home/MasteryRing.tsx` | 44px SVG ring |
| `src/components/home/CourseCard.tsx` | Ring, name, due, next exam, last lecture |
| `src/components/home/UpNext.tsx` | Client. Grouped rows, Record button, Add to course, retry line |
| `src/components/home/CoursePicker.tsx` | Client. Modal listing folders, PATCHes the event |
| `src/components/home/CalendarSyncTrigger.tsx` | Client. Fires one sync when stale, refreshes |
| `src/app/page.tsx` | Server. Reads SQLite, composes the above |
| `src/components/recording/RecordingPanel.tsx` | Reads `?record=1` once, starts recording |
| `src/app/planner/page.tsx` | Adds the full 14-day calendar list |
| `src/components/dashboard/StatsRow.tsx` | Deleted |
| `README.md` | Google Calendar bullet and "Using it" mention home |

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (enums block near line 60; `Folder` model line 90)
- Create: `prisma/migrations/20260911180000_calendar_events/migration.sql`

**Interfaces:**
- Produces: Prisma model `CalendarEvent` with fields `id, externalKey, title, start, end, allDay, location, kind, folderId, folderPinned, syncedAt`, relation `folder`, and enum `CalendarEventKind = EXAM | ASSIGNMENT | CLASS | OTHER`. Generated type `CalendarEventKind` from `@/generated/prisma/enums`.

- [ ] **Step 1: Add the enum and model to the schema**

In `prisma/schema.prisma`, after the `RecallKind` enum block, add:

```prisma
/// What a calendar event is to a student. Set by the classifier in
/// src/lib/mcp/calendar-schema.ts; OTHER is the default and stays off home
/// unless the event is tied to a course.
enum CalendarEventKind {
  EXAM
  ASSIGNMENT
  CLASS
  OTHER
}
```

After the `Chunk` model at the end of the file, add:

```prisma
/// A Google Calendar event, persisted so home renders from SQLite and never
/// waits on the MCP server. Rows are replaced on every sync inside the sync
/// window; the only student-owned field is folderId once folderPinned is set.
model CalendarEvent {
  id           String            @id @default(cuid())
  /// sha1(title + start). The MCP listing is text and carries no event id.
  externalKey  String            @unique
  title        String
  start        DateTime
  end          DateTime?
  allDay       Boolean           @default(false)
  location     String?
  kind         CalendarEventKind @default(OTHER)
  folderId     String?
  /// True once the student picked the course by hand; sync never overwrites it.
  folderPinned Boolean           @default(false)
  syncedAt     DateTime          @default(now())

  folder Folder? @relation(fields: [folderId], references: [id], onDelete: SetNull)

  @@index([start])
  @@index([folderId, start])
}
```

In the `Folder` model, after `topics    CourseTopic[]` add:

```prisma
  calendarEvents CalendarEvent[]
```

- [ ] **Step 2: Write the migration by hand**

Create `prisma/migrations/20260911180000_calendar_events/migration.sql`:

```sql
-- CreateTable
--
-- Hand-authored rather than `prisma migrate dev`: this repo's `page_search`
-- FTS5 virtual tables are invisible to the Prisma datamodel, so the diff
-- engine always proposes dropping them alongside any real change (see the
-- 20260908120000_recall_ledger migration for the same note). Additive table,
-- nothing here but the CREATE and its indexes.
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "externalKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start" DATETIME NOT NULL,
    "end" DATETIME,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "folderId" TEXT,
    "folderPinned" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarEvent_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_externalKey_key" ON "CalendarEvent"("externalKey");

-- CreateIndex
CREATE INDEX "CalendarEvent_start_idx" ON "CalendarEvent"("start");

-- CreateIndex
CREATE INDEX "CalendarEvent_folderId_start_idx" ON "CalendarEvent"("folderId", "start");
```

- [ ] **Step 3: Apply and regenerate**

Run:
```bash
npm run db:migrate
npx prisma generate
```
Expected: backup line `Backed up prisma/dev.db -> prisma/backups/...`, then `1 migration found ... applied`, then `Generated Prisma Client`.

- [ ] **Step 4: Verify the schema matches the SQL**

Run:
```bash
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-url "file:./prisma/dev.db" --script | grep -i calendarevent
```
Expected: no output. Lines about `page_search` are the known FTS noise and are ignored.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit 2>&1 | tail -3`
Expected: no errors. (The 9 `never`-typed relation errors seen before this branch come from a stale generated client and disappear after `prisma generate`.)

```bash
git add prisma/schema.prisma prisma/migrations/20260911180000_calendar_events/migration.sql
git commit -m "feat: add the CalendarEvent table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt"
```

---

### Task 2: Pure calendar helpers

**Files:**
- Create: `src/lib/calendar-events.ts`
- Create: `src/lib/calendar-events.test.ts`

**Interfaces:**
- Consumes: `dayKey` from `src/lib/planner.ts`, `masteryOf` from `src/lib/mastery.ts`.
- Produces:
  ```ts
  export type CalendarEventKind = "EXAM" | "ASSIGNMENT" | "CLASS" | "OTHER";
  export const CALENDAR_EVENT_KINDS: readonly CalendarEventKind[];
  export const SYNC_WINDOW_DAYS = 14;
  export const HOME_WINDOW_DAYS = 7;
  export const STALE_AFTER_MS = 30 * 60 * 1000;
  export function externalKeyFor(title: string, start: string): string;
  export function parseEventStart(value: string): { start: Date; allDay: boolean } | null;
  export function isAcademic(e: { kind: CalendarEventKind; folderId: string | null }): boolean;
  export function inRecordWindow(start: Date, now: Date): boolean;
  export function examCountdown(start: Date, now: Date): string;
  export function dayLabel(date: Date, now: Date): string;
  export function groupByDay<T extends { start: Date }>(events: T[], now: Date): { key: string; label: string; events: T[] }[];
  export type FolderCardStats = { total: number; mastered: number; due: number };
  export function masteryByFolder(cards: { repetitions: number; lastReviewedAt: Date | null; nextReviewAt: Date; folderId: string | null }[], now: Date): Map<string, FolderCardStats>;
  export function isStale(lastSyncedAt: Date | null, now: Date): boolean;
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/calendar-events.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  externalKeyFor,
  parseEventStart,
  isAcademic,
  inRecordWindow,
  examCountdown,
  dayLabel,
  groupByDay,
  masteryByFolder,
  isStale,
  STALE_AFTER_MS,
} from "./calendar-events.ts";

const now = new Date(2026, 8, 11, 12, 0, 0); // local Fri 11 Sep 2026 12:00

test("externalKeyFor is stable for the same title and start", () => {
  assert.equal(externalKeyFor("Midterm", "2026-09-15T13:00"), externalKeyFor("Midterm", "2026-09-15T13:00"));
  assert.notEqual(externalKeyFor("Midterm", "2026-09-15T13:00"), externalKeyFor("Midterm", "2026-09-16T13:00"));
  assert.match(externalKeyFor("a", "b"), /^[0-9a-f]{40}$/);
});

test("parseEventStart reads a local date-time", () => {
  const parsed = parseEventStart("2026-09-15T13:05");
  assert.ok(parsed);
  assert.equal(parsed.allDay, false);
  assert.equal(parsed.start.getFullYear(), 2026);
  assert.equal(parsed.start.getMonth(), 8);
  assert.equal(parsed.start.getDate(), 15);
  assert.equal(parsed.start.getHours(), 13);
  assert.equal(parsed.start.getMinutes(), 5);
});

test("parseEventStart reads an all-day date as local midnight", () => {
  const parsed = parseEventStart("2026-09-15");
  assert.ok(parsed);
  assert.equal(parsed.allDay, true);
  assert.equal(parsed.start.getHours(), 0);
  assert.equal(parsed.start.getDate(), 15);
});

test("parseEventStart rejects junk", () => {
  assert.equal(parseEventStart("tomorrow"), null);
  assert.equal(parseEventStart(""), null);
  assert.equal(parseEventStart("2026-13-40"), null);
});

test("isAcademic is true for a kind or a course, false for an untied OTHER", () => {
  assert.equal(isAcademic({ kind: "EXAM", folderId: null }), true);
  assert.equal(isAcademic({ kind: "OTHER", folderId: "f1" }), true);
  assert.equal(isAcademic({ kind: "OTHER", folderId: null }), false);
});

test("inRecordWindow opens 15 minutes before and closes 30 minutes after", () => {
  const start = new Date(2026, 8, 11, 14, 0);
  assert.equal(inRecordWindow(start, new Date(2026, 8, 11, 13, 44)), false);
  assert.equal(inRecordWindow(start, new Date(2026, 8, 11, 13, 45)), true);
  assert.equal(inRecordWindow(start, new Date(2026, 8, 11, 14, 30)), true);
  assert.equal(inRecordWindow(start, new Date(2026, 8, 11, 14, 31)), false);
});

test("examCountdown speaks in days", () => {
  assert.equal(examCountdown(new Date(2026, 8, 11, 18, 0), now), "Today");
  assert.equal(examCountdown(new Date(2026, 8, 12, 9, 0), now), "Tomorrow");
  assert.equal(examCountdown(new Date(2026, 8, 15, 13, 0), now), "in 4 days");
});

test("dayLabel is Today, Tomorrow, then weekday and day", () => {
  assert.equal(dayLabel(new Date(2026, 8, 11, 9), now), "Today");
  assert.equal(dayLabel(new Date(2026, 8, 12, 9), now), "Tomorrow");
  assert.equal(dayLabel(new Date(2026, 8, 15, 9), now), "Tue 15");
});

test("groupByDay keeps order and groups by local day", () => {
  const a = { id: "a", start: new Date(2026, 8, 11, 14) };
  const b = { id: "b", start: new Date(2026, 8, 11, 16) };
  const c = { id: "c", start: new Date(2026, 8, 12, 9) };
  const groups = groupByDay([a, b, c], now);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].label, "Today");
  assert.deepEqual(groups[0].events.map((e) => e.id), ["a", "b"]);
  assert.equal(groups[1].label, "Tomorrow");
  assert.deepEqual(groups[1].events.map((e) => e.id), ["c"]);
});

test("masteryByFolder counts total, mastered, and due per course and skips unfiled cards", () => {
  const past = new Date(now.getTime() - 1000);
  const future = new Date(now.getTime() + 86_400_000);
  const stats = masteryByFolder(
    [
      { repetitions: 3, lastReviewedAt: past, nextReviewAt: future, folderId: "f1" },
      { repetitions: 0, lastReviewedAt: null, nextReviewAt: past, folderId: "f1" },
      { repetitions: 1, lastReviewedAt: past, nextReviewAt: past, folderId: "f2" },
      { repetitions: 5, lastReviewedAt: past, nextReviewAt: future, folderId: null },
    ],
    now
  );
  assert.deepEqual(stats.get("f1"), { total: 2, mastered: 1, due: 1 });
  assert.deepEqual(stats.get("f2"), { total: 1, mastered: 0, due: 1 });
  assert.equal(stats.size, 2);
});

test("isStale is true with no sync, or a sync older than the threshold", () => {
  assert.equal(isStale(null, now), true);
  assert.equal(isStale(new Date(now.getTime() - STALE_AFTER_MS - 1), now), true);
  assert.equal(isStale(new Date(now.getTime() - STALE_AFTER_MS + 1000), now), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test src/lib/calendar-events.test.ts`
Expected: FAIL, `Cannot find module './calendar-events.ts'`.

- [ ] **Step 3: Implement**

Create `src/lib/calendar-events.ts`:

```ts
/**
 * Pure helpers for calendar events on home and the planner. No db, no env, so
 * `node --test` imports it directly — the same split as embed-math.ts.
 */
import { createHash } from "node:crypto";
import { dayKey } from "./planner.ts";
import { masteryOf } from "./mastery.ts";

export type CalendarEventKind = "EXAM" | "ASSIGNMENT" | "CLASS" | "OTHER";
export const CALENDAR_EVENT_KINDS: readonly CalendarEventKind[] = ["EXAM", "ASSIGNMENT", "CLASS", "OTHER"];

/** How far ahead a sync reads. The planner shows all of it. */
export const SYNC_WINDOW_DAYS = 14;
/** How far ahead home's Up next looks. */
export const HOME_WINDOW_DAYS = 7;
/** A sync older than this triggers one background refresh on home. */
export const STALE_AFTER_MS = 30 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const RECORD_BEFORE_MS = 15 * 60 * 1000;
const RECORD_AFTER_MS = 30 * 60 * 1000;

/** The MCP listing carries no event id, so identity is title plus start. */
export function externalKeyFor(title: string, start: string): string {
  return createHash("sha1").update(`${title}\n${start}`).digest("hex");
}

/**
 * The parse prompt normalizes to "YYYY-MM-DDTHH:mm" or "YYYY-MM-DD". Both are
 * read as local time: `new Date("2026-09-15")` alone would be UTC midnight and
 * land an all-day exam on the wrong day west of Greenwich.
 */
export function parseEventStart(value: string): { start: Date; allDay: boolean } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const allDay = h === undefined;
  const start = new Date(Number(y), Number(mo) - 1, Number(d), allDay ? 0 : Number(h), allDay ? 0 : Number(mi));
  if (Number.isNaN(start.getTime())) return null;
  // Date rolls "2026-13-40" forward instead of failing; compare back.
  if (start.getMonth() !== Number(mo) - 1 || start.getDate() !== Number(d)) return null;
  return { start, allDay };
}

/** Home shows an event only when it is a course's or has an academic kind. */
export function isAcademic(e: { kind: CalendarEventKind; folderId: string | null }): boolean {
  return e.kind !== "OTHER" || e.folderId !== null;
}

/** A class is recordable from 15 minutes before its start to 30 minutes after. */
export function inRecordWindow(start: Date, now: Date): boolean {
  const delta = start.getTime() - now.getTime();
  return delta <= RECORD_BEFORE_MS && delta >= -RECORD_AFTER_MS;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

export function examCountdown(start: Date, now: Date): string {
  const days = daysBetween(now, start);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

export function dayLabel(date: Date, now: Date): string {
  const days = daysBetween(now, date);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  const weekday = date.toLocaleDateString("en", { weekday: "short" });
  return `${weekday} ${date.getDate()}`;
}

export function groupByDay<T extends { start: Date }>(
  events: T[],
  now: Date
): { key: string; label: string; events: T[] }[] {
  const groups: { key: string; label: string; events: T[] }[] = [];
  for (const e of events) {
    const key = dayKey(e.start);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, label: dayLabel(e.start, now), events: [e] });
  }
  return groups;
}

export type FolderCardStats = { total: number; mastered: number; due: number };

/** One pass over every card; cards with no course are not home's business. */
export function masteryByFolder(
  cards: { repetitions: number; lastReviewedAt: Date | null; nextReviewAt: Date; folderId: string | null }[],
  now: Date
): Map<string, FolderCardStats> {
  const out = new Map<string, FolderCardStats>();
  for (const c of cards) {
    if (!c.folderId) continue;
    const s = out.get(c.folderId) ?? { total: 0, mastered: 0, due: 0 };
    s.total += 1;
    if (masteryOf(c.repetitions, c.lastReviewedAt) === "mastered") s.mastered += 1;
    if (c.nextReviewAt.getTime() <= now.getTime()) s.due += 1;
    out.set(c.folderId, s);
  }
  return out;
}

export function isStale(lastSyncedAt: Date | null, now: Date): boolean {
  if (!lastSyncedAt) return true;
  return now.getTime() - lastSyncedAt.getTime() > STALE_AFTER_MS;
}
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test src/lib/calendar-events.test.ts`
Expected: `pass 11`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-events.ts src/lib/calendar-events.test.ts
git commit -m "feat: add the pure helpers behind home's calendar strip

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt"
```

---

### Task 3: Classify and match events in the parse step

**Files:**
- Create: `src/lib/mcp/calendar-schema.ts`
- Create: `src/lib/mcp/calendar-schema.test.ts`
- Modify: `src/lib/mcp/calendar.ts:30-70` (replace `parsedEventSchema`, `parsedEventsResponseSchema`, `PARSE_EVENTS_SYSTEM_PROMPT`, `parseEventsList`)
- Modify: `src/app/api/integrations/calendar/events/route.ts:17` (pass `[]` as course names)

**Interfaces:**
- Consumes: `CALENDAR_EVENT_KINDS`, `CalendarEventKind` from Task 2.
- Produces:
  ```ts
  // calendar-schema.ts
  export type ParsedEvent = { title: string; start: string; end?: string; location?: string; kind: CalendarEventKind; course: string | null };
  export function parsedEventSchema(courseNames: string[]): z.ZodType<ParsedEvent>;
  export const parsedEventsEnvelopeSchema: z.ZodType<{ events: unknown[] }>;
  export function buildParseEventsSystemPrompt(courseNames: string[]): string;
  // calendar.ts
  export async function parseEventsList(listingText: string, courseNames: string[]): Promise<ParsedEvent[]>;
  export type { ParsedEvent };
  ```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/mcp/calendar-schema.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsedEventSchema, parsedEventsEnvelopeSchema, buildParseEventsSystemPrompt } from "./calendar-schema.ts";

const courses = ["Thermodynamics", "Linear Algebra"];

test("a classified, matched event parses", () => {
  const out = parsedEventSchema(courses).parse({
    title: "Midterm",
    start: "2026-09-15T13:00",
    kind: "EXAM",
    course: "Thermodynamics",
  });
  assert.equal(out.kind, "EXAM");
  assert.equal(out.course, "Thermodynamics");
});

test("kind defaults to OTHER and course to null when the model omits them", () => {
  const out = parsedEventSchema(courses).parse({ title: "Dentist", start: "2026-09-16T09:00" });
  assert.equal(out.kind, "OTHER");
  assert.equal(out.course, null);
});

test("a kind outside the enum is rejected", () => {
  const r = parsedEventSchema(courses).safeParse({ title: "x", start: "2026-09-16", kind: "PARTY" });
  assert.equal(r.success, false);
});

test("a course outside the offered list is rejected", () => {
  const r = parsedEventSchema(courses).safeParse({ title: "x", start: "2026-09-16", course: "Chemistry" });
  assert.equal(r.success, false);
});

test("the envelope accepts unknown events so one bad row cannot sink the sync", () => {
  const r = parsedEventsEnvelopeSchema.safeParse({ events: [{ junk: true }, 42] });
  assert.equal(r.success, true);
});

test("the envelope caps the batch", () => {
  const r = parsedEventsEnvelopeSchema.safeParse({ events: new Array(51).fill({}) });
  assert.equal(r.success, false);
});

test("the prompt names every course and the kinds", () => {
  const p = buildParseEventsSystemPrompt(courses);
  assert.match(p, /Thermodynamics/);
  assert.match(p, /Linear Algebra/);
  assert.match(p, /EXAM/);
  assert.match(p, /ASSIGNMENT/);
  assert.match(p, /CLASS/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test src/lib/mcp/calendar-schema.test.ts`
Expected: FAIL, `Cannot find module './calendar-schema.ts'`.

- [ ] **Step 3: Implement the schema module**

Create `src/lib/mcp/calendar-schema.ts`:

```ts
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
```

- [ ] **Step 4: Run schema tests**

Run: `node --import tsx --test src/lib/mcp/calendar-schema.test.ts`
Expected: `pass 7`, `fail 0`.

- [ ] **Step 5: Rewire `calendar.ts`**

In `src/lib/mcp/calendar.ts`, delete the block from `export const parsedEventSchema = z.object({` through the closing brace of `parseEventsList` (lines 30 to 70 in the current file), and replace it with:

```ts
import {
  parsedEventSchema,
  parsedEventsEnvelopeSchema,
  buildParseEventsSystemPrompt,
  type ParsedEvent,
} from "@/lib/mcp/calendar-schema";

export type { ParsedEvent };

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
```

Move the new `import { ... } from "@/lib/mcp/calendar-schema"` up with the other imports. Remove `import { z } from "zod";` and the `UNTRUSTED_CONTENT_CLAUSE` import from `calendar.ts`; nothing else in the file uses them (`createCalendarEvent` does not).

- [ ] **Step 6: Update the existing events route**

In `src/app/api/integrations/calendar/events/route.ts`, change

```ts
const events = await parseEventsList(text).catch(() => []);
```
to
```ts
const events = await parseEventsList(text, []).catch(() => []);
```

- [ ] **Step 7: Type-check, lint, run all tests**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -5
npx eslint src/lib/mcp src/app/api/integrations 2>&1 | tail -5
npm test 2>&1 | tail -6
```
Expected: no tsc errors; lint clean; tests all pass. `IntegrationsManager.tsx` still imports `ParsedEvent` from `@/lib/mcp/calendar` and must still compile.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mcp/calendar-schema.ts src/lib/mcp/calendar-schema.test.ts src/lib/mcp/calendar.ts "src/app/api/integrations/calendar/events/route.ts"
git commit -m "feat: classify calendar events and match them to a course

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt"
```

---

### Task 4: Sync library and route

**Files:**
- Create: `src/lib/calendar-sync.ts`
- Create: `src/app/api/integrations/calendar/sync/route.ts`

**Interfaces:**
- Consumes: `listUpcomingEventsText`, `parseEventsList`, `CALENDAR_SERVER` from `src/lib/mcp/calendar.ts`; `loadMcpServers` from `src/lib/mcp/config.ts`; `externalKeyFor`, `parseEventStart`, `SYNC_WINDOW_DAYS` from Task 2.
- Produces:
  ```ts
  export class CalendarNotConfiguredError extends Error {}
  export async function isCalendarConfigured(): Promise<boolean>;
  export async function syncCalendarEvents(now?: Date): Promise<{ synced: number; syncedAt: Date }>;
  ```

- [ ] **Step 1: Implement the sync library**

Create `src/lib/calendar-sync.ts`:

```ts
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

export async function syncCalendarEvents(now: Date = new Date()): Promise<{ synced: number; syncedAt: Date }> {
  if (!(await isCalendarConfigured())) throw new CalendarNotConfiguredError();

  const folders = await db.folder.findMany({ select: { id: true, name: true } });
  const folderIdByName = new Map(folders.map((f) => [f.name, f.id]));

  const text = await listUpcomingEventsText(SYNC_WINDOW_DAYS);
  const parsed = await parseEventsList(text, folders.map((f) => f.name));

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
  for (const e of parsed) {
    const when = parseEventStart(e.start);
    if (!when) continue;
    if (when.start < windowStart || when.start >= windowEnd) continue;
    const end = e.end ? (parseEventStart(e.end)?.start ?? null) : null;
    const externalKey = externalKeyFor(e.title, e.start);
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

  await db.$transaction([
    ...writes,
    // A cancelled exam disappears; a row outside the window is someone else's.
    db.calendarEvent.deleteMany({
      where: { start: { gte: windowStart, lt: windowEnd }, externalKey: { notIn: keys } },
    }),
  ]);

  return { synced: keys.length, syncedAt };
}
```

- [ ] **Step 2: Implement the route**

Create `src/app/api/integrations/calendar/sync/route.ts`:

```ts
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
```

- [ ] **Step 3: Type-check and lint**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -E "calendar-sync|calendar/sync"; echo "tsc done"
npx eslint src/lib/calendar-sync.ts "src/app/api/integrations/calendar/sync/route.ts"
```
Expected: `tsc done` with no preceding lines; eslint silent.

- [ ] **Step 4: Manual check against the real server**

With `npm run dev` running in another terminal:

```bash
curl -s -X POST http://localhost:3000/api/integrations/calendar/sync
```
Expected with Calendar configured: `{"synced":N,"syncedAt":"..."}`. Without: `{"error":"Google Calendar is not connected. ..."}` and HTTP 409. Then:

```bash
sqlite3 prisma/dev.db 'select kind, count(*) from CalendarEvent group by kind;'
```
Record the numbers; they go in the PR's Verification section.

- [ ] **Step 5: Commit**

```bash
git add src/lib/calendar-sync.ts "src/app/api/integrations/calendar/sync/route.ts"
git commit -m "feat: sync the next two weeks of calendar events into SQLite

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt"
```

---

### Task 5: Course override route

**Files:**
- Modify: `src/lib/validation.ts` (append)
- Create: `src/app/api/calendar-events/[id]/route.ts`

**Interfaces:**
- Produces: `PATCH /api/calendar-events/[id]` with body `{ folderId: string | null }` returning `{ event }`; `updateCalendarEventSchema` in `validation.ts`.

- [ ] **Step 1: Add the schema**

Append to `src/lib/validation.ts`:

```ts
/** PATCH /api/calendar-events/[id]: the student names the course, or clears it. */
export const updateCalendarEventSchema = z.object({
  folderId: z.string().trim().min(1).nullable(),
});
```

- [ ] **Step 2: Implement the route**

Create `src/app/api/calendar-events/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { updateCalendarEventSchema } from "@/lib/validation";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(updateCalendarEventSchema, body);
  if ("error" in result) return result.error;

  const existing = await db.calendarEvent.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return jsonError("Calendar event not found", 404);

  if (result.data.folderId) {
    const folder = await db.folder.findUnique({ where: { id: result.data.folderId }, select: { id: true } });
    if (!folder) return jsonError("Course not found", 404);
  }

  // Pinned from here on: the next sync keeps this choice whatever the
  // classifier says about the same event.
  const event = await db.calendarEvent.update({
    where: { id },
    data: { folderId: result.data.folderId, folderPinned: true },
    include: { folder: { select: { id: true, name: true, color: true } } },
  });
  return NextResponse.json({ event });
}
```

- [ ] **Step 3: Manual check**

With dev running and at least one synced event (`sqlite3 prisma/dev.db 'select id from CalendarEvent limit 1;'`):

```bash
curl -s -X PATCH http://localhost:3000/api/calendar-events/<id> -H 'Content-Type: application/json' -d '{"folderId":"<a folder id>"}'
curl -s -X PATCH http://localhost:3000/api/calendar-events/<id> -H 'Content-Type: application/json' -d '{"folderId":"nope"}'
```
Expected: first returns `{ "event": { ..., "folderPinned": true } }`; second returns 404 `Course not found`. Then re-run the sync from Task 4 and confirm `folderId` on that row is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/lib/validation.ts "src/app/api/calendar-events/[id]/route.ts"
git commit -m "feat: let the student pin a calendar event to a course

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt"
```

---

### Task 6: Today row, mastery ring, course cards, and the new home

**Files:**
- Create: `src/components/home/TodayRow.tsx`
- Create: `src/components/home/MasteryRing.tsx`
- Create: `src/components/home/CourseCard.tsx`
- Modify: `src/app/page.tsx` (rewrite)
- Delete: `src/components/dashboard/StatsRow.tsx`

**Interfaces:**
- Consumes: `computeStreak` from `src/lib/planner.ts`; `masteryByFolder`, `FolderCardStats`, `examCountdown` from Task 2; `folderFamily`, `FOLDER_DOT_CLASSES` from `src/lib/folder-colors.ts`; `shortDate` from `src/lib/format.ts`.
- Produces:
  ```tsx
  export function TodayRow(props: { dueCount: number; streak: number; totalCards: number }): JSX.Element;
  export function MasteryRing(props: { value: number | null; size?: number }): JSX.Element;
  export type CourseCardData = {
    folder: { id: string; name: string; color: string | null };
    stats: FolderCardStats;
    nextExam: { title: string; start: Date } | null;
    lastLectureAt: Date | null;
    now: Date;
  };
  export function CourseCard(props: CourseCardData): JSX.Element;
  ```
  `page.tsx` leaves a `{/* UP NEXT */}` slot that Task 7 fills.

- [ ] **Step 1: TodayRow**

Create `src/components/home/TodayRow.tsx`:

```tsx
import Link from "next/link";
import { CheckCheck, Flame } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function TodayRow({ dueCount, streak, totalCards }: { dueCount: number; streak: number; totalCards: number }) {
  let headline: string;
  if (totalCards === 0) headline = "Nothing due yet";
  else if (dueCount === 0) headline = "All caught up";
  else headline = `${dueCount} card${dueCount === 1 ? "" : "s"} due`;

  const detail = totalCards === 0 ? "record a lecture to get flashcards" : streak > 0 ? `${streak}-day streak` : null;

  return (
    <section
      aria-label="Today"
      className="flex flex-col gap-3 rounded-2xl border border-line bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          {dueCount > 0 ? <Flame className="h-4 w-4" strokeWidth={2} /> : <CheckCheck className="h-4 w-4" strokeWidth={2} />}
        </span>
        <p className="text-[17px] font-semibold leading-6 text-ink">
          {headline}
          {detail && <span className="font-normal text-muted"> · {detail}</span>}
        </p>
      </div>
      {dueCount > 0 && (
        <Link href="/review" className="sm:shrink-0">
          <Button variant="brand" className="w-full sm:w-auto">
            Review {dueCount}
          </Button>
        </Link>
      )}
    </section>
  );
}
```

- [ ] **Step 2: MasteryRing**

Create `src/components/home/MasteryRing.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

/**
 * Mastered share of a course's cards. Navy-soft track, gold arc — one of the
 * two places gold is spent on home. Draws once on mount; under
 * prefers-reduced-motion the transition is off and it renders at its value.
 */
export function MasteryRing({ value, size = 44 }: { value: number | null; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const target = value === null ? 0 : Math.max(0, Math.min(1, value));
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(target));
    return () => cancelAnimationFrame(id);
  }, [target]);

  const label = value === null ? "No cards yet" : `${Math.round(target * 100)}% mastered`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--brand-soft)" strokeWidth={stroke} />
      {value !== null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--gold)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - drawn)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="motion-safe:[transition:stroke-dashoffset_600ms_ease-out]"
        />
      )}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-ink text-[11px] font-semibold tabular-nums"
      >
        {value === null ? "–" : `${Math.round(target * 100)}%`}
      </text>
    </svg>
  );
}
```

- [ ] **Step 3: CourseCard**

Create `src/components/home/CourseCard.tsx`:

```tsx
import Link from "next/link";
import { MasteryRing } from "@/components/home/MasteryRing";
import { examCountdown, type FolderCardStats } from "@/lib/calendar-events";
import { folderFamily, FOLDER_DOT_CLASSES } from "@/lib/folder-colors";
import { shortDate } from "@/lib/format";
import clsx from "@/lib/clsx";

export type CourseCardData = {
  folder: { id: string; name: string; color: string | null };
  stats: FolderCardStats;
  nextExam: { title: string; start: Date } | null;
  lastLectureAt: Date | null;
  now: Date;
};

export function CourseCard({ folder, stats, nextExam, lastLectureAt, now }: CourseCardData) {
  const value = stats.total > 0 ? stats.mastered / stats.total : null;
  const family = folderFamily(folder.color);

  return (
    <Link
      href={`/folders/${folder.id}`}
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[15px] font-semibold leading-5 text-ink">
            <span className={clsx("h-2 w-2 shrink-0 rounded-full", FOLDER_DOT_CLASSES[family])} aria-hidden="true" />
            <span className="truncate">{folder.name}</span>
          </p>
          <p className="mt-1 text-[13px] text-muted">
            {stats.total === 0 ? "No cards yet" : stats.due > 0 ? `${stats.due} due` : "Nothing due"}
          </p>
        </div>
        <MasteryRing value={value} />
      </div>
      <div className="flex items-center justify-between gap-3 text-[13px]">
        {nextExam ? (
          <span className="truncate text-ink-soft">
            {nextExam.title} · <span className="font-semibold text-gold">{examCountdown(nextExam.start, now)}</span>
          </span>
        ) : (
          <span className="text-muted-2">No exam scheduled</span>
        )}
        {lastLectureAt && <span className="shrink-0 text-muted-2">{shortDate(lastLectureAt)}</span>}
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Rewrite `src/app/page.tsx`**

Replace the whole file with:

```tsx
import { db } from "@/lib/db";
import { NewPageButton } from "@/components/dashboard/NewPageButton";
import { ImportButton } from "@/components/dashboard/ImportButton";
import { TodayRow } from "@/components/home/TodayRow";
import { CourseCard } from "@/components/home/CourseCard";
import { computeStreak } from "@/lib/planner";
import { masteryByFolder } from "@/lib/calendar-events";

// This page reads directly from the local SQLite DB via Prisma, which Next
// can't see as a "dynamic" data source -- without this it gets frozen as
// static HTML at build time and never reflects new pages under `next start`.
export const dynamic = "force-dynamic";

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const now = new Date();

  const [folders, cards, logs, dueCount, exams] = await Promise.all([
    db.folder.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        color: true,
        pages: { orderBy: { updatedAt: "desc" }, take: 1, select: { updatedAt: true } },
      },
    }),
    db.flashcard.findMany({
      select: {
        repetitions: true,
        lastReviewedAt: true,
        nextReviewAt: true,
        page: { select: { folderId: true } },
        material: { select: { folderId: true } },
      },
    }),
    // Counts events for the streak and never scores them, so pre-ledger rows belong in it.
    db.reviewLog.findMany({ orderBy: { reviewedAt: "desc" }, take: 500, select: { reviewedAt: true } }),
    db.flashcard.count({ where: { nextReviewAt: { lte: now } } }),
    db.calendarEvent.findMany({
      where: { kind: "EXAM", start: { gte: now }, folderId: { not: null } },
      orderBy: { start: "asc" },
      select: { folderId: true, title: true, start: true },
    }),
  ]);

  const stats = masteryByFolder(
    cards.map((c) => ({
      repetitions: c.repetitions,
      lastReviewedAt: c.lastReviewedAt,
      nextReviewAt: c.nextReviewAt,
      folderId: c.page?.folderId ?? c.material?.folderId ?? null,
    })),
    now
  );
  const streak = computeStreak(logs.map((l) => l.reviewedAt), now);
  const nextExamByFolder = new Map<string, { title: string; start: Date }>();
  for (const e of exams) {
    if (e.folderId && !nextExamByFolder.has(e.folderId)) {
      nextExamByFolder.set(e.folderId, { title: e.title, start: e.start });
    }
  }

  const dateLine = now.toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-2">{dateLine}</p>
          <h1 className="mt-1 text-[28px] font-semibold leading-8 tracking-tight text-ink">{greeting(now)}</h1>
        </div>
        <div className="flex items-center gap-2">
          <ImportButton />
          <NewPageButton />
        </div>
      </header>

      {folders.length === 0 ? (
        <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-16 text-center">
          <p className="text-[15px] font-semibold text-ink">Create your first course</p>
          <p className="max-w-xs text-[13px] leading-5 text-muted-2">
            Courses hold lectures, materials, and the flashcards made from them. Use the plus beside “Your courses” in the sidebar.
          </p>
        </section>
      ) : (
        <>
          <TodayRow dueCount={dueCount} streak={streak} totalCards={cards.length} />

          {/* UP NEXT */}

          <section aria-labelledby="courses-heading" className="flex flex-col gap-3">
            <h2 id="courses-heading" className="text-[13px] font-semibold text-ink-soft">
              Courses
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {folders.map((f) => (
                <CourseCard
                  key={f.id}
                  folder={{ id: f.id, name: f.name, color: f.color }}
                  stats={stats.get(f.id) ?? { total: 0, mastered: 0, due: 0 }}
                  nextExam={nextExamByFolder.get(f.id) ?? null}
                  lastLectureAt={f.pages[0]?.updatedAt ?? null}
                  now={now}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Delete StatsRow and check nothing else imports it**

Run: `grep -rn "StatsRow" src`
Expected: only `src/components/dashboard/StatsRow.tsx` itself. Then:

```bash
git rm src/components/dashboard/StatsRow.tsx
```

- [ ] **Step 6: Type-check, lint, look at it**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -E "home/|app/page.tsx"; echo "tsc done"
npx eslint src/components/home src/app/page.tsx
```
Expected: `tsc done` alone; eslint silent. Open http://localhost:3000 with dev running: header with date and greeting, Today row, course cards with rings. Toggle dark mode; ring track and gold arc stay visible. Set the OS to reduce motion (macOS: System Settings › Accessibility › Display › Reduce motion) and reload: ring appears without drawing.

- [ ] **Step 7: Commit**

```bash
git add src/components/home/TodayRow.tsx src/components/home/MasteryRing.tsx src/components/home/CourseCard.tsx src/app/page.tsx
git commit -m "feat: open home on today and the courses, not the lecture list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt"
```

(`git rm` already staged the deletion.)

---

### Task 7: Up next strip, course picker, and stale sync trigger

**Files:**
- Create: `src/components/home/CoursePicker.tsx`
- Create: `src/components/home/UpNext.tsx`
- Create: `src/components/home/CalendarSyncTrigger.tsx`
- Modify: `src/app/page.tsx` (fill the `{/* UP NEXT */}` slot, add three reads)

**Interfaces:**
- Consumes: `groupByDay`, `inRecordWindow`, `examCountdown`, `isStale`, `HOME_WINDOW_DAYS` from Task 2; `isCalendarConfigured` from Task 4; PATCH route from Task 5; `POST /api/pages` (existing).
- Produces:
  ```tsx
  export type UpNextEvent = {
    id: string; title: string; start: string; allDay: boolean;
    kind: "EXAM" | "ASSIGNMENT" | "CLASS" | "OTHER";
    folder: { id: string; name: string; color: string | null } | null;
  };
  export function UpNext(props: {
    events: UpNextEvent[];
    folders: { id: string; name: string }[];
    configured: boolean;
    lastSyncedAt: string | null;
    now: string;
  }): JSX.Element | null;
  export function CoursePicker(props: { eventId: string; folders: { id: string; name: string }[]; open: boolean; onClose: () => void }): JSX.Element;
  export function CalendarSyncTrigger(props: { stale: boolean }): null;
  ```
  Dates cross the server/client boundary as ISO strings.

- [ ] **Step 1: CoursePicker**

Create `src/components/home/CoursePicker.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

export function CoursePicker({
  eventId,
  folders,
  open,
  onClose,
}: {
  eventId: string;
  folders: { id: string; name: string }[];
  open: boolean;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function pick(folderId: string) {
    setSaving(folderId);
    setError(null);
    const res = await fetch(`/api/calendar-events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    setSaving(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Could not save the course");
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add to course">
      <div className="flex flex-col gap-1">
        {folders.map((f) => (
          <Button key={f.id} variant="ghost" className="justify-start" disabled={saving !== null} onClick={() => pick(f.id)}>
            {f.name}
          </Button>
        ))}
        {folders.length === 0 && <p className="text-[13px] text-muted-2">No courses yet.</p>}
        {error && <p className="text-[13px] font-medium text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: UpNext**

Create `src/components/home/UpNext.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CoursePicker } from "@/components/home/CoursePicker";
import { groupByDay, inRecordWindow, examCountdown } from "@/lib/calendar-events";
import { folderFamily, FOLDER_CHIP_CLASSES } from "@/lib/folder-colors";
import clsx from "@/lib/clsx";

export type UpNextEvent = {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
  kind: "EXAM" | "ASSIGNMENT" | "CLASS" | "OTHER";
  folder: { id: string; name: string; color: string | null } | null;
};

function timeLabel(start: Date, allDay: boolean): string {
  if (allDay) return "All day";
  return start.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function sinceLabel(iso: string, now: Date): string {
  const mins = Math.max(1, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

export function UpNext({
  events,
  folders,
  configured,
  lastSyncedAt,
  now: nowIso,
}: {
  events: UpNextEvent[];
  folders: { id: string; name: string }[];
  configured: boolean;
  lastSyncedAt: string | null;
  now: string;
}) {
  const now = new Date(nowIso);
  const router = useRouter();
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [recording, setRecording] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  if (!configured) {
    return (
      <p className="text-[13px] text-muted-2">
        <Link href="/integrations" className="font-medium text-brand-ink hover:underline">
          Connect Google Calendar
        </Link>{" "}
        to see exams and classes here.
      </p>
    );
  }

  // Synced and quiet: nothing to say, so say nothing.
  if (events.length === 0 && lastSyncedAt !== null) return null;

  const groups = groupByDay(
    events.map((e) => ({ ...e, start: new Date(e.start) })),
    now
  );

  async function record(e: UpNextEvent) {
    setRecording(e.id);
    setRowError((r) => ({ ...r, [e.id]: "" }));
    try {
      const res = await fetch("/api/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: e.title, folderId: e.folder?.id }),
      });
      if (!res.ok) throw new Error();
      const { page } = await res.json();
      router.push(`/pages/${page.id}?record=1`);
    } catch {
      setRowError((r) => ({ ...r, [e.id]: "Could not create the page" }));
      setRecording(null);
    }
  }

  async function retry() {
    setRetrying(true);
    setRetryError(null);
    const res = await fetch("/api/integrations/calendar/sync", { method: "POST" });
    setRetrying(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setRetryError(body.error ?? "Sync failed");
      return;
    }
    router.refresh();
  }

  return (
    <section aria-labelledby="up-next-heading" className="flex flex-col gap-3">
      <h2 id="up-next-heading" className="text-[13px] font-semibold text-ink-soft">
        Up next
      </h2>
      {groups.length > 0 && (
        <ol className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
          {groups.map((g) =>
            g.events.map((e, i) => {
              const family = folderFamily(e.folder?.color);
              const canRecord = e.kind === "CLASS" && inRecordWindow(e.start, now);
              return (
                <li key={e.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-20 shrink-0 text-[13px] font-semibold text-ink-soft">{i === 0 ? g.label : ""}</span>
                  <span className="w-14 shrink-0 text-[13px] tabular-nums text-muted">{timeLabel(e.start, e.allDay)}</span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {e.folder ? (
                      <span className={clsx("truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold", FOLDER_CHIP_CLASSES[family])}>
                        {e.folder.name}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPickerFor(e.id)}
                        className="text-[11px] font-medium text-muted-2 hover:text-brand-ink"
                      >
                        Add to course
                      </button>
                    )}
                    <span className="truncate text-[15px] text-ink">{e.title}</span>
                  </span>
                  {e.kind === "EXAM" && (
                    <span className="shrink-0 text-[13px] font-semibold text-gold">{examCountdown(e.start, now)}</span>
                  )}
                  {canRecord && (
                    <Button size="sm" variant="brand" disabled={recording === e.id} onClick={() => record(e)}>
                      <Mic className="h-3.5 w-3.5" strokeWidth={2.2} />
                      Record
                    </Button>
                  )}
                  {rowError[e.id] && <span className="text-[12px] font-medium text-red-700">{rowError[e.id]}</span>}
                </li>
              );
            })
          )}
        </ol>
      )}
      <div className="flex items-center justify-between text-[12px] text-muted-2">
        <span>
          {lastSyncedAt ? `Last synced ${sinceLabel(lastSyncedAt, now)}` : "Not synced yet"} ·{" "}
          <button type="button" onClick={retry} disabled={retrying} className="font-medium hover:text-brand-ink">
            {retrying ? "Syncing…" : "Retry"}
          </button>
          {retryError && <span className="ml-2 text-red-700">{retryError}</span>}
        </span>
        <Link href="/planner" className="font-medium hover:text-brand-ink">
          Planner ›
        </Link>
      </div>
      {pickerFor && <CoursePicker eventId={pickerFor} folders={folders} open onClose={() => setPickerFor(null)} />}
    </section>
  );
}
```

- [ ] **Step 3: CalendarSyncTrigger**

Create `src/components/home/CalendarSyncTrigger.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const SKIP_KEY = "lectern:calendar-unconfigured";

/**
 * Fires one sync when the server said the newest row is stale, then refreshes
 * the page so the server component re-reads. A 409 (not configured) is
 * remembered for the tab's session so home stops asking.
 */
export function CalendarSyncTrigger({ stale }: { stale: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!stale) return;
    try {
      if (sessionStorage.getItem(SKIP_KEY) === "1") return;
    } catch {
      // Storage may be unavailable; a sync attempt is harmless.
    }
    let cancelled = false;
    fetch("/api/integrations/calendar/sync", { method: "POST" })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 409) {
          try {
            sessionStorage.setItem(SKIP_KEY, "1");
          } catch {
            // ignore
          }
          return;
        }
        if (res.ok) router.refresh();
        else console.warn("[calendar] background sync failed", res.status);
      })
      .catch((e) => console.warn("[calendar] background sync failed", e));
    return () => {
      cancelled = true;
    };
  }, [stale, router]);

  return null;
}
```

- [ ] **Step 4: Wire into `src/app/page.tsx`**

Replace the import line `import { masteryByFolder } from "@/lib/calendar-events";` with:

```tsx
import { HOME_WINDOW_DAYS, isStale, masteryByFolder } from "@/lib/calendar-events";
import { UpNext, type UpNextEvent } from "@/components/home/UpNext";
import { CalendarSyncTrigger } from "@/components/home/CalendarSyncTrigger";
import { isCalendarConfigured } from "@/lib/calendar-sync";
```

Extend the `Promise.all` with three more reads after `exams`:

```tsx
    db.calendarEvent.findMany({
      where: {
        start: {
          gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
          lt: new Date(now.getTime() + HOME_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        },
        OR: [{ kind: { not: "OTHER" } }, { folderId: { not: null } }],
      },
      orderBy: { start: "asc" },
      take: 6,
      include: { folder: { select: { id: true, name: true, color: true } } },
    }),
    db.calendarEvent.aggregate({ _max: { syncedAt: true } }),
    isCalendarConfigured(),
```
and change the destructuring to `const [folders, cards, logs, dueCount, exams, upcoming, lastSync, calendarConfigured] = await Promise.all([`.

After `nextExamByFolder` is built, add:

```tsx
  const upNextEvents: UpNextEvent[] = upcoming.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start.toISOString(),
    allDay: e.allDay,
    kind: e.kind,
    folder: e.folder,
  }));
  const lastSyncedAt = lastSync._max.syncedAt;
  const stale = calendarConfigured && isStale(lastSyncedAt, now);
```

Replace `{/* UP NEXT */}` with:

```tsx
          <UpNext
            events={upNextEvents}
            folders={folders.map((f) => ({ id: f.id, name: f.name }))}
            configured={calendarConfigured}
            lastSyncedAt={lastSyncedAt ? lastSyncedAt.toISOString() : null}
            now={now.toISOString()}
          />
          <CalendarSyncTrigger stale={stale} />
```

- [ ] **Step 5: Type-check, lint, look at it**

Run:
```bash
npx tsc --noEmit 2>&1 | grep -E "home/|app/page.tsx"; echo "tsc done"
npx eslint src/components/home src/app/page.tsx
```
Expected: clean. In the browser:
1. With Calendar configured and stale rows (or none): first load shows the strip from SQLite, a second or two later the page refreshes with fresh rows. Network tab shows one POST to `/api/integrations/calendar/sync`.
2. Reload within 30 minutes: no POST.
3. Rename `mcp.config.json` temporarily: strip shows the one-line "Connect Google Calendar" message; a single POST returns 409; reload shows no further POST. Rename it back.
4. On an event with no course, click "Add to course", pick one: row shows the chip after refresh; `sqlite3 prisma/dev.db 'select folderPinned from CalendarEvent where id=...'` returns 1.
5. Resize to 400px wide: rows stack, nothing scrolls sideways.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/UpNext.tsx src/components/home/CoursePicker.tsx src/components/home/CalendarSyncTrigger.tsx src/app/page.tsx
git commit -m "feat: show the week's exams, deadlines and classes on home

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt"
```

---

### Task 8: Record from a class row

**Files:**
- Modify: `src/components/recording/RecordingPanel.tsx:1-60`

**Interfaces:**
- Consumes: `?record=1` appended by `UpNext.record` in Task 7; `startRecording` and `status` from `useMediaRecorder`.
- Produces: nothing new; the panel starts recording once when the flag is present and strips it from the URL.

- [ ] **Step 1: Read the flag once and start**

In `src/components/recording/RecordingPanel.tsx`:

Change the React import to include `useEffect`:
```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
```
Change the navigation import to:
```tsx
import { usePathname, useRouter, useSearchParams } from "next/navigation";
```

After the `useMediaRecorder` destructuring and the `const router = useRouter();` line, add:

```tsx
  // Arriving from a class row on home: start the mic straight away, then drop
  // the flag from the URL so a reload or back-navigation does not start again.
  // The permission prompt happens here, on the lecture page, not on home.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    if (searchParams.get("record") !== "1") return;
    if (status !== "idle") return;
    autoStarted.current = true;
    void startRecording();
    router.replace(pathname);
  }, [searchParams, pathname, router, startRecording, status]);
```

Check the recorder's idle status literal first: run `grep -n '"idle"' src/components/recording/useMediaRecorder.ts`. If the hook uses a different literal for its initial state, use that literal in the `status !== ...` guard.

- [ ] **Step 2: Type-check and lint**

Run:
```bash
npx tsc --noEmit 2>&1 | grep RecordingPanel; echo "tsc done"
npx eslint src/components/recording/RecordingPanel.tsx
```
Expected: clean.

- [ ] **Step 3: Manual check**

With dev running, open `http://localhost:3000/pages/<any page id without audio>?record=1`. Expected: the browser asks for the microphone (first time), the timer starts, the URL loses `?record=1`. Reload: the recorder is idle. Then the real path: create a calendar event on the primary Google calendar titled after a course, e.g. "Thermodynamics lecture", starting five minutes from now; press Retry on home; confirm the row shows `Record`; click it. Expected: a new page titled "Thermodynamics lecture" filed in that course, mic live.

- [ ] **Step 4: Commit**

```bash
git add src/components/recording/RecordingPanel.tsx
git commit -m "feat: start recording when a class row on home opens the lecture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt"
```

---

### Task 9: Full calendar on the Planner

**Files:**
- Modify: `src/app/planner/page.tsx` (add two reads and one section after "Next 7 days")

**Interfaces:**
- Consumes: `groupByDay`, `SYNC_WINDOW_DAYS` from Task 2; `isCalendarConfigured` from Task 4.

- [ ] **Step 1: Add the reads**

In `src/app/planner/page.tsx`, add imports:

```tsx
import { groupByDay, SYNC_WINDOW_DAYS } from "@/lib/calendar-events";
import { isCalendarConfigured } from "@/lib/calendar-sync";
import { folderFamily, FOLDER_CHIP_CLASSES } from "@/lib/folder-colors";
```

Extend the `Promise.all` with two entries at the end:

```tsx
    db.calendarEvent.findMany({
      where: {
        start: {
          gte: startOfToday,
          lt: new Date(startOfToday.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { start: "asc" },
      include: { folder: { select: { id: true, name: true, color: true } } },
    }),
    isCalendarConfigured(),
```
destructured as `events, calendarConfigured` at the end of the existing list.

After the `const calibrated = calibration(rated);` line add:

```tsx
  const eventGroups = groupByDay(events, now);
  const KIND_LABEL: Record<string, string> = { EXAM: "Exam", ASSIGNMENT: "Due", CLASS: "Class", OTHER: "" };
```

- [ ] **Step 2: Add the section**

After the closing `</div>` of the "Upcoming 7-day schedule" card, add:

```tsx
      {/* Calendar: everything the sync pulled, not just the academic subset home shows. */}
      <div className="rounded-2xl border border-line/80 bg-surface p-5">
        <h2 className="mb-4 text-sm font-semibold text-ink">Calendar, next {SYNC_WINDOW_DAYS} days</h2>
        {!calendarConfigured ? (
          <p className="text-[13px] text-muted-2">
            <Link href="/integrations" className="font-medium text-brand-ink hover:underline">
              Connect Google Calendar
            </Link>{" "}
            to see your classes, deadlines and exams here.
          </p>
        ) : eventGroups.length === 0 ? (
          <p className="text-[13px] text-muted-2">Nothing on the calendar in this window.</p>
        ) : (
          <ol className="flex flex-col gap-4">
            {eventGroups.map((g) => (
              <li key={g.key}>
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-2">{g.label}</p>
                <ul className="flex flex-col gap-1.5">
                  {g.events.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 text-[13px]">
                      <span className="w-12 shrink-0 tabular-nums text-muted">
                        {e.allDay
                          ? "All day"
                          : e.start.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false })}
                      </span>
                      {e.folder && (
                        <span
                          className={clsx(
                            "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                            FOLDER_CHIP_CLASSES[folderFamily(e.folder.color)]
                          )}
                        >
                          {e.folder.name}
                        </span>
                      )}
                      <span className="truncate text-ink">{e.title}</span>
                      {KIND_LABEL[e.kind] && (
                        <span className="ml-auto shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                          {KIND_LABEL[e.kind]}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
```

- [ ] **Step 3: Type-check, lint, look**

Run:
```bash
npx tsc --noEmit 2>&1 | grep planner; echo "tsc done"
npx eslint src/app/planner/page.tsx
```
Open `/planner`: the new card lists every synced event, including OTHER ones that home hides.

- [ ] **Step 4: Commit**

```bash
git add src/app/planner/page.tsx
git commit -m "feat: list the whole synced calendar on the planner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt"
```

---

### Task 10: Docs, full verification, PR

**Files:**
- Modify: `README.md:110-135` ("Using it", Integrations bullet)

- [ ] **Step 1: README**

In the "Using it" section, replace step 7's line

```
7. Organize with folders (sidebar) and tags (page header); **Search** looks across transcripts, notes, and flashcards.
```
with
```
7. Organize with courses (sidebar) and tags (page header); **Search** looks across transcripts, notes, and flashcards. **Home** opens on today: cards due, your streak, the week's exams, deadlines and classes from Google Calendar, and one card per course with how much of it you have mastered.
```

Replace the Google Calendar integration bullet (line 132) with:

```
  - **Google Calendar**: the next two weeks are synced into Lectern and classified as exam, assignment, class or other, each matched to one of your courses by name (fix a match from the row itself). Home shows the academic ones; the Planner shows everything. A class that is about to start gets a one-click **Record** that opens a pre-titled lecture page with the mic live. You can still push "Review flashcards (N due)" study blocks into the calendar from Integrations.
```

- [ ] **Step 2: Full check**

Run:
```bash
npm test 2>&1 | tail -6
npx eslint 2>&1 | tail -3
npx tsc --noEmit 2>&1 | tail -3
```
Expected: all tests pass (previous count plus 18 new), lint 0 errors, tsc 0 errors. If tsc shows `never`-typed relation errors, run `npx prisma generate` and re-run; they are a stale client, not this branch.

- [ ] **Step 3: Reviews**

Run the `ecc:react-reviewer` and `ecc:security-reviewer` agents over the branch diff (`git diff main...HEAD`). Ask each to report everything; fix what is real (at minimum: any unguarded `folderId` write, any `dangerouslySetInnerHTML`, any missing `key`, any effect that can fire twice). Commit fixes as `fix: <what>`.

- [ ] **Step 4: Commit docs and open the PR**

```bash
git add README.md
git commit -m "docs: describe the home page and the calendar sync

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt"
git push -u origin feat/home-up-next
```

Invoke the `pr-create` skill for the description (CloudNation narrative format per `AGENTS.md`). Title:

```
feat(home, calendar): open on today and sync the week's exams and classes
```

The Verification section must carry the real numbers from Task 4 step 4 (events synced per kind), the test count, and which manual checks from Tasks 7 and 8 were performed. End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GGgv73gn9mRByHxvoK8MBt
```

---

## Self-review

**Spec coverage**
- §2 data model, sync, reads, staleness, override, not-doing: Tasks 1, 4, 5, 6, 7. Planner read: Task 9.
- §3 Today row, Up next (grouping, chip, gold countdown, Record window, Add to course, unconfigured line, hidden when synced-and-empty, Planner link), Courses grid, ring, type/space/motion, narrow widths: Tasks 6, 7. Before the first sync the strip shows "Not synced yet · Retry" instead of hiding, so the student is never left with silence and no way to act.
- §4 queries: `page.tsx` makes one `Promise.all` of SQLite reads plus one file read; no embeddings. Record via `?record=1`: Task 8. Course picker with `Modal`: Task 7.
- §5 every state row has a home: first run (Task 6), no cards (TodayRow), unconfigured (UpNext), sync fails (Retry line, one warn), classifier junk (Task 3), page create fails (row error), reduced motion (ring). "Sync running" spinner is not implemented: the background trigger is silent and the Retry button reads "Syncing…" while pressed. Deliberate, a spinner on a one-second background refresh is motion for its own sake.
- §6 tests: Task 2 (11), Task 3 (7). Sync manual: Task 4.
- §7 files: `CoursePicker.tsx` added beyond the spec's list. `validation.ts` changed as listed.
- §8 migration safety: Task 1.

**Placeholders**: none. Every code step is complete.

**Type consistency**: `FolderCardStats` used in Task 2 and Task 6 with the same three fields. `UpNextEvent.kind` literal union matches `CalendarEventKind`. `ParsedEvent` defined once in `calendar-schema.ts` and re-exported from `calendar.ts` so `IntegrationsManager.tsx`'s existing import keeps working. `parseEventsList(text, courseNames)` called with two arguments in both callers. `isCalendarConfigured` imported from `calendar-sync.ts` in both `page.tsx` and `planner/page.tsx`. `isAcademic` is exported and tested but the home query expresses the same filter in Prisma `where`; it stays for the planner or any later in-memory filter.
