# Retrieval Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every path that puts course material in a prompt one retrieval entry point, so lecture chat and global ask send ~1,300 tokens of the right material instead of ~6,000 tokens of the whole lecture.

**Architecture:** A new `src/lib/retrieval.ts` exposes `retrieve({ scope, query })` over three scopes (page, course, all). Candidates come from the existing `Chunk` table — prefiltered by FTS for the global scope — are ranked by the existing cosine, then reordered by a local cross-encoder and trimmed to a character budget. A `RetrievalLog` row records what each query actually retrieved. Pure logic lives in `retrieval-math.ts` so it is testable without SQLite or a model.

**Tech Stack:** TypeScript, Next.js 16 route handlers, Prisma 7 + better-sqlite3, `@huggingface/transformers` (already a dependency), `node --test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-09-11-retrieval-floor-design.md`

## Global Constraints

- **No new npm dependency.** The cross-encoder runs through `@huggingface/transformers`, which is already installed.
- **`main` is protected.** Work on a branch off an up-to-date `main`; every change reaches `main` through a PR. See `AGENTS.md`.
- **Schema changes run through `npm run db:migrate`**, which snapshots `prisma/dev.db` into `prisma/backups/` first. Never run `prisma migrate` directly.
- **Every chunk query carries the `model` filter.** Vectors from two embedders are not comparable and often differ in dimension. Omitting it is the easiest way to make retrieval silently wrong.
- **No failure in this subsystem may fail a user's question.** Every path degrades to something that still answers.
- **Commit style:** `<type>: <imperative lowercase phrase>`, one logical change per commit.
- **Branch for this work:** `feat/retrieval-floor`.

---

### Task 1: Pure retrieval math

**Files:**
- Create: `src/lib/retrieval-math.ts`
- Test: `src/lib/retrieval-math.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Packable`, `type ResolvedScope`, `packContext(hits, maxHits, budget)`, `spread(hits)`, `scopeFilter(scope, model)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/retrieval-math.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { packContext, spread, scopeFilter } from "./retrieval-math.ts";

function hit(text: string, pageId: string | null = "p1", materialId: string | null = null) {
  return { text, title: "T", pageId, materialId };
}

test("packContext keeps hits in rank order until the budget is spent", () => {
  const kept = packContext([hit("a".repeat(30)), hit("b".repeat(30)), hit("c".repeat(30))], 10, 70);
  assert.equal(kept.length, 2);
  assert.ok(kept[0].text.startsWith("a"));
  assert.ok(kept[1].text.startsWith("b"));
});

test("packContext stops at maxHits even when the budget allows more", () => {
  const kept = packContext([hit("a"), hit("b"), hit("c")], 2, 10_000);
  assert.equal(kept.length, 2);
});

test("packContext returns one block when the first hit alone exceeds the budget", () => {
  const kept = packContext([hit("x".repeat(9_000)), hit("y")], 4, 5_000);
  assert.equal(kept.length, 1);
});

test("packContext returns an empty array for no hits", () => {
  assert.deepEqual(packContext([], 4, 5_000), []);
});

test("spread counts distinct sources, not chunks", () => {
  assert.equal(spread([hit("a", "p1"), hit("b", "p1"), hit("c", "p2")]), 2);
});

test("spread counts a material separately from a page", () => {
  assert.equal(spread([hit("a", "p1", null), hit("b", null, "m1")]), 2);
});

test("scopeFilter always carries the model filter", () => {
  const model = "local:Xenova/all-MiniLM-L6-v2";
  for (const scope of [
    { kind: "page", pageId: "p1" },
    { kind: "course", folderId: "f1" },
    { kind: "all", pageIds: ["p1"], folderIds: ["f1"] },
  ] as const) {
    assert.equal(scopeFilter(scope, model).model, model);
  }
});

test("scopeFilter for page scope filters on that page", () => {
  const where = scopeFilter({ kind: "page", pageId: "p1" }, "m");
  assert.equal(where.pageId, "p1");
});

test("scopeFilter for all scope matches the FTS pages and their folders' materials", () => {
  const where = scopeFilter({ kind: "all", pageIds: ["p1", "p2"], folderIds: ["f1"] }, "m");
  assert.deepEqual(where.OR, [
    { pageId: { in: ["p1", "p2"] } },
    { material: { folderId: { in: ["f1"] } } },
  ]);
});

test("scopeFilter for all scope with no FTS hits matches nothing rather than everything", () => {
  const where = scopeFilter({ kind: "all", pageIds: [], folderIds: [] }, "m");
  assert.deepEqual(where.OR, [{ pageId: { in: [] } }, { material: { folderId: { in: [] } } }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/lib/retrieval-math.test.ts`
