# Lectern Phase 7 — The course study-plan agent

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Point Lectern at one course and get a week's study plan, produced by an agentic run that reads that course's own lectures, syllabus coverage, and review load, and creates the action items and calendar blocks it recommends.

**Architecture:** A Next route spawns the `claude` CLI in print mode. The CLI is given exactly one MCP server — `scripts/lectern-mcp.ts`, over stdio — whose seven tools are `fetch` calls against the running app's own API routes. The agent loop therefore runs in the CLI (billed to the user's existing Claude Code credential, not to Lectern), the business logic stays in the routes, and there is still one Prisma writer.

**Tech Stack:** TypeScript, Next 16 App Router, `@modelcontextprotocol/sdk` (already a dependency — server half), `zod`, `node:child_process`, `node --test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-08-study-plan-agent-design.md`

## Global Constraints

- **No new npm dependencies.** `@modelcontextprotocol/sdk@^1.30.0` and `zod@^4.4.3` are already in `dependencies`; the MCP server half ships in that same package.
- **`main` is protected** (`AGENTS.md`). All work lands on `feat/study-plan-agent` in the worktree `/Users/Work/Documents/Dev/Lectern-study-plan-agent`. Parallel sessions hold the other worktrees — never `git checkout` in `/Users/Work/Documents/Dev/Lectern`.
- **This worktree's dev server runs on port 3100**, not 3000. Another session is using 3000. Every command below assumes `PORT=3100`, and the `LECTERN_BASE_URL` defaults follow it.
- **No tool may write spaced-repetition state.** Nothing in this plan touches `ReviewLog`, `Flashcard.nextReviewAt`, `repetitions`, `interval`, or `easeFactor`. A wrong review write raises no error and shows no symptom.
- **Commit convention:** `<type>: <imperative lowercase phrase>`, one logical change per commit. No `Co-Authored-By` trailer on a commit whose content you did not write.
- Context cap for any transcript or notes text handed to the agent: **24,000 characters**, matching `MAX_CONTEXT_CHARS` in `src/app/api/pages/[id]/action-items/route.ts:11`.
- `src/lib/agent/lectern-api.ts` must import nothing and use `fetch` only. It is imported both by Next code (via `@/`) and by `scripts/lectern-mcp.ts` (via a relative `../src/...` path, the idiom in `scripts/reindex.ts:8`), and the script runs outside Next with no Prisma client and no path-alias resolution.

## File Structure

| File | Responsibility |
|---|---|
| `src/app/api/folders/[id]/search/route.ts` (new) | Expose `searchCourse` hits over HTTP. Today reachable only inside `/api/folders/[id]/ask`, which spends an LLM call turning them into prose. |
| `src/app/api/folders/[id]/coverage/route.ts` (new) | Expose per-topic syllabus coverage. Today computed inline in `src/app/folders/[folderId]/page.tsx`. |
| `src/lib/agent/lectern-api.ts` (new) | Base URL, a `fetch` wrapper that surfaces a route's `{error}` text, text truncation. Zero imports. |
| `src/lib/agent/args.ts` (new) | The CLI argument list and the inline MCP config JSON. The sandbox flags live here. |
| `src/lib/agent/stream.ts` (new) | One `stream-json` line → one `AgentEvent`, or null for lines this UI ignores. |
| `src/lib/agent/study-plan.ts` (new) | Spawn, timeout, abort, and an `AsyncGenerator<AgentEvent>`. |
| `src/lib/prompts/study-plan.ts` (new) | System prompt (with the untrusted-content clause) and the task prompt. |
| `scripts/lectern-mcp.ts` (new) | The stdio MCP server: seven tools, folder pinned by env. |
| `src/app/api/folders/[id]/study-plan/route.ts` (new) | Spawn the run, stream NDJSON events to the client. |
| `src/components/course/StudyPlanPanel.tsx` (new) | Client panel: button, live tool log, rendered plan. |
| `src/components/course/CourseOverview.tsx` (modify) | Mount the panel. |
| `src/app/api/pages/[id]/action-items/route.ts` (modify) | POST gains an optional body that creates items instead of extracting them. |
| `src/lib/validation.ts` (modify) | `createActionItemsSchema`. |
| `scripts/setup.sh` (modify) | Report a missing `claude` binary, like the existing `ffmpeg` check. |
| `README.md` (modify) | One bullet on the agent and its prerequisite. |

Tests: `src/lib/agent/lectern-api.test.ts`, `args.test.ts`, `stream.test.ts`, `study-plan.test.ts`, `src/lib/validation.test.ts`.

One coverage gap, stated rather than hidden: the MCP tools' own `inputSchema` declarations in `scripts/lectern-mcp.ts` have no unit test. Unit-testing them would mean either exporting them from a script whose top level connects a transport, or standing up an MCP client in-process — both more machinery than the risk warrants. They are exercised end to end by Task 3 Step 2 and Task 8 Step 8, and the write path's validation is tested at the route's schema (`createActionItemsSchema`), which is where a bad payload would actually do damage.

---

### Task 1: Worktree bootstrap and the two read routes

The worktree is a fresh checkout: no `node_modules`, no `.env` (gitignored), no `prisma/dev.db` (gitignored). The two new routes are read-only wrappers over functions that already exist and are already tested, so they are verified by calling them rather than by unit tests.

**Files:**
- Create: `src/app/api/folders/[id]/search/route.ts`
- Create: `src/app/api/folders/[id]/coverage/route.ts`

**Interfaces:**
- Consumes: `searchCourse(folderId, query, k)` and `scoreTopics(folderId, titles)` from `src/lib/embeddings.ts`; `classifyTopic`, `coverageThreshold`, `CoverageState`, `TopicMatch` from `src/lib/coverage.ts`; `jsonError` from `src/lib/api-utils.ts`.
- Produces: `GET /api/folders/[id]/search?q=&k=` → `{ hits: CourseHit[] }`. `GET /api/folders/[id]/coverage` → `{ coverage: CoverageState, topics: [{ id, title, week, covered, match: { title, score, pageId } | null }] }`.

- [ ] **Step 1: Install dependencies and bring up a database in this worktree**

```bash
cd /Users/Work/Documents/Dev/Lectern-study-plan-agent
npm install
cp ../Lectern/.env .env
cp ../Lectern/prisma/dev.db prisma/dev.db   # a real course library to plan against
```

The copied `.env` has `DATABASE_URL="file:./prisma/dev.db"` — a relative path, so it now points at this worktree's own copy. Nothing done here can corrupt another session's database.

- [ ] **Step 2: Confirm the app starts on port 3100**

