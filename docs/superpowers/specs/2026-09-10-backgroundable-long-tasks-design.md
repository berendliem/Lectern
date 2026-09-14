# Lectern — Backgroundable Long-Running Actions Design

Date: 2026-09-10
Status: Approved design, ready for implementation planning

## 1. Context

Every long action in Lectern is driven from the component that owns the button.
The recorder lives in `useMediaRecorder`, mounted by `RecordingPanel`, mounted by
`TranscriptTab`. The transcribe/summarize/flashcard pipeline lives in
`PipelineStatusBanner`'s `runRemaining()`. The study-plan agent's NDJSON reader
lives in `StudyPlanPanel.run()`. In each case the work is bound to the lifetime of
one React subtree, and `PageTabs` unmounts that subtree the moment the user clicks
another tab:

```tsx
// src/components/page-detail/PageTabs.tsx
<div className="py-5">{tabs.find((tab) => tab.id === active)?.content}</div>
```

Three different failures come out of that one line, in descending order of harm.

**A recording in progress is destroyed, and the audio with it.**
`useMediaRecorder` has no unmount cleanup. When `TranscriptTab` goes away
mid-lecture the `MediaRecorder` keeps running and keeps filling `chunksRef`, but
the ref, the `onstop` handler that assembles the blob, and the `setAudioBlob` it
calls all belong to a component that no longer exists. The blob is never handed
anywhere. The microphone tracks are never stopped, so the browser keeps showing
the recording indicator for a session nobody can stop or save. A student who
clicks "Notes" to check something during a lecture loses the lecture. `AGENTS.md`
is explicit that the user's recording is not replaceable, and this is the one
place in the app that silently destroys one.

**Generation loses its status and invites a second run.**
`ActionsTab.generate()`, `PipelineStatusBanner.runRemaining()`,
`ConceptMapTab`, and the material generators all hold progress in local
`loading` state. The server work itself survives — the route handler finishes its
LLM call and writes to SQLite regardless of who is listening — but on return to
the tab the button reads "Extract" with no spinner, so the obvious move is to
click it again. For `action-items`, `generate-flashcards`, and `generate-quiz`
that is a second paid LLM call that replaces the rows the first one just wrote.
Nothing errors; the user simply cannot tell a running job from a job that never
started.

**A streamed result is dropped even though the run continues.**
`StudyPlanPanel` reads NDJSON events into `steps` and `plan`. Its reader loop is a
closure, so after unmount it keeps draining the response into state nobody
renders. `/api/folders/[id]/study-plan` passes `req.signal` into `runStudyPlan`,
so the agent is alive for as long as the connection is — minutes of real work,
whose `result` event (the plan markdown) lands in a dead `setPlan`. The action
items and calendar blocks the agent wrote survive; the plan the user asked to read
does not.

The common cause is not the tabs. It is that nothing in the app outlives the
component that started the work.

## 2. Goals

- A recording survives switching in-app tabs and navigating to another route, and
  is controllable (pause, stop, save) from wherever the user ends up.
- A long generation reports that it is running, and where, from anywhere in the
  app — and a second click while it runs is a no-op rather than a second bill.
- A streamed run (study plan) keeps accumulating its steps and its result while
  the user is elsewhere, and shows them when they come back.
- No new npm dependency. No new DB table. No server-side job queue.
- Fast actions (toggle a checkbox, rename a tag, grade a card) are left exactly as
  they are.

## 3. Non-goals

- **Surviving a page reload or a browser restart.** Tasks live in memory. The
  server already persists every result it produces, and `PageStatus` plus the
  presence of notes/cards/questions is the truth a reload renders. A task registry
  that survives F5 means persisting client intent, which is a second source of
  truth about work the server already records.
- **A server-side job runner.** Today the route handler *is* the job: it runs to
  completion on its own and writes the result. Detaching execution from the
  request is a much larger change and buys nothing the user asked for.