Expected: FAIL — `Cannot find module './retrieval-math.ts'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/retrieval-math.ts`:

```ts
/**
 * Pure retrieval helpers. Deliberately free of imports from db, the embedding
 * model, or the network — the same split as `embed-math.ts` next to
 * `embeddings.ts` — so `npm test` covers them without loading a model or
 * opening SQLite.
 */

export type Packable = {
  text: string;
  title: string;
  pageId: string | null;
  materialId: string | null;
};

/**
 * The scope after its candidate ids have been resolved. The public `Scope` in
 * `retrieval.ts` is what callers pass; this is what the where-clause is built
 * from, once FTS has run for the global case.
 */
export type ResolvedScope =
  | { kind: "page"; pageId: string }
  | { kind: "course"; folderId: string }
  | { kind: "all"; pageIds: string[]; folderIds: string[] };

/**
 * Walks hits in rank order and keeps them until one would overflow the budget.
 * Returns the hits it kept — not just their text — so the caller's citation
 * list can be built from exactly what the model was shown. A citation for a
 * block that was trimmed is a citation the answer never used.
 *
 * The first hit is always kept, even when it alone exceeds the budget: a
 * single oversized chunk is a worse answer than a truncated one, but an empty
 * context is no answer at all.
 */
export function packContext<T extends Packable>(hits: T[], maxHits: number, budget: number): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const hit of hits) {
    if (kept.length >= maxHits) break;
    if (kept.length > 0 && used + hit.text.length > budget) break;
    kept.push(hit);
    used += hit.text.length;
  }
  return kept;
}

/**
 * How many distinct lectures or materials the surviving hits came from. Four
 * chunks of one lecture is a spread of 1. This is the number that says whether
 * an answer had to be assembled across sources.
 */
export function spread(hits: Packable[]): number {
  return new Set(hits.map((h) => h.pageId ?? h.materialId ?? "")).size;
}

/**
 * The Prisma where-clause for a resolved scope.
 *
 * `model` is not an optimization: vectors from two embedders are not
 * comparable, so scoring across them is silent nonsense. It is unconditional
 * here precisely so no caller can forget it.
 */
export function scopeFilter(scope: ResolvedScope, model: string) {
  switch (scope.kind) {
    case "page":
      return { model, pageId: scope.pageId };
    case "course":
      return {
        model,
        OR: [{ page: { folderId: scope.folderId } }, { material: { folderId: scope.folderId } }],
      };
    case "all":
      // ponytail: materials bypass the FTS prefilter and are loaded whole for
      // the folders in play — page_search indexes pages only, so prefiltering
      // materials lexically is not possible without a material_search table.
      // Add one if material volume ever approaches transcript volume.
      return {
        model,
        OR: [
          { pageId: { in: scope.pageIds } },
          { material: { folderId: { in: scope.folderIds } } },
        ],
      };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/lib/retrieval-math.test.ts`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/retrieval-math.ts src/lib/retrieval-math.test.ts
git commit -m "feat: pure retrieval math for budget packing and scope filters"
```

---

### Task 2: Cross-encoder rerank

**Files:**
- Create: `src/lib/rerank.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `rerank<T extends { text: string }>(query: string, candidates: T[]): Promise<T[]>` — returns candidates reordered most-relevant-first, or the input array unchanged if the model is unavailable.

There is no unit test for this task. The function's only logic is "call a model, sort by its score, fall back on failure"; a test with a stubbed model would assert that `sort` sorts. Its real behavior is verified in Task 7's manual check. This is a deliberate exception to the plan's TDD default, not an oversight.

- [ ] **Step 1: Write the implementation**

Create `src/lib/rerank.ts`:

```ts
/**
 * Cross-encoder reranking.
 *
 * Cosine similarity compares a question vector and a chunk vector that were
 * computed independently, which is why a bi-encoder retrieves well and orders
 * badly. A cross-encoder reads the pair together and scores relevance directly.
 * It is far too slow to run over a corpus and exactly right over a few dozen
 * candidates.
 */

const MODEL = "Xenova/ms-marco-MiniLM-L-6-v2";

type Scorer = (
  pairs: { text: string; text_pair: string }[]
) => Promise<{ score: number }[] | { score: number }>;

// The pipeline holds a loaded model in memory; build it once per process.
let scorerPromise: Promise<Scorer> | null = null;
let warned = false;

async function getScorer(): Promise<Scorer> {
  const { pipeline } = await import("@huggingface/transformers");
  if (!scorerPromise) {
    // q8 keeps the download near 23MB, the same trade the embedder makes.
    scorerPromise = pipeline("text-classification", MODEL, { dtype: "q8" }).then(
      (p) => p as unknown as Scorer,
      (e) => {
        // Don't memoize a rejection: a one-off network hiccup during the first
        // download would otherwise disable reranking for the life of the
        // process, since the cached rejected promise is reused forever.
        scorerPromise = null;
        throw e;
      }
    );
  }
  return scorerPromise;
}

/**
 * Reorders candidates by cross-encoder relevance to the query.
 *
 * Never throws. Reranking is a quality improvement, so when the model cannot
 * load — offline on first run, most likely — the candidates come back in the
 * order they arrived (cosine order) and the question is still answered. The
 * warning is logged once per process rather than once per query.
 */
export async function rerank<T extends { text: string }>(
  query: string,
  candidates: T[]
): Promise<T[]> {
  if (candidates.length <= 1) return candidates;
  try {
    const scorer = await getScorer();
    const raw = await scorer(candidates.map((c) => ({ text: query, text_pair: c.text })));
    const scores = Array.isArray(raw) ? raw : [raw];
    if (scores.length !== candidates.length) return candidates;
    return candidates
      .map((candidate, i) => ({ candidate, score: scores[i].score }))
      .sort((a, b) => b.score - a.score)
      .map((scored) => scored.candidate);
  } catch (e) {
    if (!warned) {
      warned = true;
      console.error("[rerank] unavailable, falling back to cosine order:", e);
    }
    return candidates;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rerank.ts
git commit -m "feat: cross-encoder rerank with cosine-order fallback"
```

---

### Task 3: `RetrievalLog` schema and writer

**Files:**
- Modify: `prisma/schema.prisma` (append the model)
- Create: `src/lib/retrieval-log.ts`

**Interfaces:**
- Consumes: `spread`, `type Packable` from Task 1.
- Produces: `logRetrieval(entry): Promise<void>` where `entry` is `{ query: string; scope: string; mode: string; hits: Packable[]; topScore: number }`.

- [ ] **Step 1: Add the model to the schema**

Append to `prisma/schema.prisma`:

```prisma
/// What a question actually retrieved. Exists to answer one question with
/// evidence rather than memory: are there real questions whose answer is
/// spread across lectures, such that no single chunk can carry it? That is the
/// one retrieval failure a concept graph fixes and a better ranker does not.
///
/// Deliberately has no relations. `AGENTS.md` requires that deleting a lecture
/// never erase the evidence of study that referenced it; `ReviewLog` achieves
/// that with `SetNull` on every relation, and this table achieves it by storing
/// source ids as JSON text — there is no foreign key to cascade and no null to
/// handle.
model RetrievalLog {
  id        String   @id @default(cuid())
  query     String
  scope     String // "page" | "course" | "all"
  mode      String // "semantic" | "fts" | "unindexed"
  hitCount  Int
  spread    Int // distinct lectures/materials among the surviving hits
  topScore  Float
  sourceIds String // JSON array of the page/material ids that were sent
  createdAt DateTime @default(now())

  @@index([createdAt])
}
```

- [ ] **Step 2: Run the migration**

Run: `npm run db:migrate`
Expected: a snapshot appears in `prisma/backups/`, then the migration applies. If Prisma prompts for a migration name, use `add_retrieval_log`.

Verify the snapshot exists: `ls -t prisma/backups/ | head -1`