Run: `PORT=3100 npm run dev`
Expected: `Local: http://localhost:3100`. Leave it running in a second terminal for the rest of this task. Use `npm run dev`, not `dev:all` — the whisper service is not needed here and would fight the other session's copy for its port.

- [ ] **Step 3: Write the course search route**

Create `src/app/api/folders/[id]/search/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { searchCourse } from "@/lib/embeddings";

export const runtime = "nodejs";

const DEFAULT_K = 8;
const MAX_K = 20;

// Semantic search over one course's chunks, as hits rather than prose.
// `/api/folders/[id]/ask` runs the same retrieval but spends an LLM call
// turning it into an answer; the agent wants the hits themselves.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json({ hits: [] });

  const raw = Number(req.nextUrl.searchParams.get("k") ?? DEFAULT_K);
  const k = Number.isFinite(raw) ? Math.min(MAX_K, Math.max(1, Math.trunc(raw))) : DEFAULT_K;

  try {
    return NextResponse.json({ hits: await searchCourse(id, q, k) });
  } catch (e) {
    // Embedding failures are the realistic case here (model not downloaded,
    // provider unreachable) — report them rather than returning empty hits,
    // which would read as "this course covers nothing".
    return jsonError(e instanceof Error ? e.message : "Course search failed", 502);
  }
}
```

- [ ] **Step 4: Write the coverage route**

Create `src/app/api/folders/[id]/coverage/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { classifyTopic, coverageThreshold, type CoverageState, type TopicMatch } from "@/lib/coverage";
import { scoreTopics } from "@/lib/embeddings";

export const runtime = "nodejs";

// Per-topic syllabus coverage. Same logic the course page runs inline in
// buildTopicRows(); this returns it without the UI's hrefs and mastery
// roll-up, which need card rows the agent has no use for.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const topics = await db.courseTopic.findMany({
    where: { folderId: id },
    orderBy: { order: "asc" },
    select: { id: true, title: true, week: true },
  });
  if (topics.length === 0) {
    return NextResponse.json({ coverage: "no-sources" satisfies CoverageState, topics: [] });
  }

  let matches: (TopicMatch | null)[];
  let coverage: CoverageState;
  try {
    const scores = await scoreTopics(id, topics.map((t) => t.title));
    matches = scores.matches;
    // The syllabus itself is excluded from scoring, so a course whose only
    // indexed material is its syllabus has nothing to check against.
    coverage = scores.indexed ? "scored" : "no-sources";
  } catch (e) {
    console.error(`[coverage] scoring topics for course ${id} failed:`, e);
    matches = topics.map(() => null);
    coverage = "failed";
  }

  const threshold = coverageThreshold();
  return NextResponse.json({
    coverage,
    topics: topics.map((topic, i) => {
      const { covered, match } = classifyTopic(matches[i], threshold);
      return {
        id: topic.id,
        title: topic.title,
        week: topic.week,
        covered,
        match: match
          ? { title: match.title, score: Number(match.score.toFixed(3)), pageId: match.pageId }
          : null,
      };
    }),
  });
}
```

- [ ] **Step 5: Call both routes against a real course**

```bash
FOLDER=$(curl -s localhost:3100/api/folders | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).folders[0].id))')
echo "course: $FOLDER"
curl -s "localhost:3100/api/folders/$FOLDER/coverage" | head -c 600; echo
curl -s "localhost:3100/api/folders/$FOLDER/search?q=introduction&k=3" | head -c 600
```

Expected: coverage returns `"coverage":"scored"` (or `"no-sources"` if that course has no syllabus topics) with one entry per topic; search returns up to 3 hits, each with `text`, `score`, `title`. The first search call is slow — the MiniLM model loads.

- [ ] **Step 6: Run lint and the existing suite**

Run: `npm run lint && npm test`
Expected: no new lint errors; all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/folders/[id]/search/route.ts" "src/app/api/folders/[id]/coverage/route.ts"
git commit -m "feat: expose course search hits and topic coverage over HTTP"
```

---

### Task 2: The API helper the MCP server reads through

**Files:**
- Create: `src/lib/agent/lectern-api.ts`
- Test: `src/lib/agent/lectern-api.test.ts`

**Interfaces:**
- Consumes: nothing. Zero imports by constraint — `scripts/lectern-mcp.ts` loads this file from outside Next.
- Produces: `MAX_TEXT_CHARS: 24000`, `lecternBaseUrl(): string`, `truncate(text: string, max?: number): string`, `lecternFetch<T>(path: string, init?: RequestInit): Promise<T>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/lectern-api.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_TEXT_CHARS, lecternBaseUrl, lecternFetch, truncate } from "./lectern-api.ts";

test("text at the cap is returned untouched", () => {
  const text = "x".repeat(MAX_TEXT_CHARS);
  assert.equal(truncate(text), text);
});

test("text over the cap is cut and says how much is missing", () => {
  const out = truncate("x".repeat(MAX_TEXT_CHARS + 500));
  assert.ok(out.startsWith("x".repeat(100)));
  assert.match(out, /500 more characters/);
});

test("the base URL is overridable, because this worktree runs on 3100", () => {
  const previous = process.env.LECTERN_BASE_URL;
  process.env.LECTERN_BASE_URL = "http://127.0.0.1:3100";
  assert.equal(lecternBaseUrl(), "http://127.0.0.1:3100");
  if (previous === undefined) delete process.env.LECTERN_BASE_URL;
  else process.env.LECTERN_BASE_URL = previous;
});

test("a route's own error message is what the caller sees", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "Page not found" }), { status: 404 });
  try {
    await assert.rejects(() => lecternFetch("/api/pages/nope"), /Page not found/);
  } finally {
    globalThis.fetch = original;
  }
});

test("an unreachable app says the app is unreachable, not 'fetch failed'", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("fetch failed");
  };
  try {
    await assert.rejects(() => lecternFetch("/api/folders"), /is not reachable/);
  } finally {
    globalThis.fetch = original;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/agent/lectern-api.test.ts`
Expected: FAIL — cannot find module `./lectern-api.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/agent/lectern-api.ts`:

```typescript
/**
 * The MCP server's only way to reach Lectern's data: HTTP against the running
 * app. It holds no Prisma client on purpose — request validation, FTS
 * re-indexing, and the single database writer all stay in the API routes.
 *
 * Imports nothing: scripts/lectern-mcp.ts loads this file outside Next, where
 * `@/` aliases do not resolve and no Prisma client is initialized.
 */

/** Same cap the chat and action-item routes use for model context. */
export const MAX_TEXT_CHARS = 24_000;

export function lecternBaseUrl(): string {
  return process.env.LECTERN_BASE_URL ?? "http://127.0.0.1:3000";
}

/** Cut long text and say so, rather than letting the model assume it saw all of it. */
export function truncate(text: string, max = MAX_TEXT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated — ${text.length - max} more characters]`;
}

export async function lecternFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${lecternBaseUrl()}${path}`, init);
  } catch {
    // A bare "fetch failed" tells the agent nothing it can act on, and this is
    // by far the most likely failure: the dev server is not up.
    throw new Error(`Lectern is not reachable at ${lecternBaseUrl()} — is the dev server running?`);
  }

  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) throw new Error(body?.error ?? `${path} returned ${res.status}`);
  return body as T;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/agent/lectern-api.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/lectern-api.ts src/lib/agent/lectern-api.test.ts
