# Home + Up next — design

Date: 2026-09-11
Status: Approved design, awaiting implementation plan
Branch: `feat/home-up-next`

## 1. Purpose

The home page lists every lecture flat under four vanity counts. It answers
"what have I captured" when the student opening the app most days of a term
needs "what should I do right now". This redesign makes home answer that in one
glance and then defer to the courses.

Google Calendar is already connected over MCP, but its events live behind a
"Load events" button on the Integrations page, are re-fetched and re-parsed on
every click, and know nothing about courses. This design persists them,
classifies them, ties them to courses, and puts exams, assignments, and classes
on home.

Thesis: home answers "what should I do right now" in one glance. One signature
element, the course card's mastery ring. Everything else quiet, in line with the
"quiet institutional" direction in `docs/design-system.md`.

Decisions taken during brainstorming:

- Home body below "Today" is course cards. The flat lecture list moves off home;
  it already exists on every course page.
- "Up next" shows academic events only: those tied to a course, or classified
  exam, assignment, or class. The Planner shows the whole window.
- Calendar events are persisted and revalidated when stale (approach A), not
  fetched live on render (B, blocks home on an `npx` cold start plus a model
  call) and not synced by a background loop (C, a second process for a local
  app).

## 2. Data

New model, one additive migration. No existing table changes.

