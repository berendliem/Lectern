# Import from onQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A course's Materials tab gets an "Import from onQ" button that lists the linked onQ course's files as a checklist and imports the ticked ones as materials, replacing the download-then-drop-in routine.

**Architecture:** Lectern already runs MCP servers as child processes (`src/lib/mcp/client.ts`, `mcp.config.json`). onq-mcp becomes one more server. Pure logic (result parsing, kind guessing, new/imported/changed annotation, the import loop) lives in `src/lib` with node:test coverage; three thin routes do the DB glue; one client component drives a per-topic import through the existing `TaskProvider` so it survives navigation. The material's text never passes through a model.

**Tech Stack:** Next.js (app router), Prisma 7 + SQLite, zod, `@modelcontextprotocol/sdk` 1.30, node:test via tsx, Tailwind, lucide-react.

**Spec:** `../onq-mcp/docs/superpowers/specs/2026-09-17-lectern-import-design.md`. The onq-mcp side is planned in `../onq-mcp/docs/superpowers/plans/2026-09-17-lectern-import-onq.md`; this plan does not depend on it landing first — everything here is tested against mocked tool results, and only Task 8 (manual check) needs the real server.

## Global Constraints

- **Work only in this worktree:** `Lectern/.claude/worktrees/feat+onq-import`, branch `feat/onq-import`. Other agents are building in the main checkout and sibling worktrees. Never `cd` to `../Lectern` itself, never touch its `prisma/dev.db`, never run a dev server on port 3000 or 3100.
- This worktree's `.env` uses the relative `DATABASE_URL="file:./prisma/dev.db"`, which resolves to a database private to the worktree. Do not point it anywhere else.
- Pure modules under `src/lib` that have tests import siblings with **relative paths and the `.ts` extension** (`"./onq-parse.ts"`) and never import `@/…` — node:test runs them without the Next alias. See `src/lib/mcp/notion-parse.ts` / `calendar-schema.ts`.
- Tests are node:test: `import { test } from "node:test"; import assert from "node:assert/strict";`. Run one file with `node --import tsx --test <path>`; all with `npm test`. There are no route or component tests in this repo — do not add a framework for them.
- Migrations are hand-authored SQL (the FTS5 tables make `prisma migrate dev` propose destructive diffs — see the comment in `prisma/migrations/20260911180000_calendar_events/migration.sql`). Apply with `npx prisma migrate deploy`, then `npx prisma generate`.
- onq-mcp tool-result field names are a contract: `course_id`, `name`, `module_id`, `title`, `topics`, `topic_id`, `extension`, `downloadable`, `last_modified`, `source_file_name`, `text`, `note`. Parse with zod, ignore unknown keys.
- FastMCP returns a `list[...]` tool result as **one text block per element** plus `structuredContent: { result: [...] }` (verified against mcp 1.30). `callMcpTool` joins blocks with `\n`, which is not valid JSON for lists — use the new `callMcpToolJson` for every onq call.
- Material text limit is `MAX_TEXT_CHARS` from `src/lib/limits.ts` (600 000). Over-limit topics are skipped with a reason, never truncated.
- Copy is sentence case, plain, no exclamation marks; errors say what to do next. Match `MaterialUploadButton.tsx`'s tone and Tailwind classes.
- Leave the tree clean: no commented-out code, no unused imports, no stray files.

## File Structure

| File | Responsibility |
|---|---|
| `mcp.config.example.json` | documents the `onq` server entry |
| `src/lib/mcp/tool-json.ts` (+ `.test.ts`) | pure: text and JSON out of an MCP tool result |
| `src/lib/mcp/client.ts` | adds `callMcpToolJson`; `callMcpTool` reuses the shared call path |
| `src/lib/mcp/onq-parse.ts` (+ `.test.ts`) | pure: zod parsing of the three onq tool results into camelCase types |
| `src/lib/mcp/onq.ts` | thin wrappers: `listOnqCourses`, `onqCourseContent`, `readOnqTopic` |
| `src/lib/onq-import.ts` (+ `.test.ts`) | pure: `guessKind`, `annotateTree`, `defaultSelection`, `bestCourseMatch`, `materialFromTopic`, `isSessionError`, `runImport` |
| `prisma/schema.prisma`, `prisma/migrations/20260917120000_onq_import/migration.sql` | `Folder.onqCourseId`, `Material.onqTopicId`, `Material.onqLastModified` |
| `src/lib/validation.ts` | `updateFolderSchema` accepts `onqCourseId`; new `importOnqTopicSchema` |
| `src/app/api/onq/courses/route.ts` | GET onQ course list |
| `src/app/api/folders/[id]/onq/route.ts` | GET annotated tree for the linked course |
| `src/app/api/folders/[id]/onq/import/route.ts` | POST import one topic |
| `src/components/dashboard/OnqImportButton.tsx` | the button, course picker, checklist, task runner |
| `src/app/folders/[folderId]/page.tsx` | mounts the button beside "Add material" |

One deliberate change from the spec's first draft: the import route takes **one** topic per request and the client loops (through `runImport`), instead of one request carrying every id. A 40-file course at up to 120 s a file would otherwise be a single multi-minute HTTP request with no progress; per-topic gives `TaskProvider` a step per file and lets a dead session stop the loop early. The spec has been updated to match.

---

### Task 0: Worktree setup

**Files:** none committed.

- [ ] **Step 1: Install and create the private database**

```bash
cd "Lectern/.claude/worktrees/feat+onq-import"
cp .env.example .env
npm ci
npx prisma migrate deploy
npx prisma generate
```

- [ ] **Step 2: Baseline**

Run: `npm test` — Expected: all pass. Record the pass count; later tasks only add to it.
Run: `npx tsc --noEmit` — Expected: no errors. If the baseline is already red, stop and report; do not fix unrelated failures.

---

### Task 1: JSON tool results from the MCP client

**Files:**
- Create: `src/lib/mcp/tool-json.ts`, `src/lib/mcp/tool-json.test.ts`
- Modify: `src/lib/mcp/client.ts` (the `callMcpTool` function, ~lines 86-122), `mcp.config.example.json`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `toolResultText(result: ToolResultLike): string`
  - `toolResultJson(result: ToolResultLike): unknown`
  - `callMcpToolJson(serverName: string, toolName: string, args: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>`

- [ ] **Step 1: Write the failing test**

`src/lib/mcp/tool-json.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { toolResultJson, toolResultText } from "./tool-json.ts";

test("joins text blocks and ignores non-text ones", () => {
  const text = toolResultText({
    content: [{ type: "text", text: "a" }, { type: "image", data: "…" }, { type: "text", text: "b" }],
  });
  assert.equal(text, "a\nb");
});

test("unwraps FastMCP's { result } envelope around a list", () => {
  // A list[dict] tool: one text block per element, which joined is not JSON.
  // The structured form is the only faithful one.
  const out = toolResultJson({
    content: [{ type: "text", text: '{"a":1}' }, { type: "text", text: '{"a":2}' }],
    structuredContent: { result: [{ a: 1 }, { a: 2 }] },
  });
  assert.deepEqual(out, [{ a: 1 }, { a: 2 }]);
});

test("an empty list has no text blocks at all", () => {
  assert.deepEqual(toolResultJson({ content: [], structuredContent: { result: [] } }), []);
});

test("returns a structured object as is when it is not the envelope", () => {
  const out = toolResultJson({ content: [], structuredContent: { topic_id: 1, result: "x" } });
  assert.deepEqual(out, { topic_id: 1, result: "x" });
});

test("falls back to parsing the text when nothing is structured", () => {
  // A `-> dict` FastMCP tool sends one JSON text block and no structuredContent.
  assert.deepEqual(toolResultJson({ content: [{ type: "text", text: '{"topic_id":1}' }] }), { topic_id: 1 });
});

test("says what it got when the text is not JSON", () => {
  assert.throws(
    () => toolResultJson({ content: [{ type: "text", text: "Sorry, something went wrong." }] }),
    /not JSON.*Sorry, something went wrong/
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/lib/mcp/tool-json.test.ts`
Expected: FAIL — cannot find module `./tool-json.ts`.