git commit -m "feat: add the HTTP helper the agent's MCP server reads through"
```

---

### Task 3: The MCP server with read tools

Five read tools. The course is fixed by `LECTERN_FOLDER_ID` in this process's environment and is never a tool argument, so the model cannot read another course or widen its own scope.

**Files:**
- Create: `scripts/lectern-mcp.ts`

**Interfaces:**
- Consumes: `lecternFetch`, `truncate` from `../src/lib/agent/lectern-api.ts`; `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`; `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`; `z` from `zod`.
- Produces: an stdio MCP server named `lectern` exposing `list_lectures`, `get_lecture`, `search_course`, `topic_coverage`, `review_load`. Tool names reach the CLI as `mcp__lectern__<name>`. Task 8 appends `create_action_items` and `schedule_reviews`, reusing the `text()` and `failure()` helpers defined here.

- [ ] **Step 1: Write the server**

Create `scripts/lectern-mcp.ts`:

```typescript
/**
 * Lectern as an MCP server: the tools the study-plan agent runs with.
 *
 * Spawned by src/lib/agent/study-plan.ts over stdio, once per run. The course
 * is pinned by LECTERN_FOLDER_ID in the environment — never a tool argument —
 * so a model cannot read a course it was not pointed at.
 *
 * Run by hand:
 *   LECTERN_FOLDER_ID=<id> LECTERN_BASE_URL=http://127.0.0.1:3100 \
 *     claude --mcp-config '{"mcpServers":{"lectern":{"command":"node","args":["--import","tsx","scripts/lectern-mcp.ts"]}}}'
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { lecternFetch, truncate } from "../src/lib/agent/lectern-api.ts";

const folderId = process.env.LECTERN_FOLDER_ID;
if (!folderId) {
  // stderr, not stdout: stdout is the MCP transport.
  console.error("lectern-mcp: LECTERN_FOLDER_ID is not set — refusing to start unscoped");
  process.exit(1);
}

const server = new McpServer({ name: "lectern", version: "1.0.0" });

/** Every tool returns text; a thrown error becomes an error result the agent can read and route around. */
function text(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
    ],
  };
}
function failure(e: unknown) {
  return {
    content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
    isError: true,
  };
}

server.registerTool(
  "list_lectures",
  {
    description:
      "Every lecture in this course: title, status, date, and how many flashcards and quiz questions it has. Start here.",
    inputSchema: {},
  },
  async () => {
    try {
      const { pages } = await lecternFetch<{
        pages: {
          id: string;
          title: string;
          status: string;
          createdAt: string;
          _count: { flashcards: number; quizQuestions: number };
        }[];
      }>(`/api/pages?folderId=${encodeURIComponent(folderId)}`);
      return text(
        pages.map((p) => ({
          pageId: p.id,
          title: p.title,
          status: p.status,
          date: p.createdAt.slice(0, 10),
          flashcards: p._count.flashcards,
          quizQuestions: p._count.quizQuestions,
        }))
      );
    } catch (e) {
      return failure(e);
    }
  }
);

server.registerTool(
  "get_lecture",
  {
    description:
      "One lecture's notes or raw transcript. Prefer notes; reach for the transcript only when the notes are missing or too thin to judge. Long text is truncated.",
    inputSchema: {
      pageId: z.string().min(1).describe("A pageId from list_lectures"),
      part: z.enum(["notes", "transcript"]).describe("Which body of text to read"),
    },
  },
  async ({ pageId, part }) => {
    try {
      const { page } = await lecternFetch<{
        page: {
          title: string;
          notes: { markdown: string } | null;
          transcript: { rawText: string; cleanText: string | null } | null;
        };
      }>(`/api/pages/${encodeURIComponent(pageId)}`);

      const body =
        part === "notes" ? page.notes?.markdown : (page.transcript?.cleanText ?? page.transcript?.rawText);
      if (!body) return text(`"${page.title}" has no ${part} yet.`);
      return text(`# ${page.title}\n\n${truncate(body)}`);
    } catch (e) {
      return failure(e);
    }
  }
);

server.registerTool(
  "search_course",
  {
    description:
      "Semantic search over everything indexed for this course — lecture transcripts, notes, and materials. Use it to find where a topic is actually taught.",
    inputSchema: {
      query: z.string().min(1).describe("What to look for, in the course's own words"),
      k: z.number().int().min(1).max(20).optional().describe("How many hits (default 8)"),
    },
  },
  async ({ query, k }) => {
    try {
      const params = new URLSearchParams({ q: query, ...(k ? { k: String(k) } : {}) });
      const { hits } = await lecternFetch<{
        hits: { text: string; score: number; source: string; title: string; pageId: string | null }[];
      }>(`/api/folders/${encodeURIComponent(folderId)}/search?${params}`);
      if (hits.length === 0) return text("No indexed content matched that query.");
      return text(
        hits.map((h) => ({
          title: h.title,
          score: Number(h.score.toFixed(3)),
          source: h.source,
          pageId: h.pageId,
          text: truncate(h.text, 1200),
        }))
      );
    } catch (e) {
      return failure(e);
    }
  }
);

server.registerTool(
  "topic_coverage",
  {
    description:
      "Every syllabus topic for this course and whether anything captured actually teaches it, with the closest match and its score. Scores are a heuristic — a topic marked uncovered may still be taught under different words, so check with search_course or get_lecture before calling a gap real.",
    inputSchema: {},
  },
  async () => {
    try {
      const data = await lecternFetch<{
        coverage: "scored" | "no-sources" | "failed";
        topics: {
          title: string;
          week: number | null;
          covered: boolean;
          match: { title: string; score: number } | null;
        }[];
      }>(`/api/folders/${encodeURIComponent(folderId)}/coverage`);

      if (data.coverage === "no-sources") {
        return text(
          "No coverage verdict: this course has no syllabus topics, or nothing indexed to check them against."
        );
      }
      if (data.coverage === "failed") {
        return text("Coverage scoring failed for this course — treat every topic as unknown rather than uncovered.");
      }
      return text(data.topics);
    } catch (e) {
      return failure(e);
    }
  }
);