- [ ] **Step 3: Write the writer**

Create `src/lib/retrieval-log.ts`:

```ts
import { db } from "@/lib/db";
import { spread, type Packable } from "@/lib/retrieval-math";

/** Rows kept. Older ones are pruned opportunistically — see below. */
const KEEP = 5_000;

/**
 * Records what one question retrieved.
 *
 * Best-effort in the `indexSourceSafely` idiom: a failed log write must never
 * fail a question the user already has an answer to.
 */
export async function logRetrieval(entry: {
  query: string;
  scope: string;
  mode: string;
  hits: Packable[];
  topScore: number;
}): Promise<void> {
  try {
    const sourceIds = [
      ...new Set(entry.hits.map((h) => h.pageId ?? h.materialId).filter((id): id is string => !!id)),
    ];
    await db.retrievalLog.create({
      data: {
        query: entry.query,
        scope: entry.scope,
        mode: entry.mode,
        hitCount: entry.hits.length,
        spread: spread(entry.hits),
        topScore: entry.topScore,
        sourceIds: JSON.stringify(sourceIds),
      },
    });

    // Prune on roughly one write in fifty rather than on a schedule: this app
    // has no job runner, and at study volumes this is a few deletes a week.
    if (Math.random() < 0.02) {
      const cutoff = await db.retrievalLog.findMany({
        select: { createdAt: true },
        orderBy: { createdAt: "desc" },
        skip: KEEP,
        take: 1,
      });
      if (cutoff.length > 0) {
        await db.retrievalLog.deleteMany({ where: { createdAt: { lt: cutoff[0].createdAt } } });
      }
    }
  } catch (e) {
    console.error("[retrieval-log] write failed:", e);
  }
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (If `db.retrievalLog` is not found, the Prisma client did not regenerate — run `npx prisma generate`.)

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/retrieval-log.ts
git commit -m "feat: record what each question retrieved"
```

---

### Task 4: The `retrieve()` entry point

**Files:**
- Create: `src/lib/retrieval.ts`
- Modify: `src/lib/embeddings.ts` (export one existing function)

**Interfaces:**
- Consumes: `packContext`, `scopeFilter`, `type ResolvedScope` (Task 1); `rerank` (Task 2); `logRetrieval` (Task 3); `activeEmbedModelLabel`, `embedTexts`, `type CourseHit` from `@/lib/embeddings`; `cosine`, `decodeVector` from `@/lib/embed-math`; `searchPages` from `@/lib/fts`.
- Produces: `type Scope`, `type RetrievalMode`, `retrieve({ scope, query }): Promise<{ hits: CourseHit[]; mode: RetrievalMode }>`.

**Note:** `embedTexts` is currently module-private in `src/lib/embeddings.ts`. Export it in Step 1.

- [ ] **Step 1: Export the embedding helper**

In `src/lib/embeddings.ts`, change `async function embedTexts(` to `export async function embedTexts(`.

- [ ] **Step 2: Write the implementation**

Create `src/lib/retrieval.ts`:

```ts
import { db } from "@/lib/db";
import { cosine, decodeVector } from "@/lib/embed-math";
import { activeEmbedModelLabel, embedTexts, type CourseHit } from "@/lib/embeddings";
import { searchPages } from "@/lib/fts";
import { logRetrieval } from "@/lib/retrieval-log";
import { packContext, scopeFilter, type ResolvedScope } from "@/lib/retrieval-math";
import { rerank } from "@/lib/rerank";

/** What the caller asks for. `all` resolves its ids inside `retrieve`. */
export type Scope =
  | { kind: "page"; pageId: string }
  | { kind: "course"; folderId: string }
  | { kind: "all" };

/**
 * `semantic` — vectors were used.
 * `unindexed` — this scope has no chunks for the active embedder. A distinct
 *   fact from failure: most likely the source predates the vector index, or
 *   `EMBED_PROVIDER` changed and `npm run reindex` has not run.
 * `fts` — embedding threw; the caller's keyword fallback carries the answer.
 * Callers degrade differently on each, so the distinction is preserved.
 */
export type RetrievalMode = "semantic" | "fts" | "unindexed";

const MAX_HITS = 4;
const CONTEXT_CHARS = 5_000;
const RERANK_CANDIDATES = 40;
/** How many lectures the FTS prefilter narrows the library to for `all`. */
const FTS_PREFILTER_PAGES = 15;

async function resolveScope(scope: Scope, query: string): Promise<ResolvedScope> {
  if (scope.kind !== "all") return scope;
  // Without this prefilter a global question loads every chunk in the database
  // — ~17k chunks and ~26MB of vectors at six courses — and discards nearly all
  // of it.
  const hits = await searchPages(query, FTS_PREFILTER_PAGES);
  const pageIds = hits.map((h) => h.pageId);
  const pages = pageIds.length
    ? await db.page.findMany({ where: { id: { in: pageIds } }, select: { folderId: true } })
    : [];
  const folderIds = [...new Set(pages.map((p) => p.folderId))];
  return { kind: "all", pageIds, folderIds };
}

/**
 * The one place course material is turned into prompt context.
 *
 * Never throws. Every failure degrades to a mode that still answers, and the
 * returned `mode` tells the caller which one it got.
 */
export async function retrieve(opts: {
  scope: Scope;
  query: string;
}): Promise<{ hits: CourseHit[]; mode: RetrievalMode }> {
  const trimmed = opts.query.trim();
  if (!trimmed) return { hits: [], mode: "semantic" };

  const scopeLabel = opts.scope.kind;
  let mode: RetrievalMode = "semantic";
  let hits: CourseHit[] = [];

  try {
    const model = activeEmbedModelLabel();
    const resolved = await resolveScope(opts.scope, trimmed);

    const rows = await db.chunk.findMany({
      where: scopeFilter(resolved, model),
      select: {
        id: true,
        text: true,
        source: true,
        pageId: true,
        materialId: true,
        vector: true,
        page: { select: { title: true } },
        material: { select: { title: true } },
      },
    });

    if (rows.length === 0) {
      // Not "nothing was relevant enough" — this scope has no chunks at all for
      // the active embedder. A clean, distinct signal the caller can act on.
      mode = "unindexed";
    } else {
      const [queryVector] = await embedTexts([trimmed]);
      const scored: CourseHit[] = rows
        .map((row) => ({
          chunkId: row.id,
          text: row.text,
          score: cosine(queryVector, decodeVector(row.vector)),
          source: row.source,
          pageId: row.pageId,
          materialId: row.materialId,
          title: row.page?.title ?? row.material?.title ?? "Untitled",
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, RERANK_CANDIDATES);

      hits = packContext(await rerank(trimmed, scored), MAX_HITS, CONTEXT_CHARS);
    }
  } catch (e) {
    // Every rung of the embedding chain failed. Retrieval quality drops; the
    // feature does not break.
    console.error(`[retrieval] semantic retrieval failed for ${scopeLabel}, falling back:`, e);
    mode = "fts";
  }

  await logRetrieval({
    query: trimmed,
    scope: scopeLabel,
    mode,
    hits,
    topScore: hits[0]?.score ?? 0,
  });

  return { hits, mode };
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify the existing suite still passes**

Run: `npm test`
Expected: all tests pass, including Task 1's.

- [ ] **Step 5: Commit**

```bash
git add src/lib/retrieval.ts src/lib/embeddings.ts
git commit -m "feat: one retrieval entry point across page, course and library scopes"
```

---

### Task 5: Rewire course ask

**Files:**
- Modify: `src/app/api/folders/[id]/ask/route.ts`

**Interfaces:**
- Consumes: `retrieve`, `type RetrievalMode` (Task 4).
- Produces: unchanged JSON response — `{ reply, citations, retrieval }`. `CourseChat.tsx` needs no change.

This route already has the right shape; the change is that it stops owning candidate generation. Its `ftsFallback` helper stays, because a `fts` or `unindexed` mode still needs page text to fall back to.

- [ ] **Step 1: Replace the retrieval block**

In `src/app/api/folders/[id]/ask/route.ts`:

Remove `import { searchCourse } from "@/lib/embeddings";` and the `const K = 8;` constant. Add:

```ts
import { retrieve, type RetrievalMode } from "@/lib/retrieval";
```

Replace the local `type Retrieval = "semantic" | "fts" | "unindexed";` with `type Retrieval = RetrievalMode;` and add `const FTS_FALLBACK_PAGES = 8;` beside `FTS_PAGE_CHARS`.

Replace the whole block from `let retrieval: Retrieval = "semantic";` through the end of its `catch` with:

```ts
  const { hits, mode } = await retrieve({
    scope: { kind: "course", folderId: id },
    query: lastUser.content,
  });
  const retrieval: Retrieval = mode;
  let blocks: string[] = [];
  let citations: Citation[] = [];

  if (hits.length > 0) {
    blocks = hits.map((h) => `### ${h.title}\n${h.text}`);
    citations = hits.map(formatCitation);
  } else {
    // Either this course has no chunks for the active embedder, or embedding
    // failed. `mode` already records which; both fall back to full-text search
    // scoped to this course.
    ({ blocks, citations } = await ftsFallback(id, lastUser.content, FTS_FALLBACK_PAGES));
  }