- **Hidden-browser-tab timing.** `useMediaRecorder` rolls the 15s live-transcribe
  segment with `setInterval`, which Chrome throttles to roughly once a minute in a
  hidden tab, stalling live transcription. Real, out of scope here, tracked in §9.
- **Lecture chat across routes.** `ChatTab`'s stream survives tab switching via
  §6 because the tab stays mounted. Carrying a half-streamed chat answer across a
  route change is not worth a provider.
- **Concurrent recordings.** One recording session at a time, app-wide.

## 4. Mechanism A — `RecordingProvider`

A client provider mounted inside `AppShell`, above the router, so it is never
unmounted by navigation. It owns exactly one `useMediaRecorder` instance and the
identity of the page that session belongs to.

```ts
type RecordingSession = {
  pageId: string;
  pageTitle: string;
  startedAt: number;
};

type RecordingContext = {
  session: RecordingSession | null;
  status: RecorderStatus;          // unchanged from useMediaRecorder
  elapsedSeconds: number;
  level: number;
  audioBlob: Blob | null;
  error: string | null;
  liveTranscript: string;
  start(page: { id: string; title: string }): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  discard(): void;                 // stops tracks, clears blob and transcript
};
```

`RecordingPanel` keeps its layout and its save flow but stops owning a recorder:
it reads the context and renders the live controls only when
`session?.pageId === pageId`. If a session belongs to another page it renders a
one-line note with a link to that page instead of a second Record button — the
alternative, letting two pages record at once, gives one microphone to two
`MediaRecorder`s and loses both.

The live-segment callback moves into the provider too, because `liveTranscript` is
the thing a student watches and it must not reset on navigation.
`/api/live-transcribe` is unchanged.

Two behaviours are new rather than moved:

- **`discard()` stops the tracks.** The current leak (microphone held open after
  unmount) is fixed by making track teardown an explicit call that the provider
  owns, rather than an effect cleanup that the old owner never had.
- **A shell-level recording bar.** While `session` is non-null, `AppShell`'s
  header renders a compact strip: elapsed time, level meter, pause/stop, and a
  link back to the lecture. This is what makes the recording "backgrounded"
  instead of merely "not destroyed" — the user can reach it from the dashboard,
  from another course, from the review queue.

`NotesTab`'s voice note and `InterviewRunner`'s spoken answers keep their own
local `useMediaRecorder`. Both are seconds long and bound to the interaction that
started them; §6 covers the tab case, and leaving a route mid-answer is a
deliberate abandon, not an accident.

## 5. Mechanism B — `TaskProvider`

The same idea for work that is a fetch rather than a device. A provider in
`AppShell` holds a list of running tasks; starting one is a function call, and the
component that started it becomes a *renderer* of task state rather than its
owner.

```ts
type Task = {
  key: string;                     // "page:<id>:summarize" — identity, not label
  label: string;                   // "Summarizing into notes…"
  href?: string;                   // where to go to see it
  startedAt: number;
  status: "running" | "done" | "error";
  progress: string[];              // appended by the runner; study plan's steps
  data?: unknown;                  // the result the renderer wants back
  error?: string;
};

type TaskContext = {
  tasks: Task[];
  task(key: string): Task | undefined;
  run(
    spec: { key: string; label: string; href?: string },
    fn: (io: { step(text: string): void; emit(data: unknown): void }) => Promise<void>
  ): Promise<void>;
};
```

Rules that make this worth having:

- **`run()` on a key that is already running is a no-op** that returns the
  existing promise. That is the duplicate-generation fix, and it holds even when
  the second click comes from a different component or a different tab.
- **`step()` and `emit()` write into the task record**, so a stream's progress and
  its result live in the provider. `StudyPlanPanel` calls `step(name)` per tool
  event and `emit(text)` on result, then renders from `task(key)` — which is
  populated whether or not it was mounted while those arrived.
- **Completed tasks stay in the list briefly** (until the next `run` of the same
  key, or dismissal) so a user returning to a tab sees "done" and any error,
  rather than an idle button and no explanation.