server.registerTool(
  "review_load",
  {
    description: "Flashcards from this course that are due for review now, with the lecture each came from.",
    inputSchema: { limit: z.number().int().min(1).max(100).optional().describe("Cap on cards listed (default 50)") },
  },
  async ({ limit }) => {
    try {
      const params = new URLSearchParams({ folderId, limit: String(limit ?? 50) });
      const { cards, total } = await lecternFetch<{
        cards: { prompt: string; page: { title: string } | null; material: { title: string } | null }[];
        total: number;
      }>(`/api/review/due?${params}`);
      return text({
        totalDue: total,
        cards: cards.map((c) => ({ prompt: c.prompt, from: c.page?.title ?? c.material?.title ?? "Unknown" })),
      });
    } catch (e) {
      return failure(e);
    }
  }
);

await server.connect(new StdioServerTransport());
```

- [ ] **Step 2: Verify the server starts and its tools work**

With the dev server still running on 3100:

```bash
FOLDER=$(curl -s localhost:3100/api/folders | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).folders[0].id))')
LECTERN_FOLDER_ID=$FOLDER LECTERN_BASE_URL=http://127.0.0.1:3100 \
  claude -p "List the tools you have, then call topic_coverage and summarize what it returned in three sentences." \
  --mcp-config "{\"mcpServers\":{\"lectern\":{\"command\":\"node\",\"args\":[\"--import\",\"tsx\",\"scripts/lectern-mcp.ts\"],\"env\":{\"LECTERN_FOLDER_ID\":\"$FOLDER\",\"LECTERN_BASE_URL\":\"http://127.0.0.1:3100\"}}}}" \
  --strict-mcp-config --allowedTools "mcp__lectern__*" --permission-prompts none --restricted
```

Expected: it names five `mcp__lectern__*` tools and reports real topics from your course. This is the spec's phase 1 proving itself with no Lectern UI involved.

- [ ] **Step 3: Verify the scope guard**

Run: `node --import tsx scripts/lectern-mcp.ts`
Expected: exits non-zero with `lectern-mcp: LECTERN_FOLDER_ID is not set — refusing to start unscoped`. An unscoped server must never come up.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/lectern-mcp.ts
git commit -m "feat: serve one course's lectures, coverage and review load over MCP"
```

---

### Task 4: The CLI argument list

These flags are the agent's sandbox. They get their own test file because a refactor that quietly drops one must fail something.

**Files:**
- Create: `src/lib/agent/args.ts`
- Test: `src/lib/agent/args.test.ts`

**Interfaces:**
- Consumes: `node:path`.
- Produces: `claudeBinary(): string`, `mcpConfigJson(folderId: string): string`, `claudeArgs(opts: { prompt: string; systemPrompt: string; folderId: string; model?: string; effort?: string }): string[]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/args.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeArgs, claudeBinary, mcpConfigJson } from "./args.ts";

const opts = { prompt: "plan my week", systemPrompt: "you are Lectern", folderId: "folder-1" };

test("the sandbox flags are all present", () => {
  const args = claudeArgs(opts);
  // Each of these is load-bearing: without them the run inherits the user's
  // own MCP servers, gains a shell, or hangs on a prompt nobody can answer.
  for (const flag of ["--strict-mcp-config", "--restricted", "--permission-prompts", "--allowedTools"]) {
    assert.ok(args.includes(flag), `missing ${flag}`);
  }
  assert.equal(args[args.indexOf("--permission-prompts") + 1], "none");
  assert.equal(args[args.indexOf("--allowedTools") + 1], "mcp__lectern__*");
});

test("it runs in print mode and streams json", () => {
  const args = claudeArgs(opts);
  assert.ok(args.includes("-p"));
  assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
  assert.ok(args.includes("--include-partial-messages"));
});

test("the prompt is an argument value, never interpolated into a shell string", () => {
  const args = claudeArgs({ ...opts, prompt: "; rm -rf /" });
  assert.ok(args.includes("; rm -rf /"));
  assert.equal(args[args.indexOf("--append-system-prompt") + 1], "you are Lectern");
});

test("the mcp config names the server 'lectern' and pins the folder", () => {
  const config = JSON.parse(mcpConfigJson("folder-1"));
  const server = config.mcpServers.lectern;
  assert.equal(server.env.LECTERN_FOLDER_ID, "folder-1");
  assert.ok(server.args.some((a: string) => a.endsWith("scripts/lectern-mcp.ts")));
});

test("the binary is overridable, so tests can stub the CLI", () => {
  const previous = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = "/tmp/fake-claude";
  assert.equal(claudeBinary(), "/tmp/fake-claude");
  if (previous === undefined) delete process.env.CLAUDE_BIN;
  else process.env.CLAUDE_BIN = previous;
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/agent/args.test.ts`
Expected: FAIL — cannot find module `./args.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/agent/args.ts`:

```typescript
import path from "node:path";

/**
 * How the study-plan run is invoked. The flags here are the agent's sandbox,
 * not preferences — see args.test.ts, which fails if one goes missing.
 */

export function claudeBinary(): string {
  return process.env.CLAUDE_BIN || "claude";
}

/**
 * The MCP config is passed inline rather than as a temp file, so a killed run
 * leaves nothing to clean up. The server is spawned the way package.json runs
 * its other scripts: node with tsx's loader.
 */
export function mcpConfigJson(folderId: string): string {
  return JSON.stringify({
    mcpServers: {
      lectern: {
        command: process.execPath,
        args: ["--import", "tsx", path.join(process.cwd(), "scripts", "lectern-mcp.ts")],
        env: {
          LECTERN_FOLDER_ID: folderId,
          LECTERN_BASE_URL: process.env.LECTERN_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`,
          // tsx resolves from node_modules, and the loader needs PATH/HOME
          // like any other child process.
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
        },
      },
    },
  });
}