- [ ] **Step 3: Implement `tool-json.ts`**

```ts
// Reading an MCP tool result. Kept free of the client so it can be tested
// without spawning a server.

export type ToolResultLike = { content?: unknown; structuredContent?: unknown };

/** The result's text blocks, joined. Other block types are ignored. */
export function toolResultText(result: ToolResultLike): string {
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks
    .filter((b): b is { type: "text"; text: string } => b?.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

/**
 * The result as JSON. Prefers structuredContent: a FastMCP tool that returns a
 * list sends one text block per element — which joined is not JSON — and the
 * faithful copy only in `structuredContent.result`. A tool returning a plain
 * dict sends no structured content at all, just one JSON text block.
 */
export function toolResultJson(result: ToolResultLike): unknown {
  const structured = result.structuredContent;
  if (structured && typeof structured === "object") {
    const keys = Object.keys(structured);
    if (keys.length === 1 && keys[0] === "result") return (structured as { result: unknown }).result;
    return structured;
  }

  const text = toolResultText(result);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`The MCP tool's reply was not JSON: ${text.slice(0, 200)}`);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test src/lib/mcp/tool-json.test.ts` — Expected: 6 pass.

- [ ] **Step 5: Add `callMcpToolJson` to the client**

In `src/lib/mcp/client.ts`, add `import { toolResultJson, toolResultText } from "@/lib/mcp/tool-json";` and replace the whole `callMcpTool` function with:

```ts
async function callRaw(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  opts?: { timeoutMs?: number }
) {
  const client = await getMcpClient(serverName);

  let result;
  try {
    result = await client.callTool({ name: toolName, arguments: args }, undefined, {
      timeout: opts?.timeoutMs ?? CALL_TIMEOUT_MS,
    });
  } catch (e) {
    // A dead child process (server crashed, laptop slept) leaves a wedged
    // client; drop it so the next call reconnects fresh. Per-call failures
    // (timeouts, validation errors) keep the client — the process is alive,
    // and respawning it would defeat the whole point of caching.
    const message = e instanceof Error ? e.message : String(e);
    if (/connection closed|not connected|transport|EPIPE|ECONNRESET|write after end/i.test(message)) {
      await disconnectMcpClient(serverName);
    }
    throw e;
  }

  if (result.isError) {
    throw new Error(toolResultText(result) || `The ${serverName} MCP tool "${toolName}" returned an error.`);
  }
  return result;
}

/** Calls a tool and returns the concatenated text content blocks. */
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  opts?: { timeoutMs?: number }
): Promise<string> {
  return toolResultText(await callRaw(serverName, toolName, args, opts));
}

/** Calls a tool whose result is JSON and returns it parsed. See toolResultJson. */
export async function callMcpToolJson(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  opts?: { timeoutMs?: number }
): Promise<unknown> {
  return toolResultJson(await callRaw(serverName, toolName, args, opts));
}
```

(The comment block inside the `catch` is the existing one, moved — not new prose.)

- [ ] **Step 6: Document the server entry**

In `mcp.config.example.json`, add a third server after `google-calendar`:

```json
    "onq": {
      "command": "uv",
      "args": ["run", "--directory", "/absolute/path/to/onq-mcp", "onq-mcp"],
      "env": {}
    }
```

- [ ] **Step 7: Verify and commit**

Run: `npm test && npx tsc --noEmit` — Expected: all pass, no type errors.

```bash
git add src/lib/mcp/tool-json.ts src/lib/mcp/tool-json.test.ts src/lib/mcp/client.ts mcp.config.example.json
git commit -m "feat(mcp): read JSON tool results, including FastMCP list results"
```

---

### Task 2: Parse onq-mcp's tool results

**Files:**
- Create: `src/lib/mcp/onq-parse.ts`, `src/lib/mcp/onq-parse.test.ts`, `src/lib/mcp/onq.ts`

**Interfaces:**
- Consumes: `callMcpToolJson` from Task 1.
- Produces (all exported from `onq-parse.ts`):

```ts
type OnqCourse = { courseId: number; name: string };
type OnqTopic = { topicId: number; title: string; extension: string | null; downloadable: boolean; lastModified: string | null };
type OnqModule = { moduleId: number; title: string; topics: OnqTopic[] };
type OnqTopicText = OnqTopic & { text: string | null; note: string | null; sourceFileName: string | null };
parseOnqCourses(raw: unknown): OnqCourse[]
parseOnqModules(raw: unknown): OnqModule[]
parseOnqTopicText(raw: unknown): OnqTopicText
```

  and from `onq.ts`: `listOnqCourses(): Promise<OnqCourse[]>`, `onqCourseContent(courseId: number): Promise<OnqModule[]>`, `readOnqTopic(courseId: number, topicId: number): Promise<OnqTopicText>`.

- [ ] **Step 1: Write the failing test**

`src/lib/mcp/onq-parse.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOnqCourses, parseOnqModules, parseOnqTopicText } from "./onq-parse.ts";

test("reads courses and drops fields Lectern does not use", () => {
  const out = parseOnqCourses([{ course_id: 100001, name: "CISC 102", code: "X", active: true }]);
  assert.deepEqual(out, [{ courseId: 100001, name: "CISC 102" }]);
});

test("reads a module tree", () => {
  const out = parseOnqModules([
    {
      module_id: 100,
      title: "Unit 1",
      topics: [
        {
          topic_id: 200,
          title: "Slides",
          type: "File",
          extension: "pptx",
          downloadable: true,
          last_modified: "2026-09-08T14:02:11.000Z",
          source_file_name: "w1.pptx",
        },
      ],
    },
  ]);
  assert.deepEqual(out, [
    {
      moduleId: 100,
      title: "Unit 1",
      topics: [
        { topicId: 200, title: "Slides", extension: "pptx", downloadable: true, lastModified: "2026-09-08T14:02:11.000Z" },
      ],
    },
  ]);
});

test("an older onq-mcp without the new fields reads as nothing downloadable", () => {
  // Before onq-mcp learned `downloadable`, topics carried only id/title/type/
  // extension. Greyed-out rows are a clearer failure than a crash.
  const out = parseOnqModules([{ module_id: 1, title: "U", topics: [{ topic_id: 2, title: "T", extension: null }] }]);
  assert.deepEqual(out[0].topics[0], {
    topicId: 2,
    title: "T",
    extension: null,
    downloadable: false,
    lastModified: null,
  });
});

test("a null title becomes a label rather than failing the whole tree", () => {
  const out = parseOnqModules([{ module_id: 1, title: null, topics: [{ topic_id: 2, title: null }] }]);
  assert.equal(out[0].title, "Untitled");
  assert.equal(out[0].topics[0].title, "Untitled");
});

test("reads a topic's text", () => {
  const out = parseOnqTopicText({
    topic_id: 200,
    title: "Slides",
    extension: "pptx",
    downloadable: true,
    last_modified: "2026-09-08T14:02:11.000Z",
    source_file_name: "w1.pptx",
    text: "# Week 1",
    cached: false,
  });
  assert.equal(out.text, "# Week 1");
  assert.equal(out.sourceFileName, "w1.pptx");
  assert.equal(out.note, null);
});

test("a topic that could not be read keeps its note", () => {
  const out = parseOnqTopicText({
    topic_id: 9,
    title: "Site",
    text: null,
    link: "https://example.edu/",
    note: "Not a downloadable file; open the link directly.",
  });
  assert.equal(out.text, null);
  assert.equal(out.note, "Not a downloadable file; open the link directly.");
});

test("names the tool when the shape is wrong", () => {
  assert.throws(() => parseOnqModules({ nope: true }), /course_content/);
  assert.throws(() => parseOnqCourses("x"), /list_courses/);
  assert.throws(() => parseOnqTopicText([]), /read_topic/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/lib/mcp/onq-parse.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `onq-parse.ts`**

```ts
// The shapes onq-mcp's tools return, read into Lectern's own types. Kept free
// of the MCP client so it can be tested without spawning a server. The
// snake_case field names are a contract with onq-mcp (see its README, "Using
// from Lectern"); unknown keys are ignored so it can add fields freely.
import { z } from "zod";