- **`router.refresh()` stays at the call sites.** The provider does not know what
  a given task invalidated.

A chip in the `AppShell` header shows the running count and expands to the task
labels, each a link to its `href`. Errors surface there as well as in the
component that started the task, because the component may not be mounted when
the failure arrives.

## 6. `PageTabs` keeps visited tabs mounted

```tsx
// visited: Set<string>, seeded with the initial tab and added to on click
{tabs.filter((tab) => visited.has(tab.id)).map((tab) => (
  <div key={tab.id} hidden={tab.id !== active}>{tab.content}</div>
))}
```

Lazy on first visit (so `ConceptMapTab` and `ChatTab` do not fetch on page load),
permanent afterwards. This is five lines and it independently fixes in-tab chat
streams, unsent drafts, scroll position, and `NotesTab`'s voice note — none of
which need a provider. It does **not** make the recorder safe on its own, because
navigating away from the lecture page still unmounts everything; §4 is what makes
that case safe.

## 7. Call sites

Converted to `run()`:

| Component | Key |
| --- | --- |
| `PipelineStatusBanner` | `page:<id>:<stage>` for each of the four stages |
| `ActionsTab` | `page:<id>:action-items` |
| `ConceptMapTab` | `page:<id>:concept-map` |
| `NotesTab` (cleanup transcript, edit notes) | `page:<id>:cleanup`, `page:<id>:edit-notes` |
| `TranscriptTab` / `RecordingPanel` save | `page:<id>:transcribe` |
| `StudyPlanPanel` | `folder:<id>:study-plan` |
| `MaterialList` / material generators | `material:<id>:flashcards`, `material:<id>:quiz` |
| `CourseOverview` parse-syllabus | `folder:<id>:parse-syllabus` |

Left alone: tag edits, action-item toggles, review grading, interview answers,
quiz answers, dictionary edits, integration tests, export, new page, import
buttons with their own progress UI and `AbortController` semantics
(`ImportButton`, `CourseDropZone`, `MaterialUploadButton`). These are either fast
or already have a considered cancel story; routing them through the provider would
add a concept without removing a failure.

## 8. Testing

The logic worth pinning is the reducer behind `TaskProvider`, which is pure and
testable without React: starting a key that is already running returns the
existing entry and does not duplicate it; `step()` appends in order; `emit()`
attaches data; a throwing `fn` records `status: "error"` with the message and does
not leave the task running. One `src/lib/tasks.test.ts` using `node:test` + `node:assert/strict`, matching the existing
`src/lib/*.test.ts` files and the `npm test` glob.

The provider wiring, the recording bar, and the tab keep-mounted change are
verified by running the app: start a recording on a lecture page, switch to
Notes, navigate to the dashboard, stop from the shell bar, confirm the audio saves
and transcription starts. Generation: start "Generate study materials", switch
tabs and routes, confirm the chip tracks it and the button refuses a second run.

## 9. Risks and follow-ups

- **Mounted-but-hidden tabs cost work.** `ConceptMapTab` keeps its canvas and
  `ChatTab` its history in memory for the life of the page view. Acceptable for a
  local single-user app; the lazy-on-first-visit rule keeps a page load as cheap
  as it is today.
- **One recording, app-wide, is a real constraint.** Recording lecture B while
  lecture A records is refused rather than queued. This matches the hardware.
- **In-memory tasks vanish on reload.** §3 explains why that is the right trade;
  the visible consequence is that a reload during generation shows an idle button
  while the server finishes. Mitigated by `PageStatus` already rendering
  "Transcribing…" from the DB.
- **Hidden-tab timer throttling is still open.** Live transcription degrades to
  roughly one 60s segment per minute when the browser tab is in the background,
  because `LIVE_SEGMENT_MS` is enforced with `setInterval`. Fixing it means
  driving segment rollover off a clock the browser does not throttle (the
  `AudioContext` time, or a `MediaRecorder` timeslice with server-side container
  stitching). Separate change, separate PR.