```prisma
enum CalendarEventKind {
  EXAM
  ASSIGNMENT
  CLASS
  OTHER
}

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

`Folder` gains `calendarEvents CalendarEvent[]`. Deleting a course sets
`folderId` null on its events and never deletes them.

### Sync — `POST /api/integrations/calendar/sync`

1. Pull 14 days through the existing `listUpcomingEventsText` in
   `src/lib/mcp/calendar.ts`.
2. The parse prompt in the same file gains two fields per event: `kind` (one of
   the enum) and `course` (one of the folder names passed into the prompt, or
   null). The zod schema rejects an unknown `kind` (the event is skipped) and
   reads an unknown `course` as null (the event stays, unmatched). One
   `console.warn` per sync.
3. Upsert by `externalKey`. Rows whose `start` falls inside the window and that
   this sync did not return are deleted, so a cancelled exam disappears. Rows
   with `folderPinned` keep their `folderId` regardless of what the classifier
   says. The prune runs only when every event parsed; one rejection skips it,
   so a pinned row is never deleted by a classifier fumble.
4. Returns `{ synced: number, syncedAt: string }`.

Calendar not configured (no `google-calendar` server in `mcp.config.json`):
409 with a plain message. The client remembers the 409 for the session and does
not retry.

### Reads

- Home "Up next": `start` in the next 7 days and (`kind != OTHER` or
  `folderId != null`), ordered by `start`, at most 6 rows.
- Course cards: next `EXAM` per folder, `start >= now`.
- Planner: the full 14 days, every kind.

### Staleness

If `max(syncedAt)` is older than 30 minutes, a small client component on home
fires one sync and then `router.refresh()`. Existing rows stay on screen
meanwhile. No timers, no cron.

### Override — `PATCH /api/calendar-events/[id]`

Body `{ folderId: string | null }`. Sets `folderPinned: true`. Validated with
zod like every other route.

### Not doing

Two-way writes from this table, recurring-rule expansion (the MCP listing is
already expanded), multiple calendars, per-event notifications.

## 3. Home layout

```
┌──────────────────────────────────────────────────────────────┐
│ THURSDAY 11 SEPTEMBER                        [Import] [New]  │  eyebrow
│ Good afternoon                                               │  large title
│                                                              │
│ ┌── Today ───────────────────────────────────────────────┐   │
│ │ ● 24 cards due · 6-day streak              [Review 24] │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                              │
│ Up next                                                      │
│ Today     14:00  Thermodynamics · Lecture 7        [Record]  │  CLASS in window
│ Tomorrow  09:00  Linear Algebra · Problem set 3 due          │  ASSIGNMENT
│ Mon 15    13:00  Thermodynamics · Midterm     in 4 days      │  EXAM, gold countdown
│ ────────────────────────────────────────── Planner ›         │
│                                                              │
│ Courses                                                      │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐                 │
│ │ ◔ 62%      │ │ ◑ 40%      │ │ ○ –        │                 │
│ │ Thermo     │ │ Lin Alg    │ │ History    │                 │
│ │ 12 due     │ │ 9 due      │ │ No cards   │                 │
│ │ Exam Mon   │ │            │ │            │                 │
│ └────────────┘ └────────────┘ └────────────┘                 │
└──────────────────────────────────────────────────────────────┘
```

### Today row

Replaces `StatsRow`, which is deleted. The lecture, flashcard, and quiz counts
go; they described the library, not the day. Content: due count, streak from
`computeStreak` in `src/lib/planner.ts`, one primary button "Review N" linking
to `/review`. Zero due reads "All caught up · 6-day streak" with no button.

### Up next

Grouped by local day, max 6 rows, 7-day window, academic filter from §2. A row
is: time (or "All day"), course chip in the folder colour, title, and for an
EXAM a right-aligned countdown in gold text with no fill. Gold is the one
accent and this is where it is spent.

A CLASS row whose `start` is between 15 minutes ahead and 30 minutes behind
`now` shows a `Record` button (§4). Outside that window the row is inert
except for the course picker.

An event with no course shows a muted "Add to course" text button that opens
the course picker.

Calendar not configured: the section collapses to one muted line, "Connect
Google Calendar to see exams and classes here", linking to `/integrations`.
Configured with zero academic events in the window: the section is hidden.

A "Planner ›" link closes the section.

### Courses

Grid: three columns at 1024px, two at 640px, one below. A card is the mastery
ring, course name, due count, next exam line when one exists, and the
`updatedAt` of the latest lecture as a muted date. No status badges, no icon
tiles. Clicking the card opens the course page.

Ring: 44px, navy track, gold arc, percentage in 13px tabular figures inside.
Value is `mastered / total` from `masteryOf` in `src/lib/mastery.ts`. A course
with no cards renders a hollow ring and "No cards yet".

### Type, space, motion

`--font-geist-sans` stays. Weights regular and semibold only. Scale
28 / 17 / 15 / 13 / 11 px. Section spacing 40px, in-section 12px. Card hover
lifts are removed in favour of a border darken. The ring draws once on mount;
under `prefers-reduced-motion` it renders at its final value.

Below 640px the Today row stacks, Up next rows put the time on a second line,
Courses go to one column. Nothing scrolls sideways.

## 4. Course card data and the Record action

### Queries

Home renders in three SQLite round trips:

1. `db.folder.findMany` with `_count.pages` and the latest page `updatedAt`.
2. One `db.flashcard.findMany` selecting `repetitions`, `nextReviewAt`,
   `page.folderId`, `material.folderId`. Per folder in JS: `total`, `mastered`
   (`masteryOf(...) === "mastered"`), `due` (`nextReviewAt <= now`). Cards with
   no course are ignored on home.
3. `db.calendarEvent.findMany` for `kind = EXAM`, `start >= now`, ordered by
   `start`, reduced to the first per `folderId`.

No embeddings, no coverage scoring. Home never loads the embedding model.

### Record

`POST /api/pages` already accepts `{ title, folderId }`. The row posts the
event title and its `folderId`, then navigates to `/pages/[id]?record=1`.
`RecordingPanel` reads that flag once and calls its existing start handler, so
the student lands with the mic live. The browser's microphone prompt therefore
happens on the lecture page, in context, not on home. If the create fails the
row shows "Could not create the page" inline and stays clickable.

### Course picker

Lists folders; picking one PATCHes the event with `folderPinned`. Uses the
existing `Modal` component unless a popover primitive exists by then.

### Not on home

Open misconceptions, uncovered topics, quiz counts. All already live on the
course page, and coverage costs an embedding pass per course.

## 5. States

| State | What the student sees |
|---|---|
| First run, no courses | Large title, one card "Create your first course" with a primary button. Today row and Up next hidden. |
| Courses, no cards anywhere | Today row reads "Nothing due yet · record a lecture to get flashcards". Rings hollow. |
| Calendar not configured | Up next is one muted line linking to Integrations. Never a red box. |
| Calendar configured, sync fails | Rows from the last sync stay, plus a muted "Last synced 3 h ago · Retry" line. One `console.warn`. No alert. |
| Sync running | Existing rows unchanged, small spinner beside the section label. No skeleton flash. |
| Classifier returns junk | Zod rejects the event, it is skipped, the rest upsert. One warn per sync. |
| Page create for Record fails | Inline error on that row, row stays clickable. |
| Reduced motion | Ring renders at its final value. |

## 6. Testing

Pure logic lives in `src/lib/calendar-events.ts` and is tested with
`node --test`, the same split as `embed-math.ts` and `retrieval-math.ts`:

- `externalKeyFor(title, start)`
- `recordWindow(start, now)`
- `groupByDay(events, now)`
- `masteryByFolder(cards)`

The parse schema gets a test that `kind` outside the enum and `course` outside
the folder list are rejected.

The sync route is exercised by hand against the real MCP server; the PR's
Verification section names the event count returned.

## 7. Files

New:
- `prisma/migrations/<stamp>_calendar_events/migration.sql`
- `src/lib/calendar-events.ts`, `src/lib/calendar-events.test.ts`
- `src/app/api/integrations/calendar/sync/route.ts`
- `src/app/api/calendar-events/[id]/route.ts`
- `src/components/home/TodayRow.tsx`
- `src/components/home/UpNext.tsx`
- `src/components/home/CourseCard.tsx`
- `src/components/home/MasteryRing.tsx`
- `src/components/home/CalendarSyncTrigger.tsx`

Changed:
- `prisma/schema.prisma`
- `src/lib/mcp/calendar.ts` (parse prompt and schema gain `kind`, `course`)
- `src/app/page.tsx`
- `src/components/recording/RecordingPanel.tsx` (read `?record=1`)
- `src/lib/validation.ts` (PATCH body schema)

Deleted:
- `src/components/dashboard/StatsRow.tsx`

`PageList` and `PageCard` stay; the course page uses them.

## 8. Migration safety

Additive table only. `npm run db:migrate` snapshots `prisma/dev.db` first.
The migration is generated with `prisma migrate dev --create-only` and applied
with `deploy`, so the hand-written FTS5 shadow tables are never touched, per
the README.