```

The existing citation de-duplication block below this stays exactly as it is.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Check it by hand**

Start the app (`npm run dev`), open a course with indexed lectures, ask a question whose answer is in one lecture.
Expected: an answer with citation chips, and the response's `retrieval` field reads `semantic`. Confirm a row was written:

```bash
sqlite3 prisma/dev.db "SELECT scope, mode, hitCount, spread FROM RetrievalLog ORDER BY createdAt DESC LIMIT 1;"
```

Expected: `course|semantic|` a number 1-4 `|` a number ≥ 1.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/folders/[id]/ask/route.ts"
git commit -m "refactor: course ask uses the shared retriever"
```

---

### Task 6: Rewire lecture chat

**Files:**
- Modify: `src/app/api/pages/[id]/chat/route.ts`

**Interfaces:**
- Consumes: `retrieve` (Task 4).
- Produces: unchanged JSON response — `{ reply }`. `ChatTab.tsx` needs no change.

**Deliberate divergence from the spec:** §4.5 says this route "gains citations". It does not, and should not. Page scope only ever retrieves chunks from the one lecture already named at the top of the tab, so every chip would carry the same title, and `src/lib/citations.ts:1-9` deliberately declines to cite transcript timestamps. Constant-valued chips are noise. The route gains the retrieval; the UI is untouched.

- [ ] **Step 1: Replace the context assembly**

In `src/app/api/pages/[id]/chat/route.ts`, add:

```ts
import { retrieve } from "@/lib/retrieval";
```

Replace the `const context = [...].slice(0, MAX_CONTEXT_CHARS);` statement with:

```ts
  const lastUser = [...result.data.messages].reverse().find((m) => m.role === "user");
  const { hits, mode } = await retrieve({
    scope: { kind: "page", pageId: id },
    query: lastUser?.content ?? "",
  });

  // A lecture that predates the vector index, or whose embedder changed and has
  // not been through `npm run reindex`, has no chunks to retrieve. Falling back
  // to the whole-lecture slice keeps it working exactly as it did before.
  const context =
    mode === "semantic" && hits.length > 0
      ? hits.map((h) => `### ${h.title}\n${h.text}`).join("\n\n---\n\n")
      : [
          page.notes ? `NOTES:\n${page.notes.markdown}` : "",
          page.transcript ? `TRANSCRIPT:\n${page.transcript.rawText}` : "",
        ]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, MAX_CONTEXT_CHARS);
```

`MAX_CONTEXT_CHARS` stays — it is now the fallback's cap, not the default path.

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Check it by hand, including the fallback**

Open an indexed lecture's Chat tab and ask about something specific from the middle of it.
Expected: a correct answer, then:

```bash
sqlite3 prisma/dev.db "SELECT scope, mode, hitCount FROM RetrievalLog ORDER BY createdAt DESC LIMIT 1;"
```

Expected: `page|semantic|` 1-4.

Then open a lecture that has never been indexed (or temporarily set `EMBED_PROVIDER=openrouter` with no API key to force the failure path) and ask a question.
Expected: it still answers from the raw slice, and the row reads `page|unindexed|0` or `page|fts|0`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/pages/[id]/chat/route.ts"
git commit -m "fix: lecture chat retrieves instead of sending the whole lecture"
```

---

### Task 7: Rewire global ask and its citation chips