export function claudeArgs(opts: {
  prompt: string;
  systemPrompt: string;
  folderId: string;
  model?: string;
  effort?: string;
}): string[] {
  return [
    "-p",
    opts.prompt,
    "--model",
    opts.model ?? process.env.AGENT_MODEL ?? "opus",
    "--effort",
    opts.effort ?? process.env.AGENT_EFFORT ?? "medium",
    "--append-system-prompt",
    opts.systemPrompt,
    "--mcp-config",
    mcpConfigJson(opts.folderId),
    // Ignore the user's own Claude Code MCP servers: a study plan must not
    // reach their Notion or their filesystem because it happens to be
    // configured there.
    "--strict-mcp-config",
    // Pre-approve Lectern's tools; anything else is denied rather than
    // blocking on a permission prompt no human is watching.
    "--allowedTools",
    "mcp__lectern__*",
    "--permission-prompts",
    "none",
    // No Bash, no other code runners, no WebFetch.
    "--restricted",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/agent/args.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/args.ts src/lib/agent/args.test.ts
git commit -m "feat: build the sandboxed claude invocation for a study-plan run"
```

---

### Task 5: The stream-json line parser

The CLI emits one JSON object per line. `readline` in Task 6 does the line assembly, so this file is per-line and pure — a deliberate simplification of the spec's §11, which described a chunk-buffering parser. The buffering lives in `readline` rather than being re-implemented.

**Files:**
- Create: `src/lib/agent/stream.ts`
- Test: `src/lib/agent/stream.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type AgentEvent = { type: "tool"; name: string } | { type: "text"; text: string } | { type: "result"; text: string; isError: boolean }`, and `parseAgentLine(line: string): AgentEvent | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent/stream.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAgentLine } from "./stream.ts";

test("a tool call becomes a tool event under its bare name", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "mcp__lectern__topic_coverage", input: {} }] },
  });
  assert.deepEqual(parseAgentLine(line), { type: "tool", name: "topic_coverage" });
});

test("assistant text becomes a text event", () => {
  const line = JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "text", text: "Looking at week 3." }] },
  });
  assert.deepEqual(parseAgentLine(line), { type: "text", text: "Looking at week 3." });
});

test("the final result carries the plan", () => {
  const line = JSON.stringify({ type: "result", subtype: "success", result: "# Your week", is_error: false });
  assert.deepEqual(parseAgentLine(line), { type: "result", text: "# Your week", isError: false });
});

test("an errored result is flagged, not dropped", () => {
  const line = JSON.stringify({ type: "result", subtype: "error_during_execution", result: "ran out", is_error: true });
  assert.deepEqual(parseAgentLine(line), { type: "result", text: "ran out", isError: true });
});

