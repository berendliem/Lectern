# Lectern Phase 8 — Backgroundable Long-Running Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Long actions — a lecture recording, an LLM generation, a streamed agent run — keep running and stay visible when the user switches in-app tabs or navigates to another route.

**Architecture:** Two React context providers mounted inside `AppShell` (above the router, so navigation never unmounts them). `TaskProvider` owns a keyed registry of in-flight async work with progress and results; `RecordingProvider` owns the single `useMediaRecorder` session plus its save flow. Components that used to own the work become renderers of provider state. `PageTabs` additionally keeps visited tabs mounted so in-tab streams and drafts survive a tab click.

**Tech Stack:** Next.js 15 App Router, React 19 client components, TypeScript, Tailwind, `node:test` + `node:assert/strict` via `npm test` (`node --import tsx --test "src/lib/**/*.test.ts"`).

**Spec:** `docs/superpowers/specs/2026-09-10-backgroundable-long-tasks-design.md`

## Global Constraints

- No new npm dependency, no new DB table, no server-side job queue (spec §2).
- Tasks are in-memory only; nothing persists client intent across a reload (spec §3).
- One recording session at a time, app-wide (spec §3).
- No API route changes. `/api/live-transcribe`, `/api/pages/[id]/audio`, `/api/pages/[id]/transcribe` and every generation route stay exactly as they are.
- `main` is protected. Work happens on the current branch `feat/backgroundable-long-tasks`; it reaches `main` through a PR.
- Every converted call site keeps its existing `router.refresh()` calls and its existing user-facing error copy.
- Fast actions are out of scope: tag edits, action-item toggles, review grading, quiz answers, interview answers, dictionary edits, integration tests, export, new page, and the upload buttons that own an `AbortController` (`ImportButton`, `CourseDropZone`, `MaterialUploadButton`).
- Commit after each task with the repo convention `<type>: <imperative phrase>`, plus the trailers:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XzfR6xPx9YA664hKVjvYki
  ```

---

### Task 1: Task registry reducer

The pure state machine behind `TaskProvider`. No React here, so it is the one piece with real unit tests.

**Files:**
- Create: `src/lib/tasks.ts`
- Test: `src/lib/tasks.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Task`, `type TaskStatus`, `type TaskState`, `type TaskAction`, `EMPTY_TASKS: TaskState`, `tasksReducer(state: TaskState, action: TaskAction): TaskState`, `findTask(state: TaskState, key: string): Task | undefined`, `isRunning(state: TaskState, key: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tasks.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_TASKS, findTask, isRunning, tasksReducer, type TaskState } from "@/lib/tasks";

function started(key = "page:p1:summarize"): TaskState {
  return tasksReducer(EMPTY_TASKS, {
    type: "start",
    key,
    label: "Summarizing into notes…",
    href: "/pages/p1",
    now: 1_000,
  });
}

test("start records a running task", () => {
  const state = started();
  assert.equal(state.tasks.length, 1);
  const task = findTask(state, "page:p1:summarize");
  assert.equal(task?.status, "running");
  assert.equal(task?.label, "Summarizing into notes…");
  assert.equal(task?.href, "/pages/p1");
  assert.equal(task?.startedAt, 1_000);
  assert.deepEqual(task?.progress, []);
  assert.equal(isRunning(state, "page:p1:summarize"), true);
  assert.equal(isRunning(state, "page:p1:quiz"), false);
});

test("starting a key that is already running changes nothing", () => {
  const state = started();
  const again = tasksReducer(state, {
    type: "start",
    key: "page:p1:summarize",
    label: "A second click",
    now: 2_000,
  });
  assert.equal(again, state);
});

test("starting a finished key replaces it with a fresh run", () => {
  const done = tasksReducer(
    tasksReducer(started(), { type: "step", key: "page:p1:summarize", text: "read transcript" }),
    { type: "finish", key: "page:p1:summarize" }
  );
  const restarted = tasksReducer(done, {
    type: "start",
    key: "page:p1:summarize",
    label: "Summarizing into notes…",
    now: 3_000,
  });
  assert.equal(restarted.tasks.length, 1);
  const task = findTask(restarted, "page:p1:summarize");
  assert.equal(task?.status, "running");
  assert.equal(task?.startedAt, 3_000);
  assert.deepEqual(task?.progress, []);
  assert.equal(task?.error, undefined);
  assert.equal(task?.data, undefined);
});

test("step appends progress in order and emit attaches data", () => {
  let state = started("folder:f1:study-plan");
  state = tasksReducer(state, { type: "step", key: "folder:f1:study-plan", text: "list lectures" });
  state = tasksReducer(state, { type: "step", key: "folder:f1:study-plan", text: "score topics" });
  state = tasksReducer(state, { type: "emit", key: "folder:f1:study-plan", data: "## Week plan" });
  const task = findTask(state, "folder:f1:study-plan");
  assert.deepEqual(task?.progress, ["list lectures", "score topics"]);
  assert.equal(task?.data, "## Week plan");
  assert.equal(task?.status, "running");
});

test("fail records the message and stops running", () => {
  const state = tasksReducer(started(), {
    type: "fail",
    key: "page:p1:summarize",
    message: "The model returned nothing usable.",
  });
  const task = findTask(state, "page:p1:summarize");
  assert.equal(task?.status, "error");
  assert.equal(task?.error, "The model returned nothing usable.");
  assert.equal(isRunning(state, "page:p1:summarize"), false);
});

test("finish keeps the task and its data for the renderer", () => {
  const state = tasksReducer(
    tasksReducer(started(), { type: "emit", key: "page:p1:summarize", data: { items: 3 } }),
    { type: "finish", key: "page:p1:summarize" }
  );
  const task = findTask(state, "page:p1:summarize");
  assert.equal(task?.status, "done");
  assert.deepEqual(task?.data, { items: 3 });
});

test("dismiss drops the task", () => {
  const state = tasksReducer(started(), { type: "dismiss", key: "page:p1:summarize" });
  assert.deepEqual(state.tasks, []);
});