**Files:**
- Modify: `src/app/api/ask/route.ts`
- Modify: `src/components/ask/LibraryChat.tsx`

**Interfaces:**
- Consumes: `retrieve` (Task 4), `formatCitation` and `type Citation` from `@/lib/citations`.
- Produces: the response field changes from `sources: { pageId, title }[]` to `citations: { label, pageId, materialId }[]`.

**Why the UI must change in the same task:** `LibraryChat.tsx:95` renders every source as `<Link href={\`/pages/${s.pageId}\`}>`. Global ask can now return material hits, whose `pageId` is `null`, and no `/materials` route exists — shipping the route change alone would render `/pages/null` links. `CourseChat.tsx:112-131` already solves this exact problem; copy its shape.

- [ ] **Step 1: Replace the route's retrieval and response**

**This route is pure FTS today.** It must keep a keyword path, or an embedding
failure turns a question that works now into "nothing matched". `retrieve()`
reports that case as `mode: "fts"`; this route is the one that has to honour it.

In `src/app/api/ask/route.ts`, keep the `searchPages` and `db` imports and add:

```ts
import { retrieve } from "@/lib/retrieval";
import { formatCitation, type Citation } from "@/lib/citations";
```

Delete `MAX_SOURCES` and `MAX_CONTEXT_CHARS`, keep `PER_SOURCE_CHARS` (the
fallback still needs it), and add `const FTS_FALLBACK_PAGES = 6;`.

Replace everything from `const hits = await searchPages(...)` through the
`const context = ...` assignment with:

```ts
  const { hits } = await retrieve({ scope: { kind: "all" }, query: lastUser.content });

  const blocks: string[] = [];
  const citations: Citation[] = [];

  if (hits.length > 0) {
    const seen = new Set<string>();
    for (const hit of hits) {
      blocks.push(`### ${hit.title}\n${hit.text}`);
      const citation = formatCitation(hit);
      // Several chunks of one lecture cite it once. Key on the id, not the
      // label: two materials can share a title.
      const key = citation.pageId ?? citation.materialId ?? citation.label;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push(citation);
    }
  } else {
    // No vectors to work with — the library has never been indexed, or every
    // rung of the embedding chain failed. Keyword search is what this route ran
    // on before it had a vector index, and it still answers.
    const ftsHits = await searchPages(lastUser.content, FTS_FALLBACK_PAGES);
    const pages = ftsHits.length
      ? await db.page.findMany({
          where: { id: { in: ftsHits.map((h) => h.pageId) } },
          include: { notes: true, transcript: true },
        })
      : [];
    const byId = new Map(pages.map((p) => [p.id, p]));
    for (const hit of ftsHits) {
      const page = byId.get(hit.pageId);
      if (!page) continue;
      const text = page.notes?.markdown ?? page.transcript?.rawText ?? "";
      if (!text.trim()) continue;
      blocks.push(`### Lecture: ${page.title}\n${text.slice(0, PER_SOURCE_CHARS)}`);
      citations.push({ label: page.title, pageId: page.id, materialId: null });
    }
  }

  const context = blocks.length
    ? blocks.join("\n\n---\n\n")
    : "(No lectures in the library matched this question.)";
```

`mode` is deliberately not destructured: `hits.length` already selects the
branch, and an unused binding fails `npm run lint`. The mode is still recorded
in `RetrievalLog` by `retrieve()` itself, which is where the evidence needs to
live.

Change the success return from `{ reply, sources }` to `{ reply, citations }`.

- [ ] **Step 2: Update the chat UI**

In `src/components/ask/LibraryChat.tsx`, add `Presentation` to the `lucide-react` import. Replace the `Source` and `Message` types with:

```ts
type Citation = { label: string; pageId: string | null; materialId: string | null };
type Message = { role: "user" | "assistant"; content: string; citations?: Citation[] };
```

Change the response handling to:

```ts
        const { reply, citations } = await res.json();
        setMessages((m) => [...m, { role: "assistant", content: reply, citations }]);