test("lines this UI has no use for are ignored, not thrown on", () => {
  // The CLI's event vocabulary is larger than what the panel renders, and it
  // grows between versions — an unknown line must never kill a run.
  assert.equal(parseAgentLine(JSON.stringify({ type: "system", subtype: "init" })), null);
  assert.equal(parseAgentLine(JSON.stringify({ type: "user", message: { content: [] } })), null);
  assert.equal(parseAgentLine("not json at all"), null);
  assert.equal(parseAgentLine(""), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/agent/stream.test.ts`
Expected: FAIL — cannot find module `./stream.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/agent/stream.ts`:

```typescript
/**
 * One line of the CLI's `--output-format stream-json` output, reduced to the
 * three things the study-plan panel shows. Everything else is ignored: the
 * CLI's event vocabulary is bigger than this and changes between versions, so
 * an unrecognized line must be inert rather than fatal.
 */
export type AgentEvent =
  | { type: "tool"; name: string }
  | { type: "text"; text: string }
  | { type: "result"; text: string; isError: boolean };

type Block = { type: string; name?: string; text?: string };

export function parseAgentLine(line: string): AgentEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let event: { type?: string; result?: unknown; is_error?: unknown; message?: { content?: Block[] } };
  try {
    event = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (event.type === "result") {
    return {
      type: "result",
      text: typeof event.result === "string" ? event.result : "",
      isError: event.is_error === true,
    };
  }

  if (event.type === "assistant") {
    for (const block of event.message?.content ?? []) {
      // "mcp__lectern__search_course" reads as noise in a UI; the tool's own
      // name is what a student recognizes.
      if (block.type === "tool_use" && block.name) {
        return { type: "tool", name: block.name.replace(/^mcp__lectern__/, "") };
      }
      if (block.type === "text" && block.text?.trim()) {
        return { type: "text", text: block.text };
      }
    }
  }

  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/agent/stream.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/stream.ts src/lib/agent/stream.test.ts
git commit -m "feat: read the CLI's stream-json output as study-plan events"
```

---

### Task 6: The runner and the prompt

**Files:**
- Create: `src/lib/prompts/study-plan.ts`
- Create: `src/lib/agent/study-plan.ts`
- Test: `src/lib/agent/study-plan.test.ts`

**Interfaces:**
- Consumes: `claudeArgs`, `claudeBinary` from `@/lib/agent/args`; `parseAgentLine`, `AgentEvent` from `@/lib/agent/stream`; `UNTRUSTED_CONTENT_CLAUSE` from `@/lib/prompts/shared`.
- Produces: `STUDY_PLAN_SYSTEM_PROMPT: string`, `buildStudyPlanPrompt(opts: { courseName: string; topics: string[] }): string`, and `runStudyPlan(opts: { folderId: string; courseName: string; topics: string[]; signal?: AbortSignal }): AsyncGenerator<AgentEvent>`.

- [ ] **Step 1: Write the prompt module**

Create `src/lib/prompts/study-plan.ts`:

```typescript
import { UNTRUSTED_CONTENT_CLAUSE } from "@/lib/prompts/shared";

/**
 * The study-plan agent's contract. The untrusted-content clause matters more
 * here than in any other Lectern prompt: this model reads recorded speech and
 * uploaded material *and* holds write tools, so transcript text that reads
 * like an instruction has to stay content.
 */
export const STUDY_PLAN_SYSTEM_PROMPT = `You plan a student's study week for one university course inside Lectern, their course library.

You have read tools over this one course only — its lectures, its syllabus topic coverage, and its due flashcards — and two write tools. Work like this:

1. Start with list_lectures and topic_coverage to see what exists and what the syllabus says should exist.
2. Coverage scores are a heuristic over embedding similarity, not a verdict. Before you call a topic uncovered, check it with search_course, and read the closest lecture with get_lecture if the search is ambiguous. Report a gap only when you have looked.
3. Check review_load, because cards already due outrank new material.
4. Then write the plan: what to study, in what order, why, and roughly how long each block takes. Name real lectures and real topics — never invent one.
5. Create action items for the concrete next steps with create_action_items, and call schedule_reviews if cards are due. Say plainly what you created.

Write the plan as markdown: a short paragraph on where the course stands, then the week's blocks, then what you created. No preamble about being an assistant.

If a tool fails, say so in the plan and continue with what you have. A plan missing one section is worth more than no plan.

${UNTRUSTED_CONTENT_CLAUSE}`;

export function buildStudyPlanPrompt({ courseName, topics }: { courseName: string; topics: string[] }): string {
  const syllabus = topics.length > 0 ? topics.map((t) => `- ${t}`).join("\n") : "(no syllabus topics parsed yet)";
  return `Course: ${courseName}

Syllabus topics on record:
${syllabus}

Plan my study week for this course.`;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/agent/study-plan.test.ts`:

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runStudyPlan } from "./study-plan.ts";

/** A stand-in for the CLI: a node script that prints stream-json lines. */
async function fakeClaude(body: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "lectern-fake-claude-"));
  const file = path.join(dir, "fake-claude.mjs");
  await writeFile(file, body);
  return file;
}

async function collect(script: string) {
  const previousBin = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = process.execPath;
  process.env.AGENT_FAKE_SCRIPT = script;
  try {
    const events = [];
    for await (const event of runStudyPlan({ folderId: "f1", courseName: "Stats", topics: ["Bayes"] })) {
      events.push(event);
    }
    return events;
  } finally {
    delete process.env.AGENT_FAKE_SCRIPT;
    if (previousBin === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = previousBin;
  }
}

test("events stream out in order and the plan arrives as the result", async () => {
  const script = await fakeClaude(`
    console.log(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__lectern__list_lectures" }] } }));
    console.log(JSON.stringify({ type: "result", subtype: "success", result: "# Your week", is_error: false }));
  `);
  const events = await collect(script);
  assert.deepEqual(events[0], { type: "tool", name: "list_lectures" });
  assert.deepEqual(events.at(-1), { type: "result", text: "# Your week", isError: false });
});

test("a crash with no result event is an error, not a silent empty plan", async () => {
  const script = await fakeClaude(`process.stderr.write("boom\\n"); process.exit(2);`);
  await assert.rejects(() => collect(script), /boom|without producing a plan/);
});

test("a missing claude binary says how to fix it", async () => {
  const previous = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = "/nonexistent/claude";
  try {
    await assert.rejects(async () => {
      for await (const _event of runStudyPlan({ folderId: "f1", courseName: "Stats", topics: [] })) {
        // drained only so the generator runs
      }
    }, /was not found/);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_BIN;
    else process.env.CLAUDE_BIN = previous;
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/agent/study-plan.test.ts`
Expected: FAIL — cannot find module `./study-plan.ts`.

- [ ] **Step 4: Write the runner**

Create `src/lib/agent/study-plan.ts`:

```typescript
import { spawn } from "node:child_process";
import readline from "node:readline";
import { claudeArgs, claudeBinary } from "@/lib/agent/args";
import { parseAgentLine, type AgentEvent } from "@/lib/agent/stream";
import { STUDY_PLAN_SYSTEM_PROMPT, buildStudyPlanPrompt } from "@/lib/prompts/study-plan";

// ponytail: five minutes covers a plan that makes twenty tool calls on a cold
// embedding model. There is no --max-turns in the installed CLI build, so this
// is the only ceiling on a run — same reasoning as CHILD_TIMEOUT_MS in
// mac-speech.ts. Raise it if honest plans start hitting it.
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function timeoutMs(): number {
  const raw = Number(process.env.AGENT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

/**
 * Runs one study-plan agent and yields its events as they arrive.
 *
 * The child is bounded three ways: the caller's AbortSignal (the user closed
 * the panel), the spawn timeout (a wedged run), and stdout closing. Killing
 * `claude` closes the MCP server's stdio, so the three-process tree collapses
 * from the top.
 */
export async function* runStudyPlan(opts: {
  folderId: string;
  courseName: string;
  topics: string[];
  signal?: AbortSignal;
}): AsyncGenerator<AgentEvent> {
  const args = claudeArgs({
    folderId: opts.folderId,
    prompt: buildStudyPlanPrompt({ courseName: opts.courseName, topics: opts.topics }),
    systemPrompt: STUDY_PLAN_SYSTEM_PROMPT,
  });

  // The test harness runs a stub script through node in place of the CLI.
  const fake = process.env.AGENT_FAKE_SCRIPT;
  const child = spawn(claudeBinary(), fake ? [fake] : args, {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs(),
    signal: opts.signal,
    cwd: process.cwd(),
  });

  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  const failure = new Promise<never>((_resolve, reject) => {
    child.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT") {
        reject(
          new Error(
            `The "${claudeBinary()}" command was not found. Install Claude Code and sign in, or set CLAUDE_BIN to its path.`
          )
        );
      } else {
        reject(e);
      }
    });
  });
  // Nothing awaits this unless the child errors; without a handler an early
  // rejection would surface as an unhandled rejection.
  failure.catch(() => undefined);

  let sawResult = false;
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

  try {
    // Racing each line against the error promise turns a spawn failure into a
    // thrown error at the call site rather than a generator that ends empty.
    const iterator = lines[Symbol.asyncIterator]();
    for (;;) {
      const next = await Promise.race([iterator.next(), failure]);
      if (next.done) break;
      const event = parseAgentLine(next.value);
      if (!event) continue;
      if (event.type === "result") sawResult = true;
      yield event;
    }
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }

  if (!sawResult) {
    const detail = Buffer.concat(stderr).toString("utf8").trim().split("\n").at(-1);
    throw new Error(detail || `${claudeBinary()} exited without producing a plan`);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/agent/study-plan.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the whole suite and lint**

Run: `npm test && npm run lint`
Expected: every suite passes; lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/agent/study-plan.ts src/lib/agent/study-plan.test.ts src/lib/prompts/study-plan.ts
git commit -m "feat: run a bounded study-plan agent and stream its events"
```

---

### Task 7: The route and the panel

**Files:**
- Create: `src/app/api/folders/[id]/study-plan/route.ts`
- Create: `src/components/course/StudyPlanPanel.tsx`
- Modify: `src/components/course/CourseOverview.tsx` (import at the top; mount after the header row that ends at line 141)

**Interfaces:**
- Consumes: `runStudyPlan` from `@/lib/agent/study-plan`; `AgentEvent` from `@/lib/agent/stream`; `jsonError` from `@/lib/api-utils`; `db` from `@/lib/db`.
- Produces: `POST /api/folders/[id]/study-plan` streaming newline-delimited `AgentEvent` JSON (plus `{ type: "error", message }` for a mid-stream failure); `<StudyPlanPanel folderId={string} />`.

- [ ] **Step 1: Write the route**

Create `src/app/api/folders/[id]/study-plan/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { runStudyPlan } from "@/lib/agent/study-plan";

export const runtime = "nodejs";
// The run is minutes long by design; it must not be buffered or retried.
export const dynamic = "force-dynamic";

// Streams the agent's events as newline-delimited JSON, so the panel can show
// tool calls as they happen instead of a spinner over a minute of silence.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const folder = await db.folder.findUnique({ where: { id }, select: { name: true } });
  if (!folder) return jsonError("Course not found", 404);

  const topics = await db.courseTopic.findMany({
    where: { folderId: id },
    orderBy: { order: "asc" },
    select: { title: true },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of runStudyPlan({
          folderId: id,
          courseName: folder.name,
          topics: topics.map((t) => t.title),
          // The user closing the panel kills the process tree, rather than
          // leaving `claude` holding an MCP server holding a socket.
          signal: req.signal,
        })) {
          send(event);
        }
      } catch (e) {
        // The response is already 200 by the time this can happen, so the
        // error travels as an event and the panel renders it.
        send({ type: "error", message: e instanceof Error ? e.message : "The study-plan run failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
```

- [ ] **Step 2: Write the panel**

Create `src/components/course/StudyPlanPanel.tsx`:

```typescript
"use client";

import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CalendarClock, Loader2 } from "lucide-react";
import type { AgentEvent } from "@/lib/agent/stream";

type PanelEvent = AgentEvent | { type: "error"; message: string };

export function StudyPlanPanel({ folderId }: { folderId: string }) {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<string[]>([]);
  const [plan, setPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function run() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setSteps([]);
    setPlan(null);
    setError(null);

    try {
      const res = await fetch(`/api/folders/${folderId}/study-plan`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Could not start the study-plan run");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
          if (event.type === "tool") setSteps((s) => [...s, event.name.replace(/_/g, " ")]);
          else if (event.type === "result") setPlan(event.text);
          else if (event.type === "error") setError(event.message);
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError(e instanceof Error ? e.message : "The study-plan run failed");
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <CalendarClock className="h-4 w-4 text-brand-ink" strokeWidth={2.2} />
            Study plan
          </h3>
          <p className="mt-0.5 text-[13px] text-muted">
            Reads this course&apos;s lectures, coverage and due cards, then plans the week.
          </p>
        </div>
        <button
          onClick={run}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-[13px] font-medium text-white shadow-brand transition-opacity hover:opacity-95 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> : null}
          {running ? "Planning…" : plan ? "Plan again" : "Plan my week"}
        </button>
      </div>

      {steps.length > 0 && !plan && (
        <ul className="flex flex-col gap-1 text-[13px] text-muted">
          {steps.map((step, i) => (
            <li key={`${step}-${i}`}>· {step}</li>
          ))}
        </ul>
      )}

      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {plan && (
        <div className="prose prose-sm max-w-none text-ink">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount the panel on the course page**

In `src/components/course/CourseOverview.tsx`, add the import beside the existing ones at the top:

```typescript
import { StudyPlanPanel } from "@/components/course/StudyPlanPanel";
```

Then, inside the outermost `<div className="flex flex-col gap-4">` returned at line 111, immediately after the `</div>` that closes the header row (the block ending at line 141), insert:

```tsx
      <StudyPlanPanel folderId={folderId} />
```

- [ ] **Step 4: Run a plan from the UI**

With `PORT=3100 npm run dev` up, open `http://localhost:3100`, open a course with a syllabus and at least two lectures, and click **Plan my week**.
Expected: tool names appear one by one (`list lectures`, `topic coverage`, …), then a markdown plan naming real lectures. Then close the panel mid-run and confirm no MCP server is left behind:

```bash
ps ax | grep -c "[l]ectern-mcp"   # expect 0
```

- [ ] **Step 5: Lint and test**

Run: `npm run lint && npm test`
Expected: clean; all pass.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/folders/[id]/study-plan/route.ts" src/components/course/StudyPlanPanel.tsx src/components/course/CourseOverview.tsx
git commit -m "feat: plan a course's study week from its overview page"
```

---

### Task 8: The two write tools

Both writes are reversible in one click, so they execute directly with no propose-then-apply gate. Nothing here touches spaced-repetition state.

**Files:**
- Modify: `src/lib/validation.ts` (add after `actionItemsResponseSchema`, near line 245)
- Modify: `src/app/api/pages/[id]/action-items/route.ts` (the `POST` handler at line 22)
- Modify: `scripts/lectern-mcp.ts` (append two `registerTool` calls before `server.connect`)
- Test: `src/lib/validation.test.ts` (create if absent)

**Interfaces:**
- Consumes: `withValidation` from `@/lib/api-utils`; `createActionItemsSchema` from `@/lib/validation`; `lecternFetch`, `text`, `failure` already defined in `scripts/lectern-mcp.ts` (Task 3).
- Produces: `createActionItemsSchema`; `POST /api/pages/[id]/action-items` with an optional `{ items: [{ kind, text }] }` body returning `{ items }`; MCP tools `create_action_items`, `schedule_reviews`.

- [ ] **Step 1: Write the failing schema test**

Create `src/lib/validation.test.ts` (or append these tests if the file already exists):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { createActionItemsSchema } from "./validation.ts";

test("a well-formed batch of action items parses", async () => {
  const parsed = await createActionItemsSchema.parseAsync({
    items: [{ kind: "ACTION", text: "Re-read the Bayes lecture notes" }],
  });
  assert.equal(parsed.items[0].kind, "ACTION");
});

test("an unknown kind is rejected", async () => {
  await assert.rejects(() =>
    createActionItemsSchema.parseAsync({ items: [{ kind: "REMINDER", text: "nope" }] })
  );
});

test("an empty batch is rejected, so a no-op write cannot look like a success", async () => {
  await assert.rejects(() => createActionItemsSchema.parseAsync({ items: [] }));
});

test("an oversized batch is rejected", async () => {
  const items = Array.from({ length: 51 }, () => ({ kind: "ACTION" as const, text: "x" }));
  await assert.rejects(() => createActionItemsSchema.parseAsync({ items }));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/validation.test.ts`
Expected: FAIL — `createActionItemsSchema` is not exported.

- [ ] **Step 3: Add the schema**

In `src/lib/validation.ts`, immediately after `actionItemsResponseSchema`:

```typescript
/**
 * Action items supplied by a caller rather than extracted from a transcript —
 * the study-plan agent's write path. Same three kinds the extractor produces.
 */
export const createActionItemsSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["ACTION", "DECISION", "QUESTION"]),
        text: z.string().min(1).max(500),
      })
    )
    .min(1)
    .max(50),
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/validation.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Extend the action-items POST**

In `src/app/api/pages/[id]/action-items/route.ts`, merge into the existing imports (`jsonError` is already imported — do not duplicate it):

```typescript
import { jsonError, withValidation } from "@/lib/api-utils";
import { actionItemsResponseSchema, createActionItemsSchema } from "@/lib/validation";
```

Change the `POST` signature's `_req: NextRequest` to `req: NextRequest`, then insert this at the top of its body, before the existing page lookup:

```typescript
  // With a body, the caller already knows what the items are; without one,
  // POST still means "extract them from the transcript", as it always has.
  const body = await req.json().catch(() => null);
  if (body && typeof body === "object" && "items" in body) {
    const validated = await withValidation(createActionItemsSchema, body);
    if ("error" in validated) return validated.error;

    const { id: pageId } = await params;
    const target = await db.page.findUnique({ where: { id: pageId }, select: { id: true } });
    if (!target) return jsonError("Page not found", 404);

    await db.actionItem.createMany({
      data: validated.data.items.map((item) => ({ pageId, kind: item.kind, text: item.text })),
    });
    const items = await db.actionItem.findMany({ where: { pageId }, orderBy: { createdAt: "asc" } });
    return NextResponse.json({ items });
  }
```

- [ ] **Step 6: Verify both POST shapes still work**

```bash
PAGE=$(curl -s "localhost:3100/api/pages" | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).pages[0].id))')
curl -s -X POST "localhost:3100/api/pages/$PAGE/action-items" \
  -H 'content-type: application/json' \
  -d '{"items":[{"kind":"ACTION","text":"plan-agent smoke test"}]}' | head -c 300
curl -s "localhost:3100/api/pages/$PAGE/action-items" | grep -c "plan-agent smoke test"
```

Expected: the POST returns the item list including the new row; the grep prints `1`. Delete that test row from the lecture page afterwards. Then confirm the extraction path still works by clicking the lecture's existing action-item extraction button in the UI.

- [ ] **Step 7: Add the two write tools**

In `scripts/lectern-mcp.ts`, before `await server.connect(...)`:

```typescript
server.registerTool(
  "create_action_items",
  {
    description:
      "Record concrete next steps against one lecture, so they appear on that lecture's page. Use ACTION for something to do, QUESTION for something to ask. One call per lecture; keep each item to one sentence.",
    inputSchema: {
      pageId: z.string().min(1).describe("The lecture the steps belong to"),
      items: z
        .array(
          z.object({
            kind: z.enum(["ACTION", "DECISION", "QUESTION"]),
            text: z.string().min(1).max(500),
          })
        )
        .min(1)
        .max(20),
    },
  },
  async ({ pageId, items }) => {
    try {
      const { items: saved } = await lecternFetch<{ items: unknown[] }>(
        `/api/pages/${encodeURIComponent(pageId)}/action-items`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items }),
        }
      );
      return text(`Created ${items.length} item(s); this lecture now has ${saved.length}.`);
    } catch (e) {
      return failure(e);
    }
  }
);

server.registerTool(
  "schedule_reviews",
  {
    description:
      "Put spaced-repetition review sessions on the student's real calendar — one event per upcoming day that already has cards due, over the next 7 days. You choose whether to schedule; the times come from the student's own settings. Omit pageId to cover the whole library.",
    inputSchema: {
      pageId: z.string().min(1).optional().describe("Scope to one lecture's cards"),
    },
  },
  async ({ pageId }) => {
    try {
      const { createdDays } = await lecternFetch<{ createdDays: string[] }>(
        "/api/integrations/calendar/schedule-reviews",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(pageId ? { pageId } : {}),
        }
      );
      return text(`Scheduled review sessions on: ${createdDays.join(", ")}`);
    } catch (e) {
      // No calendar MCP configured, or nothing due — both come back as the
      // route's own message, which is what the plan should say happened.
      return failure(e);
    }
  }
);
```

- [ ] **Step 8: Run a full plan with writes enabled**

Click **Plan my week** on a course that has due cards.
Expected: the plan names the action items it created, and they are visible on the lecture's page. If Google Calendar is not configured in `mcp.config.json`, the plan says scheduling failed and still finishes — that is the designed behaviour, not a bug.

- [ ] **Step 9: Lint and test**

Run: `npm run lint && npm test`
Expected: clean; all pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/validation.ts src/lib/validation.test.ts "src/app/api/pages/[id]/action-items/route.ts" scripts/lectern-mcp.ts
git commit -m "feat: let the study-plan agent record next steps and schedule reviews"
```