export type OnqCourse = { courseId: number; name: string };
export type OnqTopic = {
  topicId: number;
  title: string;
  extension: string | null;
  downloadable: boolean;
  lastModified: string | null;
};
export type OnqModule = { moduleId: number; title: string; topics: OnqTopic[] };
export type OnqTopicText = OnqTopic & {
  text: string | null;
  note: string | null;
  sourceFileName: string | null;
};

const title = z
  .string()
  .nullish()
  .transform((t) => t?.trim() || "Untitled");

const courseSchema = z.object({ course_id: z.number().int(), name: z.string() });

// `downloadable` and `last_modified` default rather than fail: an onq-mcp from
// before those fields existed then reads as "nothing here can be imported",
// which the dialog shows plainly, instead of an opaque parse error.
const topicSchema = z.object({
  topic_id: z.number().int(),
  title,
  extension: z.string().nullish().default(null),
  downloadable: z.boolean().default(false),
  last_modified: z.string().nullish().default(null),
});

const moduleSchema = z.object({ module_id: z.number().int(), title, topics: z.array(topicSchema) });

const topicTextSchema = topicSchema.extend({
  text: z.string().nullable(),
  note: z.string().nullish().default(null),
  source_file_name: z.string().nullish().default(null),
});

function toTopic(t: z.infer<typeof topicSchema>): OnqTopic {
  return {
    topicId: t.topic_id,
    title: t.title,
    extension: t.extension ?? null,
    downloadable: t.downloadable,
    lastModified: t.last_modified ?? null,
  };
}

function parse<T>(schema: z.ZodType<T>, raw: unknown, tool: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `onq-mcp's ${tool} returned a shape Lectern does not recognise. Update onq-mcp, then try again. (${result.error.issues[0]?.message ?? "unknown"})`
    );
  }
  return result.data;
}

export function parseOnqCourses(raw: unknown): OnqCourse[] {
  return parse(z.array(courseSchema), raw, "list_courses").map((c) => ({ courseId: c.course_id, name: c.name }));
}

export function parseOnqModules(raw: unknown): OnqModule[] {
  return parse(z.array(moduleSchema), raw, "course_content").map((m) => ({
    moduleId: m.module_id,
    title: m.title,
    topics: m.topics.map(toTopic),
  }));
}

export function parseOnqTopicText(raw: unknown): OnqTopicText {
  const t = parse(topicTextSchema, raw, "read_topic");
  return { ...toTopic(t), text: t.text, note: t.note ?? null, sourceFileName: t.source_file_name ?? null };
}
```

If zod's input/output typing makes `parse<T>(schema: z.ZodType<T>, …)` reject the transformed schemas, type the parameter as `z.ZodType<T, z.ZodTypeDef, unknown>` (zod 3) or use `z.output<typeof schema>` at the call sites (zod 4) — check the installed major with `npm ls zod`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test src/lib/mcp/onq-parse.test.ts` — Expected: 7 pass.

- [ ] **Step 5: Add the wrappers**

`src/lib/mcp/onq.ts`:

```ts
import { callMcpToolJson } from "@/lib/mcp/client";
import {
  parseOnqCourses,
  parseOnqModules,
  parseOnqTopicText,
  type OnqCourse,
  type OnqModule,
  type OnqTopicText,
} from "@/lib/mcp/onq-parse";

export const ONQ_SERVER = "onq";

// read_topic downloads the file from onQ and converts it to markdown; a large
// scanned PDF takes far longer than the client's 60s default.
const READ_TOPIC_TIMEOUT_MS = 120_000;

export async function listOnqCourses(): Promise<OnqCourse[]> {
  return parseOnqCourses(await callMcpToolJson(ONQ_SERVER, "list_courses", { active_only: true }));
}

export async function onqCourseContent(courseId: number): Promise<OnqModule[]> {
  return parseOnqModules(await callMcpToolJson(ONQ_SERVER, "course_content", { course_id: courseId }));
}

export async function readOnqTopic(courseId: number, topicId: number): Promise<OnqTopicText> {
  return parseOnqTopicText(
    await callMcpToolJson(
      ONQ_SERVER,
      "read_topic",
      { course_id: courseId, topic_id: topicId },
      { timeoutMs: READ_TOPIC_TIMEOUT_MS }
    )
  );
}
```

- [ ] **Step 6: Verify and commit**

Run: `npm test && npx tsc --noEmit` — Expected: all pass.

```bash
git add src/lib/mcp/onq-parse.ts src/lib/mcp/onq-parse.test.ts src/lib/mcp/onq.ts
git commit -m "feat(onq): typed wrappers over onq-mcp's course and topic tools"
```

---

### Task 3: Import rules (pure)

**Files:**
- Create: `src/lib/onq-import.ts`, `src/lib/onq-import.test.ts`

**Interfaces:**
- Consumes: types `OnqCourse`, `OnqModule`, `OnqTopic`, `OnqTopicText` from `./mcp/onq-parse.ts`.
- Produces:

```ts
type MaterialKind = "SYLLABUS" | "SLIDES" | "READING" | "OTHER";
type TopicStatus = "new" | "imported" | "changed" | "unavailable";
type AnnotatedTopic = OnqTopic & { status: TopicStatus };
type AnnotatedModule = { moduleId: number; title: string; topics: AnnotatedTopic[] };
type ImportedRef = { onqTopicId: number | null; onqLastModified: string | null };
type MaterialDraft = { kind: MaterialKind; title: string; text: string; sourceFileName: string | null; onqTopicId: number; onqLastModified: string | null };
type ImportTarget = { topicId: number; title: string; moduleTitle: string };
type ImportOutcome = { outcome: "imported" | "updated" | "skipped"; reason?: string };
type ImportSummary = { imported: number; updated: number; skipped: { title: string; reason: string }[]; aborted: string | null };

guessKind(extension: string | null, title: string, moduleTitle: string): MaterialKind
annotateTree(modules: OnqModule[], existing: ImportedRef[]): AnnotatedModule[]
defaultSelection(modules: AnnotatedModule[]): number[]
bestCourseMatch(folderName: string, courses: OnqCourse[]): number | null
materialFromTopic(topic: OnqTopicText, moduleTitle: string, maxChars: number): { draft: MaterialDraft } | { skip: string }
isSessionError(message: string): boolean
runImport(targets: ImportTarget[], importOne: (t: ImportTarget) => Promise<ImportOutcome>, onStep: (text: string) => void): Promise<ImportSummary>
```