```

Replace the `{m.sources && m.sources.length > 0 && (...)}` block with the citation renderer, copied from `src/components/ask/CourseChat.tsx:110-133` so the two stay identical:

```tsx
            {m.citations && m.citations.length > 0 && (
              <div className="flex max-w-[85%] flex-wrap gap-1.5">
                {m.citations.map((c) =>
                  c.pageId ? (
                    <Link
                      key={c.label}
                      href={`/pages/${c.pageId}`}
                      className="flex items-center gap-1 rounded-full border border-brand-border bg-brand-soft/40 px-2.5 py-1 text-[11.5px] font-medium text-brand-ink transition-colors hover:bg-brand-soft"
                    >
                      <FileText className="h-3 w-3" strokeWidth={2.2} />
                      {c.label}
                    </Link>
                  ) : (
                    <span
                      key={c.label}
                      className="flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[11.5px] font-medium text-ink-soft"
                    >
                      <Presentation className="h-3 w-3" strokeWidth={2.2} />
                      {c.label}
                    </span>
                  )
                )}
              </div>
            )}
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Check it by hand**

Open the library ask page. Ask a question that spans courses, then one whose answer lives in an uploaded PDF or slide deck.
Expected: both answer; the material question shows a non-clickable chip, with a slide label where the pptx extractor emitted `Slide N:` blocks. Then:

```bash
sqlite3 prisma/dev.db "SELECT scope, mode, hitCount, spread FROM RetrievalLog WHERE scope='all' ORDER BY createdAt DESC LIMIT 3;"
```

Expected: `all|semantic|` 1-4 `|` spread ≥ 1.

Confirm the reranker actually loaded rather than silently falling back — the server log should contain no `[rerank] unavailable` line. The first query after a fresh checkout downloads ~23MB and is slow; later ones are not.

Then prove the keyword fallback still answers, because this route ran on nothing
else before today. Temporarily set `EMBED_PROVIDER=openrouter` with no
`OPENROUTER_API_KEY` and restart, then ask a question whose words appear in a
lecture.
Expected: a real answer with lecture chips, not "No lectures in the library
matched this question." The row reads `all|fts|0`. Restore the env afterwards.

- [ ] **Step 5: Measure the win**

In `src/app/api/ask/route.ts`, temporarily add `console.log("[ask] context chars:", context.length);` before the `systemPrompt` assignment. Ask three questions, note the numbers, then remove the line.
Expected: ~5,000 characters or fewer, against the previous ceiling of 22,000.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/ask/route.ts src/components/ask/LibraryChat.tsx
git commit -m "fix: global ask retrieves chunks and cites materials"
```

---

### Task 8: Full verification and PR

**Files:** none modified.

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Run lint and the build**

Run: `npm run lint && npm run build`
Expected: both clean.

- [ ] **Step 3: Confirm the log covers all three scopes**

```bash
sqlite3 prisma/dev.db "SELECT scope, mode, COUNT(*), ROUND(AVG(spread),2) FROM RetrievalLog GROUP BY scope, mode;"
```

Expected: rows for `page`, `course` and `all`. The `AVG(spread)` column is the number the concept-graph decision will eventually rest on — an average near 1 means answers come from a single lecture and a graph buys nothing.

- [ ] **Step 4: Open the PR**

```bash
gh pr create --base main --head "$(git branch --show-current)" \
  --title "feat(retrieval): one retriever across lecture, course and library scopes" \
  --body-file <file>
```

Write the description with the `pr-create` skill, which is the source of truth for the format. It must give the real before/after context sizes from Task 7 Step 5, and it must say explicitly that lecture chat's 24,000-character slice silently truncated long transcripts — a bug that threw no error and quietly produced answers missing the end of the lecture is exactly what a reviewer needs told, because nothing in the diff shows it.

---

## Notes for the executor

- **`retrieve()` never throws.** If you find yourself wrapping a call to it in `try`, read its catch block first — you are probably duplicating it.
- **Do not "fix" the double sort.** Candidates are sorted by cosine, sliced to 40, then reordered by the cross-encoder. The first sort is what makes the slice meaningful.
- **Do not drop the `model` filter** when copying a chunk query. `scopeFilter` carries it unconditionally for exactly this reason.
- **The rerank model downloads on first use.** A slow first query is expected, not a bug.
- **Task 6 diverges from the spec on purpose.** The divergence is documented in that task; do not "restore" citations to lecture chat.