---

### Task 9: Setup check and documentation

**Files:**
- Modify: `scripts/setup.sh` (beside the existing `ffmpeg` check)
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing code-facing.

- [ ] **Step 1: Add the binary check to setup**

Find the `ffmpeg` check in `scripts/setup.sh` and add the same shape beside it. Report, never install — matching how `ffmpeg` is handled:

```bash
if ! command -v claude >/dev/null 2>&1; then
  echo "Note: the 'claude' CLI is not on your PATH. The course study-plan agent needs it"
  echo "      (install Claude Code and sign in); everything else works without it."
fi
```

- [ ] **Step 2: Document the feature**

In `README.md`, add a bullet to the "How it's built" list:

```markdown
- **Study-plan agent**: a per-course agentic run. Lectern spawns the [`claude` CLI](https://claude.com/claude-code) in print mode with one MCP server of its own (`scripts/lectern-mcp.ts`) that exposes that course's lectures, syllabus coverage, and due cards. The agent reads them, writes a week's plan, and records the action items and review blocks it recommends. It runs on your existing Claude Code credential rather than an API key, and it can only see the one course it was pointed at.
```

And in the prerequisites, beside `ffmpeg`:

```markdown
- **The `claude` CLI** (optional): only the study-plan agent needs it. Install Claude Code and sign in.
```