- [ ] **Step 1: Write the failing test**

`src/lib/onq-import.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  annotateTree,
  bestCourseMatch,
  defaultSelection,
  guessKind,
  isSessionError,
  materialFromTopic,
  runImport,
  type ImportTarget,
} from "./onq-import.ts";
import type { OnqModule, OnqTopicText } from "./mcp/onq-parse.ts";

const topic = (topicId: number, over: Partial<OnqModule["topics"][number]> = {}) => ({
  topicId,
  title: `Topic ${topicId}`,
  extension: "pdf",
  downloadable: true,
  lastModified: "2026-09-01T00:00:00.000Z",
  ...over,
});

test("guesses slides from the extension", () => {
  assert.equal(guessKind("pptx", "Week 2", "Unit 1"), "SLIDES");
  assert.equal(guessKind("key", "Week 2", "Unit 1"), "SLIDES");
});

test("guesses a syllabus from either title, ahead of the extension", () => {
  assert.equal(guessKind("pdf", "CISC102 Course Syllabus", "Start here"), "SYLLABUS");
  assert.equal(guessKind("pdf", "F26 outline", "Course Outline"), "SYLLABUS");
  assert.equal(guessKind("pptx", "Syllabus walkthrough", "Week 1"), "SYLLABUS");
});

test("everything else is a reading", () => {
  assert.equal(guessKind("pdf", "Chapter 3", "Unit 1"), "READING");
  assert.equal(guessKind(null, "Chapter 3", "Unit 1"), "READING");
});

test("annotates each topic against what is already imported", () => {
  const modules: OnqModule[] = [
    {
      moduleId: 1,
      title: "Unit 1",
      topics: [
        topic(10),
        topic(11),
        topic(12, { lastModified: "2026-10-01T00:00:00.000Z" }),
        topic(13, { downloadable: false, extension: null }),
      ],
    },
  ];
  const out = annotateTree(modules, [
    { onqTopicId: 11, onqLastModified: "2026-09-01T00:00:00.000Z" },
    { onqTopicId: 12, onqLastModified: "2026-09-01T00:00:00.000Z" },
    { onqTopicId: null, onqLastModified: null },
  ]);
  assert.deepEqual(
    out[0].topics.map((t) => [t.topicId, t.status]),
    [
      [10, "new"],
      [11, "imported"],
      [12, "changed"],
      [13, "unavailable"],
    ]
  );
});

test("an imported topic onQ gives no date for is not reported as changed", () => {
  const out = annotateTree(
    [{ moduleId: 1, title: "U", topics: [topic(10, { lastModified: null })] }],
    [{ onqTopicId: 10, onqLastModified: "2026-09-01T00:00:00.000Z" }]
  );
  assert.equal(out[0].topics[0].status, "imported");
});

test("pre-ticks what is new or changed, nothing else", () => {
  const annotated = annotateTree(
    [{ moduleId: 1, title: "U", topics: [topic(10), topic(11), topic(13, { downloadable: false })] }],
    [{ onqTopicId: 11, onqLastModified: "2026-09-01T00:00:00.000Z" }]
  );
  assert.deepEqual(defaultSelection(annotated), [10]);
});

test("matches a Lectern course to an onQ course by its number", () => {
  const courses = [
    { courseId: 1, name: "CISC121 Introduction to Computing Science I F26" },
    { courseId: 2, name: "CISC102 Discrete Mathematics for Computing I F26" },
    { courseId: 3, name: "MATH112 Introduction to Linear Algebra F26" },
  ];
  assert.equal(bestCourseMatch("CISC 102 Discrete Math Fall", courses), 2);
  assert.equal(bestCourseMatch("Math 112 Linear Algebra Fall", courses), 3);
});

test("does not guess a course when no number is shared", () => {
  const courses = [{ courseId: 1, name: "CISC121 Introduction to Computing Science I F26" }];
  assert.equal(bestCourseMatch("Introduction to Philosophy", courses), null);
  assert.equal(bestCourseMatch("Phil 111", courses), null);
});

const read = (over: Partial<OnqTopicText> = {}): OnqTopicText => ({
  ...topic(10),
  text: "# Week 1\nbody",
  note: null,
  sourceFileName: "w1.pdf",
  ...over,
});

test("drafts a material from a read topic", () => {
  assert.deepEqual(materialFromTopic(read(), "Unit 1", 1000), {
    draft: {
      kind: "READING",
      title: "Topic 10",
      text: "# Week 1\nbody",
      sourceFileName: "w1.pdf",
      onqTopicId: 10,
      onqLastModified: "2026-09-01T00:00:00.000Z",
    },
  });
});

test("skips a topic with no text, giving onq-mcp's own reason", () => {
  assert.deepEqual(materialFromTopic(read({ text: null, note: "Could not extract text (…)." }), "U", 1000), {
    skip: "Could not extract text (…).",
  });
  assert.deepEqual(materialFromTopic(read({ text: "   ", note: null }), "U", 1000), {
    skip: "onQ returned no readable text for this file.",
  });
});

test("skips rather than truncates a topic over the limit", () => {
  const out = materialFromTopic(read({ text: "x".repeat(11) }), "U", 10);
  assert.ok("skip" in out);
  assert.match(out.skip, /too long/);
});

test("recognises onq-mcp's session messages", () => {
  assert.equal(isSessionError("onQ session expired — open https://onq.queensu.ca/ in Brave, log in, then retry."), true);
  assert.equal(isSessionError("No onq.queensu.ca session found (missing d2lSessionVal). Log in at …"), true);
  assert.equal(isSessionError("Request timed out"), false);
});

const targets: ImportTarget[] = [
  { topicId: 1, title: "A", moduleTitle: "U" },
  { topicId: 2, title: "B", moduleTitle: "U" },
  { topicId: 3, title: "C", moduleTitle: "U" },
];

test("tallies outcomes and keeps going past one bad file", async () => {
  const steps: string[] = [];
  const summary = await runImport(
    targets,
    async (t) => {
      if (t.topicId === 1) return { outcome: "imported" };
      if (t.topicId === 2) throw new Error("Request timed out");
      return { outcome: "skipped", reason: "no text" };
    },
    (s) => steps.push(s)
  );
  assert.deepEqual(summary, {
    imported: 1,
    updated: 0,
    skipped: [
      { title: "B", reason: "Request timed out" },
      { title: "C", reason: "no text" },
    ],
    aborted: null,
  });
  assert.equal(steps.length, 3);
});

test("stops at a dead session: every later file would fail the same way", async () => {
  const seen: number[] = [];
  const summary = await runImport(
    targets,
    async (t) => {
      seen.push(t.topicId);
      if (t.topicId === 2) throw new Error("onQ session expired — open … log in, then retry.");
      return { outcome: "updated" };
    },
    () => undefined
  );
  assert.deepEqual(seen, [1, 2]);
  assert.equal(summary.updated, 1);
  assert.match(summary.aborted ?? "", /session expired/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/lib/onq-import.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement `onq-import.ts`**

```ts
/**
 * The rules of an onQ import, free of the database, the MCP client and React
 * so they can be tested directly: what kind a file probably is, which topics
 * are new, what becomes a material, and how a batch proceeds.
 */