test("actions for an unknown key are ignored", () => {
  const state = started();
  assert.equal(tasksReducer(state, { type: "step", key: "nope", text: "x" }), state);
  assert.equal(tasksReducer(state, { type: "finish", key: "nope" }), state);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/tasks'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/tasks.ts`:

```ts
/**
 * The state machine behind TaskProvider. Kept free of React so the rules that
 * matter — one run per key, progress in order, a failure that sticks — are
 * testable without a renderer.
 */

export type TaskStatus = "running" | "done" | "error";

export type Task = {
  /** Identity, not a label: "page:<id>:summarize". Two clicks, one key, one run. */
  key: string;
  label: string;
  /** Where the user goes to watch it, when the task has a home. */
  href?: string;
  startedAt: number;
  status: TaskStatus;
  progress: string[];
  data?: unknown;
  error?: string;
};

export type TaskState = { tasks: Task[] };

export type TaskAction =
  | { type: "start"; key: string; label: string; href?: string; now: number }
  | { type: "step"; key: string; text: string }
  | { type: "emit"; key: string; data: unknown }
  | { type: "finish"; key: string }
  | { type: "fail"; key: string; message: string }
  | { type: "dismiss"; key: string };

export const EMPTY_TASKS: TaskState = { tasks: [] };

export function findTask(state: TaskState, key: string): Task | undefined {
  return state.tasks.find((task) => task.key === key);
}

export function isRunning(state: TaskState, key: string): boolean {
  return findTask(state, key)?.status === "running";
}

function mapTask(state: TaskState, key: string, update: (task: Task) => Task): TaskState {
  if (!findTask(state, key)) return state;
  return { tasks: state.tasks.map((task) => (task.key === key ? update(task) : task)) };
}

export function tasksReducer(state: TaskState, action: TaskAction): TaskState {
  switch (action.type) {
    case "start": {
      if (isRunning(state, action.key)) return state;
      const fresh: Task = {
        key: action.key,
        label: action.label,
        href: action.href,
        startedAt: action.now,
        status: "running",
        progress: [],
      };
      // A finished or failed run of the same key is replaced, not stacked:
      // the user is re-running that one thing.
      const others = state.tasks.filter((task) => task.key !== action.key);
      return { tasks: [...others, fresh] };
    }
    case "step":
      return mapTask(state, action.key, (task) => ({
        ...task,
        progress: [...task.progress, action.text],
      }));
    case "emit":
      return mapTask(state, action.key, (task) => ({ ...task, data: action.data }));
    case "finish":
      return mapTask(state, action.key, (task) => ({ ...task, status: "done" }));
    case "fail":
      return mapTask(state, action.key, (task) => ({
        ...task,
        status: "error",
        error: action.message,
      }));
    case "dismiss":
      return { tasks: state.tasks.filter((task) => task.key !== action.key) };
  }
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm test`
Expected: PASS — every `tasks.test.ts` test, and no regression in the other `src/lib/*.test.ts` files.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks.ts src/lib/tasks.test.ts
git commit -m "feat: add the task registry reducer"
```

---

### Task 2: TaskProvider and hooks

Wraps the reducer in context and adds the one thing the reducer cannot do: deduplicating concurrent `run()` calls on the same key by holding the in-flight promise.

**Files:**
- Create: `src/components/tasks/TaskProvider.tsx`
- Modify: `src/components/dashboard/AppShell.tsx`

**Interfaces:**
- Consumes: `EMPTY_TASKS`, `findTask`, `tasksReducer`, `type Task` from `@/lib/tasks`.
- Produces:
  - `TaskProvider({ children }: { children: React.ReactNode })`
  - `useTasks(): { tasks: Task[]; task(key: string): Task | undefined; run(spec: TaskSpec, fn: (io: TaskIO) => Promise<void>): Promise<void>; dismiss(key: string): void }`
  - `useTask(key: string): Task | undefined`
  - `type TaskSpec = { key: string; label: string; href?: string }`
  - `type TaskIO = { step(text: string): void; emit(data: unknown): void }`

- [ ] **Step 1: Write the provider**

Create `src/components/tasks/TaskProvider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import { EMPTY_TASKS, findTask, tasksReducer, type Task } from "@/lib/tasks";

export type TaskSpec = { key: string; label: string; href?: string };
export type TaskIO = { step(text: string): void; emit(data: unknown): void };

type TaskContextValue = {
  tasks: Task[];
  task(key: string): Task | undefined;
  run(spec: TaskSpec, fn: (io: TaskIO) => Promise<void>): Promise<void>;
  dismiss(key: string): void;
};

const TaskContext = createContext<TaskContextValue | null>(null);

/**
 * Holds long-running work above the router, so switching tabs or navigating
 * away loses the spinner's owner but not the spinner.
 */
export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(tasksReducer, EMPTY_TASKS);
  // The reducer knows a key is running; only this map can hand back the actual
  // promise, so a second caller awaits the first run instead of starting one.
  const inFlight = useRef(new Map<string, Promise<void>>());

  const run = useCallback(async (spec: TaskSpec, fn: (io: TaskIO) => Promise<void>) => {
    const existing = inFlight.current.get(spec.key);
    if (existing) return existing;

    dispatch({ type: "start", key: spec.key, label: spec.label, href: spec.href, now: Date.now() });

    const promise = (async () => {
      try {
        await fn({
          step: (text) => dispatch({ type: "step", key: spec.key, text }),
          emit: (data) => dispatch({ type: "emit", key: spec.key, data }),
        });
        dispatch({ type: "finish", key: spec.key });
      } catch (e) {
        dispatch({
          type: "fail",
          key: spec.key,
          message: e instanceof Error ? e.message : "That step failed. You can retry it.",
        });
      } finally {
        inFlight.current.delete(spec.key);
      }
    })();

    inFlight.current.set(spec.key, promise);
    return promise;
  }, []);

  const value = useMemo<TaskContextValue>(
    () => ({
      tasks: state.tasks,
      task: (key: string) => findTask(state, key),
      run,
      dismiss: (key: string) => dispatch({ type: "dismiss", key }),
    }),
    [state, run]
  );

  return <TaskContext.Provider value={value}>{children}</TaskContext.Provider>;
}

export function useTasks(): TaskContextValue {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error("useTasks must be used inside <TaskProvider>");
  return ctx;
}

export function useTask(key: string): Task | undefined {
  return useTasks().task(key);
}
```

- [ ] **Step 2: Mount it in the shell**

In `src/components/dashboard/AppShell.tsx`, import the provider and wrap the entire returned tree — the outermost element becomes `<TaskProvider>`:

```tsx
import { TaskProvider } from "@/components/tasks/TaskProvider";

// …inside AppShell's return, wrapping the existing <div className="flex h-full min-h-screen"> …
return (
  <TaskProvider>
    <div className="flex h-full min-h-screen">
      {/* unchanged shell markup */}
    </div>
  </TaskProvider>
);
```

- [ ] **Step 3: Verify it compiles and nothing regressed**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no type errors, no new lint errors, all tests pass. No behaviour change yet — nothing calls `run()` until Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/components/tasks/TaskProvider.tsx src/components/dashboard/AppShell.tsx
git commit -m "feat: hold running tasks in a shell-level provider"
```

---

### Task 3: Task chip in the header

The app-wide readout. Without it, a backgrounded task is invisible from anywhere but the component that started it.

**Files:**
- Create: `src/components/tasks/TaskChip.tsx`
- Modify: `src/components/dashboard/AppShell.tsx`

**Interfaces:**
- Consumes: `useTasks()` from `@/components/tasks/TaskProvider`.
- Produces: `TaskChip()` — no props.

- [ ] **Step 1: Write the chip**

Create `src/components/tasks/TaskChip.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import { useTasks } from "@/components/tasks/TaskProvider";
import clsx from "@/lib/clsx";

/**
 * Header readout for work started elsewhere in the app. A generation that
 * finishes — or fails — while the user is on another page is reported here,
 * because the component that started it may be long unmounted.
 */
export function TaskChip() {
  const { tasks, dismiss } = useTasks();
  const [open, setOpen] = useState(false);

  if (tasks.length === 0) return null;

  const running = tasks.filter((task) => task.status === "running");
  const failed = tasks.filter((task) => task.status === "error");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors",
          failed.length > 0
            ? "border-red-200 bg-red-50 text-red-700"
            : running.length > 0
              ? "border-brand-border bg-brand-soft/50 text-brand-ink"
              : "border-line bg-surface text-muted hover:border-line-strong"
        )}
        aria-label={running.length > 0 ? `${running.length} running` : "Background work"}
      >
        {running.length > 0 ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
            {running.length} running
          </>
        ) : failed.length > 0 ? (
          <>
            <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2.2} />
            {failed.length} failed
          </>
        ) : (
          <>
            <Check className="h-3.5 w-3.5" strokeWidth={2.2} />
            Done
          </>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-1.5 w-80 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          <ul className="flex flex-col">
            {tasks.map((task) => (
              <li key={task.key} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                <span className="mt-0.5">
                  {task.status === "running" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-ink" strokeWidth={2.2} />
                  ) : task.status === "error" ? (
                    <TriangleAlert className="h-3.5 w-3.5 text-red-600" strokeWidth={2.2} />
                  ) : (
                    <Check className="h-3.5 w-3.5 text-moss-ink" strokeWidth={2.2} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  {task.href ? (
                    <Link
                      href={task.href}
                      onClick={() => setOpen(false)}
                      className="text-[13px] font-medium text-ink-soft hover:text-brand-ink"
                    >
                      {task.label}
                    </Link>
                  ) : (
                    <p className="text-[13px] font-medium text-ink-soft">{task.label}</p>
                  )}
                  {task.progress.length > 0 && task.status === "running" && (
                    <p className="truncate text-[11.5px] text-muted-2">
                      {task.progress[task.progress.length - 1]}
                    </p>
                  )}
                  {task.error && <p className="text-[11.5px] text-red-600">{task.error}</p>}
                </div>
                {task.status !== "running" && (
                  <button
                    onClick={() => dismiss(task.key)}
                    className="rounded p-0.5 text-muted-2 hover:bg-surface-3 hover:text-ink-soft"
                    aria-label={`Dismiss ${task.label}`}
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2.2} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Put it in the header**

In `src/components/dashboard/AppShell.tsx`, add `<TaskChip />` as the first child of the existing right-hand cluster, before the command-palette button:

```tsx
<div className="ml-auto flex items-center gap-2">
  <TaskChip />
  <button onClick={() => window.dispatchEvent(new Event("open-command-palette"))} /* unchanged */>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. The chip renders nothing until a task exists, so the header looks unchanged in the browser.

- [ ] **Step 4: Commit**

```bash
git add src/components/tasks/TaskChip.tsx src/components/dashboard/AppShell.tsx
git commit -m "feat: show background tasks in the app header"
```

---

### Task 4: PageTabs keeps visited tabs mounted

Independent of both providers, and it alone fixes in-tab chat streams, unsent drafts, and scroll position.

**Files:**
- Modify: `src/components/page-detail/PageTabs.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no API change — `PageTabs({ tabs })` keeps its signature.

- [ ] **Step 1: Rewrite the component body**

Replace the whole of `src/components/page-detail/PageTabs.tsx` with:

```tsx
"use client";

import { useState } from "react";
import clsx from "@/lib/clsx";

export function PageTabs({
  tabs,
}: {
  tabs: { id: string; label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  // Tabs mount on first visit and then stay mounted. Unmounting them threw
  // away in-flight work: a half-streamed chat answer, an unsent draft, a
  // scroll position — and, before the recording moved into the shell, a
  // lecture recording.
  const [visited, setVisited] = useState<string[]>(tabs[0]?.id ? [tabs[0].id] : []);

  function show(id: string) {
    setActive(id);
    setVisited((seen) => (seen.includes(id) ? seen : [...seen, id]));
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-line">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => show(tab.id)}
            className={clsx(
              "border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active === tab.id
                ? "border-brand text-brand-ink"
                : "border-transparent text-muted hover:text-ink-soft"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="py-5">
        {tabs
          .filter((tab) => visited.includes(tab.id))
          .map((tab) => (
            <div key={tab.id} hidden={tab.id !== active}>
              {tab.content}
            </div>
          ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in the browser**

Run: `npm run dev`, open a lecture page with notes, then:
1. Ask something in the Chat tab, and while the answer streams click Transcript and back — the answer is still streaming and completes.
2. Type an instruction in Notes without submitting, switch tabs and back — the draft is still there.
3. Reload the page and watch the network tab: Concept map and Chat make no requests until their tab is clicked once.

Expected: all three hold.

- [ ] **Step 3: Commit**

```bash
git add src/components/page-detail/PageTabs.tsx
git commit -m "fix: keep visited lecture tabs mounted"
```

---

### Task 5: Convert the page-detail generation call sites

Five components swap local `loading` state for `run()`. This is the duplicate-generation fix and the first real consumer of `TaskProvider`.

**Files:**
- Modify: `src/lib/tasks.ts` (append `postTask`)
- Modify: `src/components/page-detail/PipelineStatusBanner.tsx`
- Modify: `src/components/page-detail/ActionsTab.tsx`
- Modify: `src/components/page-detail/ConceptMapTab.tsx`
- Modify: `src/components/page-detail/TranscriptTab.tsx:42-74` (`detectChapters`, `cleanup`)
- Modify: `src/components/page-detail/NotesTab.tsx:96-126` (`applyEdit`)

**Interfaces:**
- Consumes: `useTasks` from `@/components/tasks/TaskProvider`.
- Produces: `postTask(url: string, fallback: string, init?: RequestInit): Promise<unknown>` in `@/lib/tasks`, and the task keys `page:<id>:transcribe`, `page:<id>:summarize`, `page:<id>:generate-flashcards`, `page:<id>:generate-quiz`, `page:<id>:action-items`, `page:<id>:concept-map`, `page:<id>:chapters`, `page:<id>:cleanup`, `page:<id>:edit-notes`.

- [ ] **Step 1: Add the shared POST helper**

All five sites do "POST, read the body, throw the server's message". Append it once to `src/lib/tasks.ts`:

```ts
/**
 * POST a generation route and turn a non-2xx into a throw, so TaskProvider
 * records the server's own message as the task error.
 */
export async function postTask(
  url: string,
  fallback: string,
  init?: RequestInit,
  networkFallback?: string
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", ...init });
  } catch {
    throw new Error(networkFallback ?? fallback);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? fallback);
  return body;
}
```

- [ ] **Step 2: Convert `PipelineStatusBanner`**

Delete the `runningStage` and `localError` state and the `try/catch` in `runRemaining`. The four stages become four keyed tasks run in sequence; the banner reads their state:

```tsx
import { useTasks } from "@/components/tasks/TaskProvider";
import { postTask } from "@/lib/tasks";

const STAGE_KEY = (pageId: string, stage: StageId) => `page:${pageId}:${stage}`;

// …inside the component, replacing useState for runningStage/localError:
const { run, task } = useTasks();
const router = useRouter();

const stageTasks = STAGES.map((stage) => task(STAGE_KEY(pageId, stage.id)));
const runningStage =
  STAGES.find((stage) => task(STAGE_KEY(pageId, stage.id))?.status === "running")?.id ?? null;
const taskError = stageTasks.find((t) => t?.status === "error")?.error ?? null;

async function runRemaining() {
  for (const stage of remaining) {
    let failed = false;
    await run(
      { key: STAGE_KEY(pageId, stage.id), label: stage.runningLabel, href: `/pages/${pageId}` },
      async () => {
        try {
          await postTask(
            `/api/pages/${pageId}/${stage.id}`,
            `${stage.label} generation failed. You can retry from here.`
          );
        } catch (e) {
          failed = true;
          throw e;
        }
      }
    );
    router.refresh();
    // Later stages read what earlier ones wrote, so a failure stops the chain.
    if (failed) return;
  }
}
```

Then change the two render reads: `const message = localError ?? errorMessage;` becomes `const message = taskError ?? errorMessage;`, and `const running = runningStage !== null;` stays as written. Leave every class name, label, and the `<ol>` stage rendering exactly as they are.

- [ ] **Step 3: Convert `ActionsTab`**

Replace the `loading` state with the task, keeping `items` local (it is server data the component already fetches on mount):

```tsx
import { useTasks } from "@/components/tasks/TaskProvider";
import { postTask } from "@/lib/tasks";

// …in the component:
const { run, task } = useTasks();
const taskKey = `page:${pageId}:action-items`;
const generateTask = task(taskKey);
const loading = generateTask?.status === "running";
const [error, setError] = useState<string | null>(null);   // kept: toggle() still sets it

async function generate() {
  setError(null);
  await run(
    { key: taskKey, label: "Extracting action items…", href: `/pages/${pageId}` },
    async ({ emit }) => {
      const body = (await postTask(
        `/api/pages/${pageId}/action-items`,
        "Could not extract action items. Try again."
      )) as { items?: ActionItem[] };
      emit(body.items ?? []);
    }
  );
}
```

The run's `fn` calls `setItems(body.items ?? [])` directly — do **not** render from
`generateTask?.data`. Task data is permanent once a run finishes, so a component
that prefers it stops rendering `toggle()`'s `setItems` updates and the checkboxes
freeze after the first Extract. `items` stays the single source of truth: the
mount-time fetch seeds it, the run replaces it, `toggle()` updates it. Render
`generateTask?.error ?? error` where the component rendered `error`.

- [ ] **Step 4: Convert `ConceptMapTab`**

`src/app/api/pages/[id]/concept-map/route.ts:42` responds `{ conceptMap: { nodes, edges } }`, so that is the field to read.

```tsx
import { useTasks } from "@/components/tasks/TaskProvider";
import { postTask } from "@/lib/tasks";

const { run, task } = useTasks();
const taskKey = `page:${pageId}:concept-map`;
const mapTask = task(taskKey);
const loading = mapTask?.status === "running";
const map = (mapTask?.data as ConceptMap | undefined) ?? null;
const error = mapTask?.error ?? null;

async function generate() {
  await run(
    { key: taskKey, label: "Drawing the concept map…", href: `/pages/${pageId}` },
    async ({ emit }) => {
      const body = (await postTask(
        `/api/pages/${pageId}/concept-map`,
        "Could not build a concept map from this lecture."
      )) as { conceptMap?: ConceptMap };
      emit(body.conceptMap);
    }
  );
}
```

Delete the now-unused `map`, `loading`, and `error` `useState` calls. Keep `hovered` — it is view state, not work state. Keep the existing empty-state and error copy; only its source changes.

- [ ] **Step 5: Convert `TranscriptTab`'s two actions**

```tsx
const { run, task } = useTasks();
const chapterKey = `page:${pageId}:chapters`;
const cleanKey = `page:${pageId}:cleanup`;
const chaptering = task(chapterKey)?.status === "running";
const cleaning = task(cleanKey)?.status === "running";
const error = task(chapterKey)?.error ?? task(cleanKey)?.error ?? null;

async function detectChapters() {
  await run({ key: chapterKey, label: "Detecting chapters…", href: `/pages/${pageId}` }, async () => {
    await postTask(`/api/pages/${pageId}/chapters`, "Chapter detection failed. Try again.");
  });
  router.refresh();
}

async function cleanup() {
  // `task(...)` closes over this render's state snapshot, so it CANNOT report
  // what the run just did. Capture the outcome inside fn instead.
  let ok = false;
  await run({ key: cleanKey, label: "Cleaning up the transcript…", href: `/pages/${pageId}` }, async () => {
    await postTask(`/api/pages/${pageId}/cleanup-transcript`, "Transcript cleanup failed. Try again.");
    ok = true;
  });
  if (ok) setView("clean");
  router.refresh();
}
```

Delete the `chaptering`, `cleaning`, and `error` `useState` calls. Keep `view`.

- [ ] **Step 6: Convert `NotesTab`'s `applyEdit`**

`applyEdit` keeps its `previousMarkdown` undo bookkeeping and its local `markdown` state; only `busy` and the fetch move:

```tsx
const { run, task } = useTasks();
const editKey = `page:${pageId}:edit-notes`;
const editTask = task(editKey);
const busy = editTask?.status === "running";

async function applyEdit(e: React.FormEvent) {
  e.preventDefault();
  if (!instruction.trim() || busy) return;
  // Boxed, not a bare `let`: TypeScript narrows a let assigned only inside a
  // callback to `never` after the await. And never read task(...) back here —
  // it closes over this render's snapshot and cannot see the finished run.
  const result: { applied: { markdown: string; previousMarkdown: string | null } | null } = { applied: null };
  await run(
    { key: editKey, label: "Applying your edit to the notes…", href: `/pages/${pageId}` },
    async () => {
      const body = (await postTask(
        `/api/pages/${pageId}/edit-notes`,
        "Editing the notes failed. Try again.",
        {
          headers: { "Content-Type": "application/json" },
          // The route's schema has selectedText as .optional(), not
          // .nullable() — sending null fails validation.
          body: JSON.stringify({
            instruction: instruction.trim(),
            ...(selectedText ? { selectedText } : {}),
          }),
        },
        "Editing the notes failed. Try again."
      )) as { markdown?: string; previousMarkdown?: string | null };
      if (!body.markdown) throw new Error("Editing the notes failed. Try again.");
      result.applied = { markdown: body.markdown, previousMarkdown: body.previousMarkdown ?? null };
    }
  );
  if (result.applied) {
    // The server's record of the prior text, not the client's copy of it.
    setPreviousMarkdown(result.applied.previousMarkdown);
    setMarkdown(result.applied.markdown);
    setInstruction("");
    setSelectedText(null);
    router.refresh();
  }
}
```

`undo()` keeps its own local busy flag: deriving `busy` from the task alone
removes the setter `undo()` needs.

Render `editTask?.error ?? error` where `error` was rendered. Leave `transcribing` (the voice-note path) and `undo()` alone — both are short and local.

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev` and on a lecture page:
1. Click "Generate study materials", switch to Notes, then navigate to the dashboard. The header chip shows the running stage label, and it updates as the pipeline advances.
2. Return to the lecture page mid-run: the banner shows the running stage with its spinner, not an idle button.
3. Click "Extract" in Actions twice quickly: the second click starts nothing (one request in the network tab).
4. Force a failure (stop the whisper service, or set a bad `OPENROUTER_*` key) and confirm the server's message appears both in the component and in the chip.

- [ ] **Step 8: Verify the tree**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/tasks.ts src/components/page-detail
git commit -m "feat: run lecture generation through the task provider"
```

---

### Task 6: Stream the study-plan run through a task

The streamed case: progress and result must accumulate in the provider, because the panel is unmounted for most of a minutes-long run.

**Files:**
- Modify: `src/components/course/StudyPlanPanel.tsx`

**Interfaces:**
- Consumes: `useTasks` from `@/components/tasks/TaskProvider`; `type AgentEvent` from `@/lib/agent/stream` (unchanged).
- Produces: task key `folder:<id>:study-plan`, whose `progress` is the tool-step list and whose `data` is the plan markdown string.

- [ ] **Step 1: Move the reader into `run()`**

Replace the component's `running`/`steps`/`plan`/`error` state and its `abort` ref with task state. The `AbortController` goes away: aborting was only there to stop a run the component was about to forget, and the point of this change is that it no longer forgets.

```tsx
"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CalendarClock, Loader2 } from "lucide-react";
import type { AgentEvent } from "@/lib/agent/stream";
import { useTasks } from "@/components/tasks/TaskProvider";

type PanelEvent = AgentEvent | { type: "error"; message: string };

export function StudyPlanPanel({ folderId }: { folderId: string }) {
  const { run, task } = useTasks();
  const taskKey = `folder:${folderId}:study-plan`;
  const planTask = task(taskKey);
  const running = planTask?.status === "running";
  const steps = planTask?.progress ?? [];
  const plan = (planTask?.data as string | undefined) ?? null;
  const error = planTask?.error ?? null;

  async function start() {
    await run(
      { key: taskKey, label: "Planning this week's study…", href: `/folders/${folderId}` },
      async ({ step, emit }) => {
        const res = await fetch(`/api/folders/${folderId}/study-plan`, { method: "POST" });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "Could not start the study-plan run");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let failure: string | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          // The last piece may be half a line; keep it for the next chunk.
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as PanelEvent;
            if (event.type === "tool") step(event.name.replace(/_/g, " "));
            else if (event.type === "result") emit(event.text);
            else if (event.type === "error") failure = event.message;
          }
        }
        // The route sends failures as events on an already-200 response.
        if (failure) throw new Error(failure);
      }
    );
  }

  // …the existing JSX, unchanged, reading running/steps/plan/error and calling start()
}
```

Rename the button's handler from `run` to `start` in the JSX — the context now owns the name `run`.

- [ ] **Step 2: Verify in the browser**

Run: `npm run dev`, open a course with topics, start the study plan, then navigate to the dashboard and back while it runs.
Expected: the chip shows "Planning this week's study…" with the latest tool step; returning to the course shows the accumulated step list and, when it finishes, the plan markdown — even if the panel was unmounted when the `result` event arrived.

- [ ] **Step 3: Commit**

```bash
git add src/components/course/StudyPlanPanel.tsx
git commit -m "feat: keep the study-plan stream in the task provider"
```

---

### Task 7: Convert the course and material generators

**Files:**
- Modify: `src/components/dashboard/MaterialList.tsx:63-95` (`generate`)
- Modify: `src/components/course/CourseOverview.tsx:55-87` (`send`, `parseSyllabus`)

**Interfaces:**
- Consumes: `useTasks` from `@/components/tasks/TaskProvider`, `postTask` from `@/lib/tasks`.
- Produces: task keys `material:<id>:flashcards`, `material:<id>:quiz`, `folder:<id>:parse-syllabus`.

- [ ] **Step 1: Convert `MaterialList.generate`**

Keep the existing `confirm()` warning text verbatim — it is the destructive-action warning `AGENTS.md` requires — and keep `deleting`, `previews`, `loadingPreview`, and `openId` state as they are. Only the generate path changes:

```tsx
import { useTasks } from "@/components/tasks/TaskProvider";
import { postTask } from "@/lib/tasks";

const { run, task } = useTasks();

function generatingKind(id: string): "flashcards" | "quiz" | null {
  if (task(`material:${id}:flashcards`)?.status === "running") return "flashcards";
  if (task(`material:${id}:quiz`)?.status === "running") return "quiz";
  return null;
}

async function generate(id: string, kind: "flashcards" | "quiz", existing: number) {
  // …existing confirm() block, unchanged…
  await run(
    { key: `material:${id}:${kind}`, label: `Generating ${kind} from a material…` },
    async () => {
      await postTask(
        `/api/materials/${id}/generate-${kind}`,
        `Could not generate ${kind} from that material.`
      );
    }
  );
  router.refresh();
}
```

Replace reads of the `generating` state with `generatingKind(material.id)` for the per-row spinner, delete the `generating` `useState`, and render the failed task's error alongside the existing `error` state for that row.

- [ ] **Step 2: Convert `CourseOverview.parseSyllabus` only**

`send(key, url, init, failure)` at `src/components/course/CourseOverview.tsx:55` has three callers: `parseSyllabus` (an LLM run, minutes), `addTopic` (instant, and it uses `send`'s boolean return), and the per-topic delete button at line 384 (instant). Leave `send` exactly as it is — routing a topic delete through the provider would put a chip in the header for a sub-second action, which the spec's "fast actions are left alone" rule rules out. Only `parseSyllabus` stops using it:

```tsx
import { useTasks } from "@/components/tasks/TaskProvider";
import { postTask } from "@/lib/tasks";

const { run, task } = useTasks();
const syllabusKey = `folder:${folderId}:parse-syllabus`;
const parsingSyllabus = task(syllabusKey)?.status === "running";

async function parseSyllabus() {
  const confirmed =
    topics.length === 0 ||
    window.confirm("Re-parsing replaces this course's topic list, including any edits. Continue?");
  if (!confirmed) return;
  await run(
    { key: syllabusKey, label: "Reading the syllabus…", href: `/folders/${folderId}` },
    async () => {
      await postTask(`/api/folders/${folderId}/parse-syllabus`, "Could not parse that syllabus.");
    }
  );
  router.refresh();
}
```

Keep the `confirm()` copy verbatim — it names what re-parsing destroys. The syllabus button's disabled/spinner state reads `parsingSyllabus` instead of `busy === "parse"`; render `task(syllabusKey)?.error ?? error` where that button's error appeared. `busy` stays, because `addTopic` and the delete button still use it. Leave `adding`, `newTitle`, `selectedTopicId`, `runningDialog`, `debateOpen`, `debateSelect`, and `debateSubmitting` alone.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`, then in `npm run dev`: start "Generate flashcards" on a course material, navigate to a lecture page, and confirm the chip tracks it and the material row shows its spinner when you come back. Start a syllabus parse and navigate away the same way.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/MaterialList.tsx src/components/course/CourseOverview.tsx
git commit -m "feat: run course material generation through the task provider"
```

---

### Task 8: Give the recorder an explicit teardown

Before the recorder can move into a provider, it needs the one thing it never had: a way to stop the microphone and drop a take on purpose.

**Files:**
- Modify: `src/components/recording/useMediaRecorder.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useMediaRecorder` returns one additional function, `discard(): void`, alongside its existing `status`, `elapsedSeconds`, `audioBlob`, `level`, `error`, `startRecording`, `stopRecording`, `pauseRecording`, `resumeRecording`, `reset`.

- [ ] **Step 1: Add `discard`**

In `src/components/recording/useMediaRecorder.ts`, add this callback next to `reset`, and add `discard` to the returned object:

```ts
/**
 * Throws the take away and releases the microphone. `reset()` only clears
 * state — before this existed, the only thing that stopped the tracks was the
 * `onstop` handler of a completed recording, so an abandoned session kept the
 * mic open and the browser's recording indicator lit.
 */
const discard = useCallback(() => {
  stopSegmentLoop(false);
  if (timerRef.current) clearInterval(timerRef.current);
  timerRef.current = null;
  const recorder = mediaRecorderRef.current;
  mediaRecorderRef.current = null;
  if (recorder && recorder.state !== "inactive") {
    // Drop the assembling handlers first: this take is not being saved.
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.stop();
  }
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;
  chunksRef.current = [];
  stopLevelMeter();
  setAudioBlob(null);
  setElapsedSeconds(0);
  setStatus("idle");
}, [stopSegmentLoop, stopLevelMeter]);
```

- [ ] **Step 2: Verify**

`discard` has no caller yet, so check that the tree compiles.
Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/recording/useMediaRecorder.ts
git commit -m "feat: let the recorder release the microphone explicitly"
```

---

### Task 9: RecordingProvider

The recorder, its live transcript, and its save flow move above the router. This is the task that stops the app destroying a lecture.

**Files:**
- Create: `src/components/recording/RecordingProvider.tsx`
- Modify: `src/components/dashboard/AppShell.tsx`

**Interfaces:**
- Consumes: `useMediaRecorder` (with `discard` from Task 8) and `type RecorderStatus` from `@/components/recording/useMediaRecorder`; `uploadAudio`, `transcribePage` from `@/components/recording/upload`; `useTasks` from `@/components/tasks/TaskProvider`.
- Produces:
  - `RecordingProvider({ children }: { children: React.ReactNode })`
  - `type RecordingSession = { pageId: string; pageTitle: string }`
  - `useRecording(): RecordingContextValue` with exactly these members:
    ```ts
    type RecordingContextValue = {
      session: RecordingSession | null;
      status: RecorderStatus;
      elapsedSeconds: number;
      level: number;
      audioBlob: Blob | null;
      error: string | null;
      liveTranscript: string;
      liveBusy: boolean;
      saving: boolean;
      saveError: string | null;
      start(page: { id: string; title: string }): Promise<void>;
      pause(): void;
      resume(): void;
      stop(): void;
      discard(): void;
      save(): Promise<void>;
    };
    ```

- [ ] **Step 1: Write the provider**

Create `src/components/recording/RecordingProvider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMediaRecorder, type RecorderStatus } from "@/components/recording/useMediaRecorder";
import { transcribePage, uploadAudio } from "@/components/recording/upload";
import { useTasks } from "@/components/tasks/TaskProvider";

export type RecordingSession = { pageId: string; pageTitle: string };

type RecordingContextValue = {
  session: RecordingSession | null;
  status: RecorderStatus;
  elapsedSeconds: number;
  level: number;
  audioBlob: Blob | null;
  error: string | null;
  liveTranscript: string;
  liveBusy: boolean;
  saving: boolean;
  saveError: string | null;
  start(page: { id: string; title: string }): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  discard(): void;
  save(): Promise<void>;
};

const RecordingContext = createContext<RecordingContextValue | null>(null);

/**
 * One recording, app-wide, owned above the router. Before this, the recorder
 * lived in the Transcript tab: clicking another tab mid-lecture unmounted the
 * component that held the blob, and the lecture was gone.
 */
export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { run } = useTasks();
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [liveBusy, setLiveBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Do NOT mirror `session` into a ref during render: it is a react-hooks lint
  // error here, and it pairs a current pageId with a stale audioBlob — the
  // mismatch that files a recording against the wrong lecture. save() reads
  // `session` from its own closure, so the pair is always consistent. A
  // separate ref written from a useEffect on [session] answers only "is this
  // still the current session?", which the save tail needs before it calls
  // recorder.reset() (not a state updater, so no functional-setter guard).
  const currentSessionRef = useRef<RecordingSession | null>(null);
  useEffect(() => {
    currentSessionRef.current = session;
  }, [session]);

  const handleLiveSegment = useCallback(async (blob: Blob) => {
    setLiveBusy(true);
    try {
      const formData = new FormData();
      formData.append("file", blob, "segment.webm");
      const res = await fetch("/api/live-transcribe", { method: "POST", body: formData });
      if (res.ok) {
        const { text } = await res.json();
        if (text?.trim()) setLiveTranscript((t) => (t ? `${t} ${text.trim()}` : text.trim()));
      }
    } finally {
      setLiveBusy(false);
    }
  }, []);

  const recorder = useMediaRecorder({ onLiveSegment: handleLiveSegment });

  const start = useCallback(
    async (page: { id: string; title: string }) => {
      // One recording at a time, app-wide (spec §3). Starting a second one
      // overwrites the recorder's refs, resets the shared chunk array so the
      // old take bleeds into the new one, and leaks the first stream's tracks
      // with the microphone still open. Refuse, quietly.
      const unsavedTake = recorder.status === "stopped" && recorder.audioBlob !== null;
      if (session || recorder.status === "recording" || recorder.status === "paused" || unsavedTake) return;
      setSaveError(null);
      setLiveTranscript("");
      setSession({ pageId: page.id, pageTitle: page.title });
      await recorder.startRecording();
    },
    [recorder, session]
  );

  const discard = useCallback(() => {
    recorder.discard();
    setSession(null);
    setLiveTranscript("");
    setSaveError(null);
  }, [recorder]);

  const save = useCallback(async () => {
    if (saving) return;
    const startedSession = session;
    const blob = recorder.audioBlob;
    if (!startedSession || !blob) return;
    const { pageId } = startedSession;
    setSaving(true);
    setSaveError(null);

    const uploaded = await uploadAudio(pageId, blob, "recording.webm", recorder.elapsedSeconds);
    if (!uploaded.ok) {
      // The blob stays in the provider so the panel can still offer it as a
      // download — this is the user's only copy of the lecture.
      setSaving(false);
      setSaveError(uploaded.error);
      return;
    }
    router.refresh();

    await run(
      { key: `page:${pageId}:transcribe`, label: "Transcribing the recording…", href: `/pages/${pageId}` },
      async () => {
        const transcribed = await transcribePage(pageId);
        if (!transcribed.ok) throw new Error(transcribed.error);
      }
    );

    setSaving(false);
    // A new session may have started while transcription ran; this tail must
    // not reset a recording it did not start.
    if (currentSessionRef.current !== startedSession) return;
    recorder.reset();
    setSession((prev) => (prev === startedSession ? null : prev));
    setLiveTranscript("");
    router.refresh();
  }, [recorder, router, run, session, saving]);

  const value = useMemo<RecordingContextValue>(
    () => ({
      session,
      status: recorder.status,
      elapsedSeconds: recorder.elapsedSeconds,
      level: recorder.level,
      audioBlob: recorder.audioBlob,
      error: recorder.error,
      liveTranscript,
      liveBusy,
      saving,
      saveError,
      start,
      pause: recorder.pauseRecording,
      resume: recorder.resumeRecording,
      stop: recorder.stopRecording,
      discard,
      save,
    }),
    [session, recorder, liveTranscript, liveBusy, saving, saveError, start, discard, save]
  );

  return <RecordingContext.Provider value={value}>{children}</RecordingContext.Provider>;
}

export function useRecording(): RecordingContextValue {
  const ctx = useContext(RecordingContext);
  if (!ctx) throw new Error("useRecording must be used inside <RecordingProvider>");
  return ctx;
}
```

- [ ] **Step 2: Mount it inside `TaskProvider`**

In `src/components/dashboard/AppShell.tsx`, nest it so `save()` can reach `useTasks()`:

```tsx
<TaskProvider>
  <RecordingProvider>
    <div className="flex h-full min-h-screen">{/* unchanged shell markup */}</div>
  </RecordingProvider>
</TaskProvider>
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. No behaviour change yet — `RecordingPanel` still owns its own recorder until Task 10.

- [ ] **Step 4: Commit**

```bash
git add src/components/recording/RecordingProvider.tsx src/components/dashboard/AppShell.tsx
git commit -m "feat: own the recording session above the router"
```

---

### Task 10: RecordingPanel consumes the provider

**Files:**
- Modify: `src/components/recording/RecordingPanel.tsx`
- Modify: `src/components/page-detail/TranscriptTab.tsx` (thread `pageTitle` through)
- Modify: `src/app/pages/[id]/page.tsx:81-88` (pass `pageTitle={page.title}` to `TranscriptTab`)

**Interfaces:**
- Consumes: `useRecording()` from `@/components/recording/RecordingProvider`.
- Produces: `RecordingPanel({ pageId, pageTitle }: { pageId: string; pageTitle: string })` — the prop list grows by one; `TranscriptTab` grows the same prop.

- [ ] **Step 1: Rewire the panel**

In `src/components/recording/RecordingPanel.tsx`:

1. Delete the `useMediaRecorder` call, the `liveTranscript`/`liveBusy` state, `handleLiveSegment`, `saveState`, `uploadError`, and `handleSave`.
2. Read everything from the provider, and add the ownership guard:

```tsx
import Link from "next/link";
import { useRecording } from "@/components/recording/RecordingProvider";
import type { RecorderStatus } from "@/components/recording/useMediaRecorder";

export function RecordingPanel({ pageId, pageTitle }: { pageId: string; pageTitle: string }) {
  const {
    session, status, elapsedSeconds, level, audioBlob, error,
    liveTranscript, liveBusy, saving, saveError,
    start, pause, resume, stop, discard, save,
  } = useRecording();

  const mine = session?.pageId === pageId;
  const elsewhere = session !== null && !mine;
  const busy = saving;
  // A session belonging to another lecture must not leak into this panel's
  // timer, level meter, or preview.
  const shown: RecorderStatus = mine ? status : "idle";
  const previewUrl = useMemo(
    () => (mine && audioBlob ? URL.createObjectURL(audioBlob) : null),
    [mine, audioBlob]
  );
```

3. When another page owns the microphone, say so instead of offering a second Record button:

```tsx
if (elsewhere && session) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line/80 bg-surface p-6 text-sm text-muted">
      <p>
        A recording is running for{" "}
        <Link href={`/pages/${session.pageId}`} className="font-medium text-brand-ink underline">
          {session.pageTitle}
        </Link>
        . Stop it before recording here — one microphone, one recording.
      </p>
    </div>
  );
}
```

4. The controls keep their exact markup; only the handlers and the status source change: `startRecording` becomes `() => start({ id: pageId, title: pageTitle })`, `pauseRecording` → `pause`, `resumeRecording` → `resume`, `stopRecording` → `stop`, the Save button's `onClick` → `save`, the Discard button's → `discard`. Replace every `status === …` conditional in the render with `shown === …`, and render `mine ? elapsedSeconds : 0` in the timer.
5. Keep the `saveError` block and its download-fallback link verbatim — it is the last line of defence for an unsaved lecture — reading `saveError` where it read `uploadError`, and keep the Save button's label driven by `saving`.
6. `handleExplain`, `explanation`, `explaining`, `explainError`, and the live-transcript rendering stay in the panel, reading `liveTranscript` and `liveBusy` from the provider.

- [ ] **Step 2: Thread `pageTitle` through**

In `src/components/page-detail/TranscriptTab.tsx`, add `pageTitle: string` to the props type and the destructure, and pass it on: `<RecordingPanel pageId={pageId} pageTitle={pageTitle} />`. In `src/app/pages/[id]/page.tsx`, add `pageTitle={page.title}` to the `<TranscriptTab …>` element.

- [ ] **Step 3: Verify the lecture-saving path in the browser**

Run: `npm run dev`, create a page with no audio, then:
1. Start recording. Switch to the Notes tab, then navigate to the dashboard. The recording keeps going — the shell has no bar yet (Task 11), so confirm via the browser's recording indicator and the advancing timer when you return.
2. Come back to the lecture page: the panel shows the running session with the right elapsed time and the accumulated live transcript.
3. Stop, then Save & transcribe. The audio saves and the transcript appears.
4. Start a recording, then open a second lecture page: its panel says a recording is running elsewhere and links back.
5. Start a recording and click Discard: the browser's recording indicator goes out — this is the leak Task 8 fixed.

- [ ] **Step 4: Verify the tree**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: clean, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/recording/RecordingPanel.tsx src/components/page-detail/TranscriptTab.tsx "src/app/pages/[id]/page.tsx"
git commit -m "fix: keep a recording alive across tabs and routes"
```

---

### Task 11: Recording bar in the shell header

What makes a recording *backgrounded* rather than merely *not destroyed*: it stays reachable, stoppable, and savable from anywhere.

**Files:**
- Create: `src/components/recording/RecordingBar.tsx`
- Modify: `src/components/dashboard/AppShell.tsx`

**Interfaces:**
- Consumes: `useRecording()` from `@/components/recording/RecordingProvider`, `Button` from `@/components/ui/Button`.
- Produces: `RecordingBar()` — no props.

- [ ] **Step 1: Write the bar**

Create `src/components/recording/RecordingBar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Mic, Pause, Play, Square } from "lucide-react";
import { useRecording } from "@/components/recording/RecordingProvider";
import { Button } from "@/components/ui/Button";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Shell-level controls for the one recording session. A lecture recorded from
 * the Transcript tab stays reachable from the dashboard, another course, or the
 * review queue — including its save, so stopping from here never strands audio.
 */
export function RecordingBar() {
  const {
    session, status, elapsedSeconds, level, audioBlob,
    saving, saveError, pause, resume, stop, discard, save,
  } = useRecording();

  if (!session) return null;
  const unsaved = status === "stopped" && !!audioBlob;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line/80 bg-red-50 px-4 py-2 text-[12.5px] sm:px-8 dark:bg-red-950/30">
      <span className="flex items-center gap-1.5 font-medium text-red-700">
        <Mic className="h-3.5 w-3.5" strokeWidth={2.4} />
        {status === "paused" ? "Paused" : unsaved ? "Unsaved recording" : "Recording"}
      </span>
      <span className="font-mono tabular-nums text-ink-soft">{formatElapsed(elapsedSeconds)}</span>
      {status === "recording" && (
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
          <span
            className="block h-full rounded-full bg-red-500 transition-all"
            style={{ width: `${Math.min(100, level * 220)}%` }}
          />
        </span>
      )}
      <Link href={`/pages/${session.pageId}`} className="truncate font-medium text-brand-ink underline">
        {session.pageTitle}
      </Link>
      <span className="ml-auto flex items-center gap-1.5">
        {status === "recording" && (
          <Button size="sm" variant="secondary" onClick={pause}>
            <Pause className="h-3.5 w-3.5" strokeWidth={2.2} /> Pause
          </Button>
        )}
        {status === "paused" && (
          <Button size="sm" onClick={resume}>
            <Play className="h-3.5 w-3.5" strokeWidth={2.2} /> Resume
          </Button>
        )}
        {(status === "recording" || status === "paused") && (
          <Button size="sm" variant="danger" onClick={stop}>
            <Square className="h-3.5 w-3.5" strokeWidth={2.2} /> Stop
          </Button>
        )}
        {unsaved && (
          <>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save & transcribe"}
            </Button>
            <Button size="sm" variant="secondary" onClick={discard} disabled={saving}>
              Discard
            </Button>
          </>
        )}
      </span>
      {saveError && (
        <p className="w-full font-medium text-red-700">
          {saveError} —{" "}
          <Link href={`/pages/${session.pageId}`} className="underline">
            open the lecture to download the recording
          </Link>
          .
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render it under the header**

In `src/components/dashboard/AppShell.tsx`, put `<RecordingBar />` immediately after the closing `</header>` tag and before `<main>`, so it spans the content column and never covers the nav.

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`:
1. Start a recording on a lecture, navigate to the dashboard — the bar is there with the elapsed time and the lecture's name.
2. Pause and resume from the bar; the panel on the lecture page agrees when you return.
3. Stop from the bar, then Save & transcribe from the bar while still on the dashboard. The audio lands on the right lecture and the chip shows the transcription task.
4. Confirm the bar disappears after a successful save, and after Discard.

- [ ] **Step 4: Commit**

```bash
git add src/components/recording/RecordingBar.tsx src/components/dashboard/AppShell.tsx
git commit -m "feat: control the running recording from the app header"
```

---

### Task 12: Full verification and review

**Files:**
- No production changes expected. Fix what the checks surface.

**Interfaces:**
- Consumes: everything above.
- Produces: a branch ready for a PR.

- [ ] **Step 1: Run every check**

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
```
Expected: all four clean. `npm run build` matters here because provider nesting and `"use client"` boundary mistakes fail at build time, not in dev.

- [ ] **Step 2: Walk the two paths that can lose user data**

With `npm run dev`:
1. Record 30 seconds, switch tabs twice, navigate to two other routes, come back, stop, save. Confirm the saved audio plays and the transcript matches what was said.
2. Record 15 seconds, stop, and with audio saving deliberately broken (rename the `storage/` directory) click Save. Confirm the error appears and the "Download the recording" link still hands over a playable file.

- [ ] **Step 3: Code review**

Dispatch the `ecc:react-reviewer` and `ecc:typescript-reviewer` agents on the branch diff, and `ecc:security-reviewer` as a separate pass. Have each report everything; fix what is real. Pay particular attention to: `useMemo` dependency lists in both providers, stale closures in `save()`, and whether any converted call site lost its `router.refresh()`.

- [ ] **Step 4: Independent test run**

Dispatch the `test-runner` agent to run the suite and report. It does not fix anything.

- [ ] **Step 5: Commit any review fixes**

```bash
git add -A
git commit -m "fix: address review findings in the background task providers"
```

---

## Out of scope (spec §3, §9)

Deliberate omissions — do not add them while implementing:

- Persisting tasks across a page reload.
- A server-side job queue, or detaching route handlers from their request.
- Replacing `setInterval` in `useMediaRecorder`'s live-segment loop, which still stalls live transcription when the *browser* tab is hidden. Separate PR.
- Hoisting `NotesTab`'s voice note or `InterviewRunner`'s answer recording into the provider.
- Carrying a half-streamed lecture chat answer across a route change.
- `NotesTab`'s undo, which still lives only in React state and is lost on refresh. Pre-existing; flag it, do not fix it here.