- [ ] **Step 3: Verify setup is still idempotent**

Run: `npm run setup`
Expected: completes, skipping finished steps; prints the `claude` note only when the binary is missing.

- [ ] **Step 4: Commit**

```bash
git add scripts/setup.sh README.md
git commit -m "docs: note the claude CLI the study-plan agent needs"
```

---

### Task 10: Review and open the pull request

- [ ] **Step 1: Read your own diff**

Run: `git diff main...HEAD --stat && git diff main...HEAD`
Check: no leftover debug logging, no commented-out blocks, no unused imports, and no smoke-test action items left in the database.

- [ ] **Step 2: Run every check**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: all pass. `tsc --noEmit` is the one that catches a route handler whose `params` type drifted.

- [ ] **Step 3: Request review**

Use the `superpowers:requesting-code-review` skill, then the repository's own gate: the TypeScript and React reviewers plus `ecc:security-reviewer` as a separate pass. The security pass matters here specifically — the agent reads untrusted transcript text and holds two write tools.

- [ ] **Step 4: Open the PR**

Use the `pr-create` skill for the description. Title:

```
feat(agent, courses): plan a course's study week with an agentic run
```

Base `main`, head `feat/study-plan-agent`. The description must explain the three-process tree and why the kill paths exist — that is the part a reviewer cannot infer from the diff.