import type { OnqCourse, OnqModule, OnqTopic, OnqTopicText } from "./mcp/onq-parse.ts";

export type MaterialKind = "SYLLABUS" | "SLIDES" | "READING" | "OTHER";
export type TopicStatus = "new" | "imported" | "changed" | "unavailable";
export type AnnotatedTopic = OnqTopic & { status: TopicStatus };
export type AnnotatedModule = { moduleId: number; title: string; topics: AnnotatedTopic[] };
export type ImportedRef = { onqTopicId: number | null; onqLastModified: string | null };
export type MaterialDraft = {
  kind: MaterialKind;
  title: string;
  text: string;
  sourceFileName: string | null;
  onqTopicId: number;
  onqLastModified: string | null;
};
export type ImportTarget = { topicId: number; title: string; moduleTitle: string };
export type ImportOutcome = { outcome: "imported" | "updated" | "skipped"; reason?: string };
export type ImportSummary = {
  imported: number;
  updated: number;
  skipped: { title: string; reason: string }[];
  aborted: string | null;
};

const SYLLABUS_RE = /syllabus|course outline/i;
const SLIDE_EXTENSIONS = new Set(["pptx", "ppt", "key"]);

/** A starting guess only — the kind stays editable on the material afterwards. */
export function guessKind(extension: string | null, title: string, moduleTitle: string): MaterialKind {
  // Title first: a syllabus handed out as a deck is still the syllabus, and
  // that is the one kind the rest of the app treats specially.
  if (SYLLABUS_RE.test(title) || SYLLABUS_RE.test(moduleTitle)) return "SYLLABUS";
  if (extension && SLIDE_EXTENSIONS.has(extension)) return "SLIDES";
  return "READING";
}

export function annotateTree(modules: OnqModule[], existing: ImportedRef[]): AnnotatedModule[] {
  const imported = new Map<number, string | null>();
  for (const ref of existing) {
    if (ref.onqTopicId !== null) imported.set(ref.onqTopicId, ref.onqLastModified);
  }

  const statusOf = (topic: OnqTopic): TopicStatus => {
    if (!topic.downloadable) return "unavailable";
    if (!imported.has(topic.topicId)) return "new";
    // No date from onQ is no evidence of a change; only a differing date is.
    if (topic.lastModified !== null && imported.get(topic.topicId) !== topic.lastModified) return "changed";
    return "imported";
  };

  return modules.map((m) => ({
    moduleId: m.moduleId,
    title: m.title,
    topics: m.topics.map((t) => ({ ...t, status: statusOf(t) })),
  }));
}

export function defaultSelection(modules: AnnotatedModule[]): number[] {
  return modules.flatMap((m) =>
    m.topics.filter((t) => t.status === "new" || t.status === "changed").map((t) => t.topicId)
  );
}

// "CISC102" and "CISC 102" have to meet, so letters and digits split apart.
const tokens = (name: string): string[] => name.toLowerCase().match(/[a-z]+|\d+/g) ?? [];

/**
 * The onQ course a Lectern course most likely is, or null. A shared course
 * number is required: two intro courses share most of their words, and a
 * wrong pre-selection is worse than none.
 */
export function bestCourseMatch(folderName: string, courses: OnqCourse[]): number | null {
  const wanted = new Set(tokens(folderName));
  let best: { courseId: number; score: number } | null = null;
  for (const course of courses) {
    const shared = tokens(course.name).filter((t) => wanted.has(t));
    if (!shared.some((t) => /^\d{3,}$/.test(t))) continue;
    const score = new Set(shared).size;
    if (!best || score > best.score) best = { courseId: course.courseId, score };
  }
  return best?.courseId ?? null;
}

export function materialFromTopic(
  topic: OnqTopicText,
  moduleTitle: string,
  maxChars: number
): { draft: MaterialDraft } | { skip: string } {
  const text = topic.text?.trim() ?? "";
  if (!text) return { skip: topic.note ?? "onQ returned no readable text for this file." };
  if (text.length > maxChars) {
    return { skip: `This file's text is too long to store (${text.length.toLocaleString("en")} characters).` };
  }
  return {
    draft: {
      kind: guessKind(topic.extension, topic.title, moduleTitle),
      title: topic.title.slice(0, 300),
      text,
      sourceFileName: topic.sourceFileName?.slice(0, 300) ?? null,
      onqTopicId: topic.topicId,
      onqLastModified: topic.lastModified,
    },
  };
}

/** onq-mcp's two "log in again" errors both say "session"; nothing else it raises does. */
export function isSessionError(message: string): boolean {
  return /\bsession\b/i.test(message);
}

export async function runImport(
  targets: ImportTarget[],
  importOne: (target: ImportTarget) => Promise<ImportOutcome>,
  onStep: (text: string) => void
): Promise<ImportSummary> {
  const summary: ImportSummary = { imported: 0, updated: 0, skipped: [], aborted: null };

  for (const target of targets) {
    try {
      const result = await importOne(target);
      if (result.outcome === "skipped") {
        summary.skipped.push({ title: target.title, reason: result.reason ?? "Skipped." });
      } else {
        summary[result.outcome] += 1;
      }
      onStep(`${target.title} — ${result.outcome}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "That file could not be imported.";
      // One bad file is that file's problem. A dead session is every
      // remaining file's problem, so stop and say so once.
      if (isSessionError(message)) {
        summary.aborted = message;
        return summary;
      }
      summary.skipped.push({ title: target.title, reason: message });
      onStep(`${target.title} — skipped`);
    }
  }
  return summary;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test src/lib/onq-import.test.ts` — Expected: 15 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/onq-import.ts src/lib/onq-import.test.ts
git commit -m "feat(onq): import rules — kind guess, change detection, batch loop"
```

---

### Task 4: Schema and validation

**Files:**
- Modify: `prisma/schema.prisma` (`Folder` ~line 95, `Material` ~line 109), `src/lib/validation.ts` (~line 11)
- Create: `prisma/migrations/20260917120000_onq_import/migration.sql`
- Test: `src/lib/validation.test.ts` if it exists (check with `ls src/lib/validation.test.ts`); otherwise create it.

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma fields `Folder.onqCourseId: number | null`, `Material.onqTopicId: number | null`, `Material.onqLastModified: string | null`; `updateFolderSchema` accepting `onqCourseId: number | null`; `importOnqTopicSchema` parsing `{ topicId: number; moduleTitle: string }`.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/validation.test.ts` (create the file with the node:test imports if it does not exist; import `updateFolderSchema` and `importOnqTopicSchema` from `"./validation.ts"`):

```ts
test("a folder can be linked to and unlinked from an onQ course", async () => {
  assert.deepEqual(await updateFolderSchema.parseAsync({ onqCourseId: 100001 }), { onqCourseId: 100001 });
  assert.deepEqual(await updateFolderSchema.parseAsync({ onqCourseId: null }), { onqCourseId: null });
  await assert.rejects(updateFolderSchema.parseAsync({ onqCourseId: "100001" }));
  await assert.rejects(updateFolderSchema.parseAsync({ onqCourseId: 1.5 }));
});

test("an onQ import names one topic by integer id", async () => {
  assert.deepEqual(await importOnqTopicSchema.parseAsync({ topicId: 7, moduleTitle: " Unit 1 " }), {
    topicId: 7,
    moduleTitle: "Unit 1",
  });
  assert.deepEqual(await importOnqTopicSchema.parseAsync({ topicId: 7 }), { topicId: 7, moduleTitle: "" });
  await assert.rejects(importOnqTopicSchema.parseAsync({ topicId: "7" }));
  await assert.rejects(importOnqTopicSchema.parseAsync({ topicId: -1 }));
  await assert.rejects(importOnqTopicSchema.parseAsync({ topicId: 7, moduleTitle: "x".repeat(301) }));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/lib/validation.test.ts`
Expected: FAIL — `importOnqTopicSchema` is not exported; `onqCourseId` is stripped from the parsed folder.

If `validation.ts` cannot be loaded by node:test because something it imports goes through `@/` (it imports `./limits` and `./grading` relatively, so it should load), stop and report rather than restructuring it.

- [ ] **Step 3: Implement validation**

In `src/lib/validation.ts`, replace the `updateFolderSchema` line with:

```ts
export const updateFolderSchema = createFolderSchema.partial().extend({
  // The onQ course this Lectern course imports from; null unlinks it.
  onqCourseId: z.number().int().positive().nullable().optional(),
});
```

and add after `createMaterialSchema`:

```ts
/** One onQ topic to import. The module title only feeds the kind guess. */
export const importOnqTopicSchema = z.object({
  topicId: z.number().int().positive(),
  moduleTitle: z.string().trim().max(300).default(""),
});
```

- [ ] **Step 4: Schema and migration**

In `prisma/schema.prisma`, add to `model Folder` after `color`:

```prisma
  /// The onQ (Brightspace) course offering this course imports material from.
  onqCourseId Int?
```

and to `model Material` after `slideCount`:

```prisma
  /// Set when the material was imported from onQ: which topic it is, and the
  /// topic's LastModifiedDate at import, so a re-import can tell "already
  /// here" from "changed on onQ".
  onqTopicId      Int?
  onqLastModified String?
```

and inside `model Material`, beside the existing `@@index`:

```prisma
  @@unique([folderId, onqTopicId])
```

Create `prisma/migrations/20260917120000_onq_import/migration.sql`:

```sql
-- Hand-authored rather than `prisma migrate dev`: this repo's `page_search`
-- FTS5 virtual tables are invisible to the Prisma datamodel, so the diff
-- engine always proposes dropping them alongside any real change (see the
-- 20260908120000_recall_ledger migration for the same note). Additive
-- nullable columns and one index; no existing row changes.
ALTER TABLE "Folder" ADD COLUMN "onqCourseId" INTEGER;
ALTER TABLE "Material" ADD COLUMN "onqTopicId" INTEGER;
ALTER TABLE "Material" ADD COLUMN "onqLastModified" TEXT;

-- SQLite treats NULLs as distinct in a unique index, so hand-uploaded
-- materials (onqTopicId NULL) are unaffected.
CREATE UNIQUE INDEX "Material_folderId_onqTopicId_key" ON "Material"("folderId", "onqTopicId");
```

- [ ] **Step 5: Apply and verify**

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate status
npm test && npx tsc --noEmit
```

Expected: migration applied; `migrate status` reports the database is up to date; tests pass; no type errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260917120000_onq_import src/lib/validation.ts src/lib/validation.test.ts
git commit -m "feat(onq): link a course to onQ and mark imported materials"
```

---

### Task 5: Routes

**Files:**
- Create: `src/app/api/onq/courses/route.ts`, `src/app/api/folders/[id]/onq/route.ts`, `src/app/api/folders/[id]/onq/import/route.ts`

**Interfaces:**
- Consumes: `listOnqCourses`, `onqCourseContent`, `readOnqTopic` (Task 2); `annotateTree`, `materialFromTopic` (Task 3); `importOnqTopicSchema`, Prisma fields (Task 4); existing `jsonError`, `withValidation`, `indexSourceSafely`, `MAX_TEXT_CHARS`.
- Produces:
  - `GET /api/onq/courses` → `200 { courses: OnqCourse[] }` | `502 { error }`
  - `GET /api/folders/:id/onq` → `200 { modules: AnnotatedModule[] }` | `404` | `409 { error }` when the course is not linked | `502 { error }`
  - `POST /api/folders/:id/onq/import` body `{ topicId, moduleTitle? }` → `200 { outcome: "imported" | "updated" | "skipped", reason? }` | `404` | `409` | `422` | `502 { error }`
  - Linking uses the existing `PATCH /api/folders/:id` with `{ onqCourseId }` — no new route.

There are no route tests in this repo; the logic these routes call is covered by Tasks 1-4. Keep the routes to glue. Route files may export only handlers — no shared constants.

- [ ] **Step 1: `src/app/api/onq/courses/route.ts`**

```ts
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { listOnqCourses } from "@/lib/mcp/onq";

export async function GET() {
  try {
    return NextResponse.json({ courses: await listOnqCourses() });
  } catch (e) {
    // 502: Lectern is fine, the thing behind it is not. The message is
    // onq-mcp's own (or the MCP client's "not configured" text) and already
    // says what to do.
    return jsonError(e instanceof Error ? e.message : "Could not reach onQ.", 502);
  }
}
```

- [ ] **Step 2: `src/app/api/folders/[id]/onq/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { onqCourseContent } from "@/lib/mcp/onq";
import { annotateTree } from "@/lib/onq-import";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folder = await db.folder.findUnique({ where: { id }, select: { onqCourseId: true } });
  if (!folder) return jsonError("Course not found", 404);
  // 409, not 404: the course exists, it just has no onQ course yet. The
  // dialog reads this status as "show the course picker".
  if (folder.onqCourseId === null) return jsonError("This course is not linked to an onQ course yet.", 409);

  let modules;
  try {
    modules = await onqCourseContent(folder.onqCourseId);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not reach onQ.", 502);
  }

  const existing = await db.material.findMany({
    where: { folderId: id, onqTopicId: { not: null } },
    select: { onqTopicId: true, onqLastModified: true },
  });
  return NextResponse.json({ modules: annotateTree(modules, existing) });
}
```

- [ ] **Step 3: `src/app/api/folders/[id]/onq/import/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { indexSourceSafely } from "@/lib/embeddings";
import { MAX_TEXT_CHARS } from "@/lib/limits";
import { readOnqTopic } from "@/lib/mcp/onq";
import { materialFromTopic } from "@/lib/onq-import";
import { importOnqTopicSchema } from "@/lib/validation";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(importOnqTopicSchema, body);
  if ("error" in result) return result.error;
  const { topicId, moduleTitle } = result.data;

  const folder = await db.folder.findUnique({ where: { id }, select: { onqCourseId: true } });
  if (!folder) return jsonError("Course not found", 404);
  if (folder.onqCourseId === null) return jsonError("This course is not linked to an onQ course yet.", 409);

  let topic;
  try {
    topic = await readOnqTopic(folder.onqCourseId, topicId);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Could not read that file from onQ.", 502);
  }

  const made = materialFromTopic(topic, moduleTitle, MAX_TEXT_CHARS);
  if ("skip" in made) return NextResponse.json({ outcome: "skipped", reason: made.skip });
  const { draft } = made;

  const existing = await db.material.findUnique({
    where: { folderId_onqTopicId: { folderId: id, onqTopicId: topicId } },
    select: { id: true },
  });

  // A re-import refreshes what came from onQ and leaves what the student may
  // have edited since — the title and the kind — alone.
  const material = existing
    ? await db.material.update({
        where: { id: existing.id },
        data: { text: draft.text, sourceFileName: draft.sourceFileName, onqLastModified: draft.onqLastModified },
        select: { id: true },
      })
    : await db.material.create({ data: { folderId: id, ...draft }, select: { id: true } });

  await indexSourceSafely({ materialId: material.id });

  return NextResponse.json({ outcome: existing ? "updated" : "imported" });
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint` — Expected: clean. (`folderId_onqTopicId` is the compound-unique accessor Prisma generates from Task 4's `@@unique`; if tsc cannot find it, `npx prisma generate` was skipped.)

Check how `indexSource` treats a material that already has chunks: `grep -n "deleteMany\|chunk" src/lib/embeddings.ts | head -20`. It must replace, not append, a material's chunks on re-index, or an updated material would be searchable under both its old and new text. If it appends, stop and report — that is a design question for the owner, not something to patch here.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/onq "src/app/api/folders/[id]/onq"
git commit -m "feat(onq): routes to list onQ courses, show a course's files, import one"
```

---

### Task 6: The import dialog

**Files:**
- Create: `src/components/dashboard/OnqImportButton.tsx`
- Modify: `src/app/folders/[folderId]/page.tsx` (~line 186, beside `<MaterialUploadButton …/>`; plus one import)

**Interfaces:**
- Consumes: the three routes (Task 5) and `PATCH /api/folders/:id`; `bestCourseMatch`, `defaultSelection`, `runImport`, and types `AnnotatedModule`, `ImportOutcome`, `ImportSummary`, `ImportTarget`, `TopicStatus` (Task 3); `OnqCourse` type (Task 2); existing `useTasks`, `postTask`, `Modal`, `Button`.
- Produces: `<OnqImportButton folderId={string} folderName={string} />`.

- [ ] **Step 1: Create the component**

`src/components/dashboard/OnqImportButton.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CloudDownload, Loader2 } from "lucide-react";
import { useTasks } from "@/components/tasks/TaskProvider";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { OnqCourse } from "@/lib/mcp/onq-parse";
import {
  bestCourseMatch,
  defaultSelection,
  runImport,
  type AnnotatedModule,
  type ImportOutcome,
  type ImportSummary,
  type ImportTarget,
  type TopicStatus,
} from "@/lib/onq-import";
import { postTask } from "@/lib/tasks";

const STATUS_NOTE: Record<TopicStatus, string | null> = {
  new: null,
  imported: "Already imported",
  changed: "Changed on onQ",
  unavailable: "Not a file",
};

const UNREACHABLE = "Could not reach Lectern. Check it is still running, then try again.";

type View =
  | { step: "loading" }
  | { step: "link"; courses: OnqCourse[]; courseId: number | null }
  | { step: "pick"; modules: AnnotatedModule[]; selected: Set<number> };

async function getJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetch(url);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, error: body.error ?? "Could not reach onQ." };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, status: 0, error: UNREACHABLE };
  }
}

function summaryLine(summary: ImportSummary): string {
  const parts = [];
  if (summary.imported) parts.push(`${summary.imported} imported`);
  if (summary.updated) parts.push(`${summary.updated} updated`);
  if (summary.skipped.length) parts.push(`${summary.skipped.length} skipped`);
  return parts.length ? parts.join(", ") : "Nothing was imported";
}

export function OnqImportButton({ folderId, folderName }: { folderId: string; folderName: string }) {
  const router = useRouter();
  const { run, task, clear } = useTasks();
  const taskKey = `folder:${folderId}:onq-import`;
  const current = task(taskKey);
  const running = current?.status === "running";
  const summary = current?.status === "done" ? (current.data as ImportSummary | undefined) : undefined;

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ step: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  async function loadCourses() {
    setError(null);
    setView({ step: "loading" });
    const list = await getJson<{ courses: OnqCourse[] }>("/api/onq/courses");
    if (!list.ok) {
      setError(list.error);
      return;
    }
    setView({ step: "link", courses: list.data.courses, courseId: bestCourseMatch(folderName, list.data.courses) });
  }

  async function loadTree() {
    setError(null);
    setView({ step: "loading" });
    const tree = await getJson<{ modules: AnnotatedModule[] }>(`/api/folders/${folderId}/onq`);
    if (tree.ok) {
      setView({ step: "pick", modules: tree.data.modules, selected: new Set(defaultSelection(tree.data.modules)) });
      return;
    }
    // 409 is "not linked yet" — the one failure with a next step inside this dialog.
    if (tree.status === 409) {
      await loadCourses();
      return;
    }
    setError(tree.error);
  }

  async function link(courseId: number) {
    setLinking(true);
    setError(null);
    try {
      const res = await fetch(`/api/folders/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ onqCourseId: courseId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not link that course.");
        return;
      }
      await loadTree();
    } catch {
      setError(UNREACHABLE);
    } finally {
      setLinking(false);
    }
  }

  function toggle(topicId: number) {
    setView((v) => {
      if (v.step !== "pick") return v;
      const selected = new Set(v.selected);
      if (!selected.delete(topicId)) selected.add(topicId);
      return { ...v, selected };
    });
  }

  async function startImport(modules: AnnotatedModule[], selected: Set<number>) {
    const targets: ImportTarget[] = modules.flatMap((m) =>
      m.topics
        .filter((t) => selected.has(t.topicId))
        .map((t) => ({ topicId: t.topicId, title: t.title, moduleTitle: m.title }))
    );
    setOpen(false);
    clear([taskKey]);
    await run(
      { key: taskKey, label: `Importing ${targets.length} from onQ…`, href: `/folders/${folderId}` },
      async ({ step, emit }) => {
        const result = await runImport(
          targets,
          (target) =>
            postTask(
              `/api/folders/${folderId}/onq/import`,
              "That file could not be imported.",
              {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ topicId: target.topicId, moduleTitle: target.moduleTitle }),
              },
              UNREACHABLE
            ) as Promise<ImportOutcome>,
          step
        );
        emit(result);
        // Whatever landed before the session died is saved; say why it stopped.
        if (result.aborted) throw new Error(`${summaryLine(result)} before onQ stopped answering. ${result.aborted}`);
      }
    );
    router.refresh();
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Button
        variant="secondary"
        disabled={running}
        onClick={() => {
          setOpen(true);
          void loadTree();
        }}
      >
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <CloudDownload className="h-4 w-4" strokeWidth={2} />
        )}
        {running ? "Importing from onQ…" : "Import from onQ"}
      </Button>

      {current?.status === "error" && (
        <p role="alert" className="max-w-sm text-right text-[13px] text-red-600">
          {current.error}
        </p>
      )}
      {summary && (
        <div className="max-w-sm text-right text-[13px] text-muted-2">
          <p>{summaryLine(summary)}.</p>
          {summary.skipped.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {summary.skipped.map((s) => (
                <li key={s.title}>
                  {s.title}: {s.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Import from onQ">
        <div className="flex flex-col gap-3">
          {error && (
            <p role="alert" className="text-[13px] text-red-600">
              {error}
            </p>
          )}

          {!error && view.step === "loading" && (
            <p className="flex items-center gap-2 text-[13px] text-muted-2">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              Asking onQ…
            </p>
          )}

          {!error && view.step === "link" && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (view.courseId !== null) void link(view.courseId);
              }}
            >
              <label className="flex flex-col gap-1.5 text-[13px]">
                Which onQ course is {folderName}?
                <select
                  className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-[14px]"
                  value={view.courseId ?? ""}
                  onChange={(e) =>
                    setView({ ...view, courseId: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">Choose a course</option>
                  {view.courses.map((c) => (
                    <option key={c.courseId} value={c.courseId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" disabled={view.courseId === null || linking} className="self-end">
                {linking ? "Linking…" : "Link course"}
              </Button>
            </form>
          )}

          {!error && view.step === "pick" && (
            <>
              <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-1">
                {view.modules
                  .filter((m) => m.topics.length > 0)
                  .map((m) => (
                    <fieldset key={m.moduleId} className="flex flex-col gap-1">
                      <legend className="text-[12.5px] font-medium text-muted-2">{m.title}</legend>
                      {m.topics.map((t) => (
                        <label
                          key={t.topicId}
                          className={`flex items-baseline gap-2 text-[14px] ${
                            t.status === "unavailable" ? "text-muted-2" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={view.selected.has(t.topicId)}
                            disabled={t.status === "unavailable"}
                            onChange={() => toggle(t.topicId)}
                          />
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          <span className="shrink-0 text-[12px] text-muted-2">
                            {[t.extension?.toUpperCase(), STATUS_NOTE[t.status]].filter(Boolean).join(" · ")}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  ))}
              </div>
              <div className="flex items-center justify-between gap-3">
                <button type="button" className="text-[13px] text-muted-2 underline" onClick={() => void loadCourses()}>
                  Wrong onQ course?
                </button>
                <Button
                  disabled={view.selected.size === 0}
                  onClick={() => void startImport(view.modules, view.selected)}
                >
                  Import {view.selected.size} {view.selected.size === 1 ? "file" : "files"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
```

Before relying on it, check three things the code above assumes and adjust to what the repo actually has:
- `Button` accepts `type`, `disabled`, `className`, `variant="secondary"`: `sed -n 1,40p src/components/ui/Button.tsx`.
- `CloudDownload` exists in the installed lucide-react: `grep -c "CloudDownload" node_modules/lucide-react/dist/lucide-react.d.ts`. If 0, use `Download`.
- `text-muted-2` and `border-line` are the tokens `MaterialUploadButton.tsx` uses (they are, as of this plan).

- [ ] **Step 2: Mount it**

In `src/app/folders/[folderId]/page.tsx`, add the import beside `MaterialUploadButton`'s:

```tsx
import { OnqImportButton } from "@/components/dashboard/OnqImportButton";
```

and change the Materials tab's button row from

```tsx
                  <div className="flex justify-end">
                    <MaterialUploadButton folderId={folder.id} />
                  </div>
```

to

```tsx
                  <div className="flex items-start justify-end gap-2">
                    <OnqImportButton folderId={folder.id} folderName={folder.name} />
                    <MaterialUploadButton folderId={folder.id} />
                  </div>
```

Confirm `folder.name` is loaded by the page's folder query (`grep -n "db.folder" -A6 "src/app/folders/[folderId]/page.tsx"`); if the query uses a `select` without `name`, add it.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint && npm test` — Expected: clean, all pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/dashboard/OnqImportButton.tsx "src/app/folders/[folderId]/page.tsx"
git commit -m "feat(onq): import a course's onQ files from the materials tab"
```

---

### Task 7: README

**Files:**
- Modify: `README.md` — find the section that documents `mcp.config.json` (`grep -n "mcp.config" README.md`).

- [ ] **Step 1: Document it**

Add beside the Notion/calendar MCP setup notes (take the repo URL from `git -C ../onq-mcp remote get-url origin`):

```markdown
### onQ import

With [onq-mcp](<onq-mcp repo URL>) configured as the `onq` server in
`mcp.config.json` (see `mcp.config.example.json`), a course's Materials tab
gets **Import from onQ**. Link the course to its onQ offering once; after that
the dialog lists the course's files, pre-ticks the ones that are new or have
changed on onQ, and imports the ticked ones as materials.

onq-mcp reads your onQ session from Brave's cookies — log in to onQ there
first. Links, videos and quizzes are listed but cannot be imported; only files
have text to import.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: importing course material from onQ"
```

---

### Task 8: Manual end-to-end check

Needs the onq-mcp plan's Tasks 1-3 landed and a live onQ session in Brave. If either is missing, report that this task was not run — do not mark it done.

- [ ] **Step 1: Configure**

Create `mcp.config.json` in this worktree (gitignored) with only the `onq` entry from `mcp.config.example.json`, the path set to `../onq-mcp`.

- [ ] **Step 2: Run on a private port**

Start the dev server on port **3107** — not 3000 or 3100, which other sessions use. In a Claude Code desktop session, add `{"version":"0.0.1","configurations":[{"name":"lectern-onq","runtimeExecutable":"npx","runtimeArgs":["next","dev","-p","3107"],"port":3107}]}` as `.claude/launch.json` in this worktree if there is none and use the Browser pane's `preview_start`; do not commit that file unless the repo already tracks one.

- [ ] **Step 3: Walk the flow**

1. Create a course named "CISC 102 Discrete Math" → Materials tab → **Import from onQ**.
2. Expect the link step with the CISC 102 onQ course pre-selected. Link it.
3. Expect the checklist: PDFs/PPTX ticked, links greyed with "Not a file".
4. Untick all but two files (one of them the syllabus); import. Expect the task chip to step through both, then "2 imported." under the button and both materials in the list, the syllabus with kind Syllabus.
5. Open the dialog again: those two show "Already imported" and are unticked.
6. Search the course for a phrase from one imported file — expect a hit (proves indexing ran).
7. In Brave, log out of onQ; restart the dev server (drops the cached onq-mcp child and its cookies); open the dialog. Expect onq-mcp's "session expired — … log in, then retry" message in the dialog, not a stack trace.

- [ ] **Step 4: Report** what was observed at each numbered step, including anything that differed.

---

## Review gate (after Task 7)

Per the repo owner's standing instructions: run `ecc:typescript-reviewer` (and `ecc:react-reviewer` for Task 6's component) and `ecc:security-reviewer` as separate passes over `git diff origin/main...feat/onq-import`; ask them to report everything and filter after; fix what is real. The security pass should look specifically at: untrusted onQ text entering `Material.text` (it must reach prompts only through the existing `UNTRUSTED_CONTENT_CLAUSE` paths), the int validation on `topicId`/`onqCourseId`, and child-process error messages shown verbatim in the UI (rendered as text, never as HTML). Dispatch `test-runner` once at the end rather than grading the suite yourself.
