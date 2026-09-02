# Lectern Phase 2 — Retrieval and Course AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each course semantic retrieval over its own lectures and materials, and an Ask tab that answers questions with citations — while letting an uploaded syllabus or slide deck produce flashcards and quiz questions that flow into that course's review and cram.

**Architecture:** A `Chunk` table holds embedded 1200-character slices of lecture transcripts, lecture notes, and course materials. Embedding runs locally in the Next.js Node process via transformers.js (`Xenova/all-MiniLM-L6-v2`, 384-dim), with an OpenRouter embeddings endpoint and then FTS as fallback rungs. Indexing is called beside the existing `upsertSearchIndex` at each pipeline stage. Separately, `Flashcard.pageId` and `QuizQuestion.pageId` become nullable so material-derived cards can exist, which is the one migration that touches existing review and cram read paths.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma 7 + better-sqlite3, Zod 4, `@huggingface/transformers` (new), `node --test` via tsx.

**Spec:** `docs/superpowers/specs/2026-08-28-lectern-course-library-design.md` — §5 data model, §5.1 the one invasive change, §7 retrieval, §8 model tiers, §12 testing, §13 Phase 2.

## Global Constraints

- Single-user local app. No auth, no multi-tenancy, no user IDs anywhere.
- Additive schema only. No existing column is dropped. `Folder` and `Page` model names stay; UI says "course" and "lecture".
- `Chunk` carries **no** denormalized `folderId`. Course scoping goes through the relation (`page: { folderId }` / `material: { folderId }`).
- Embedding is local-first and free. Cost is never a reason to skip a re-index.
- Every existing per-lecture route keeps its current model env var and its current cost. Only new course-scoped work uses the REASONING tier.
- `searchCourse` scores **only** chunks whose `model` equals the active embedder's label. Mixing 384-dim and 1536-dim vectors is silent nonsense; the filter is what prevents it.
- `searchCourse` default `k = 8`. Free and local models are context-tight.
- Tests are `node --test` + `node:assert/strict`, live in `src/lib/**/*.test.ts` (that glob is what `npm test` runs), use **relative** imports (`./x.ts`, not `@/lib/x`), and touch no database and no network.
- Every user-facing string says "course", never "folder".
- Commit after each task. Run `npm test`, `npx tsc --noEmit`, and `npm run lint` before each commit.

---

### Task 1: Local embedding engine and the `Chunk` table

Pure vector math and hash-diff planning go in `embed-math.ts` with zero imports so they are testable without a database or a model download. `embeddings.ts` holds everything with I/O.

**Files:**
- Create: `src/lib/embed-math.ts`
- Create: `src/lib/embed-math.test.ts`
- Create: `src/lib/embeddings.ts`
- Modify: `prisma/schema.prisma` (add `Chunk` model, `ChunkSource` enum, and the `chunks` relation on `Page` and `Material`)
- Modify: `next.config.ts:6` (add transformers to `serverExternalPackages`)
- Modify: `package.json` (add `@huggingface/transformers`)
- Modify: `.env.example` (add `EMBED_PROVIDER`, `OPENROUTER_MODEL_EMBED`)

**Interfaces:**
- Consumes: `splitTextIntoChunks(text: string, maxLen: number): string[]` from `src/lib/text-chunks.ts`; `db` from `src/lib/db.ts`.
- Produces:
  - `cosine(a: Float32Array, b: Float32Array): number`
  - `encodeVector(v: Float32Array): Buffer`
  - `decodeVector(b: Buffer | Uint8Array): Float32Array`
  - `hashChunk(text: string): string`
  - `planChunkWork(existing: ExistingChunk[], incoming: string[], model: string): ChunkPlan`
  - `courseChunkFilter(folderId: string, model: string): { model: string; OR: [{ page: { folderId: string } }, { material: { folderId: string } }] }`
  - `type ExistingChunk = { ord: number; hash: string; model: string }`
  - `type ChunkPlan = { reuse: number[]; embed: { ord: number; text: string; hash: string }[]; deleteFrom: number }`
  - `activeEmbedModelLabel(): string`
  - `embedTexts(texts: string[]): Promise<Float32Array[]>`
  - `indexSource(target: { pageId: string } | { materialId: string }): Promise<{ indexed: number; skipped: number } | null>`
  - `searchCourse(folderId: string, query: string, k?: number): Promise<CourseHit[]>`
  - `type CourseHit = { chunkId: string; text: string; score: number; source: "LECTURE_TRANSCRIPT" | "LECTURE_NOTES" | "MATERIAL"; pageId: string | null; materialId: string | null; title: string }`

- [ ] **Step 1: Install the dependency**

```bash
npm install @huggingface/transformers@^3
```

- [ ] **Step 2: Write the failing tests for the pure math**

Create `src/lib/embed-math.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cosine,
  courseChunkFilter,
  encodeVector,
  decodeVector,
  hashChunk,
  planChunkWork,
} from "./embed-math.ts";

test("cosine of identical vectors is 1", () => {
  const v = new Float32Array([1, 2, 3]);
  assert.ok(Math.abs(cosine(v, v) - 1) < 1e-6);
});

test("cosine of orthogonal vectors is 0", () => {
  assert.ok(Math.abs(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))) < 1e-6);
});

test("cosine of opposite vectors is -1", () => {
  const out = cosine(new Float32Array([1, 1]), new Float32Array([-1, -1]));
  assert.ok(Math.abs(out + 1) < 1e-6);
});

test("cosine returns 0 rather than NaN for a zero vector", () => {
  assert.equal(cosine(new Float32Array([0, 0]), new Float32Array([1, 1])), 0);
});

test("cosine refuses vectors of different lengths", () => {
  assert.throws(() => cosine(new Float32Array([1, 2]), new Float32Array([1, 2, 3])), /length/i);
});

test("a vector survives an encode/decode round trip", () => {
  const v = new Float32Array([0.5, -0.25, 1e-8, 3]);
  const back = decodeVector(encodeVector(v));
  assert.equal(back.length, v.length);
  for (let i = 0; i < v.length; i++) assert.equal(back[i], v[i]);
});

test("hashChunk is stable for the same text and differs for different text", () => {
  assert.equal(hashChunk("photosynthesis"), hashChunk("photosynthesis"));
  assert.notEqual(hashChunk("photosynthesis"), hashChunk("Photosynthesis"));
});

test("planChunkWork reuses chunks whose text and model are unchanged", () => {
  const model = "local:test";
  const texts = ["alpha", "beta"];
  const existing = texts.map((t, ord) => ({ ord, hash: hashChunk(t), model }));

  const plan = planChunkWork(existing, texts, model);

  assert.deepEqual(plan.reuse, [0, 1]);
  assert.deepEqual(plan.embed, []);
  assert.equal(plan.deleteFrom, 2);
});

test("planChunkWork re-embeds only the chunk whose text changed", () => {
  const model = "local:test";
  const existing = [
    { ord: 0, hash: hashChunk("alpha"), model },
    { ord: 1, hash: hashChunk("beta"), model },
  ];

  const plan = planChunkWork(existing, ["alpha", "gamma"], model);

  assert.deepEqual(plan.reuse, [0]);
  assert.equal(plan.embed.length, 1);
  assert.equal(plan.embed[0].ord, 1);
  assert.equal(plan.embed[0].text, "gamma");
});

test("planChunkWork re-embeds everything when the embedding model changed", () => {
  const existing = [
    { ord: 0, hash: hashChunk("alpha"), model: "openrouter:old" },
    { ord: 1, hash: hashChunk("beta"), model: "openrouter:old" },
  ];

  const plan = planChunkWork(existing, ["alpha", "beta"], "local:new");

  assert.deepEqual(plan.reuse, []);
  assert.equal(plan.embed.length, 2);
});

test("courseChunkFilter pins the query to the active model and both relations", () => {
  assert.deepEqual(courseChunkFilter("f1", "local:test"), {
    model: "local:test",
    OR: [{ page: { folderId: "f1" } }, { material: { folderId: "f1" } }],
  });
});

test("planChunkWork marks the tail for deletion when the text got shorter", () => {
  const model = "local:test";
  const existing = [
    { ord: 0, hash: hashChunk("alpha"), model },
    { ord: 1, hash: hashChunk("beta"), model },
    { ord: 2, hash: hashChunk("gamma"), model },
  ];

  const plan = planChunkWork(existing, ["alpha"], model);

  assert.deepEqual(plan.reuse, [0]);
  assert.equal(plan.deleteFrom, 1);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './embed-math.ts'`

- [ ] **Step 4: Write `src/lib/embed-math.ts`**

```ts
import { createHash } from "node:crypto";

/**
 * Pure vector and planning helpers. Deliberately free of imports from db, the
 * embedding model, or the network so `npm test` can cover them without loading
 * a 25MB model or opening SQLite.
 */

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  // A zero vector has no direction; 0 is the honest answer, NaN is a bug that
  // silently poisons every ranking it touches.
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function encodeVector(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function decodeVector(b: Buffer | Uint8Array): Float32Array {
  // Copy rather than view: a Buffer from SQLite may sit at a non-multiple-of-4
  // byteOffset inside a pooled allocation, which a Float32Array view rejects.
  const copy = Uint8Array.prototype.slice.call(b);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

export function hashChunk(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * The where-clause for a course's searchable chunks.
 *
 * `model` is not an optimization — vectors from two embedders are not
 * comparable and often not even the same dimension, so scoring across them is
 * silent nonsense. Omitting this filter is the single easiest way to make
 * retrieval quietly wrong.
 */
export function courseChunkFilter(folderId: string, model: string) {
  return {
    model,
    OR: [{ page: { folderId } }, { material: { folderId } }] as [
      { page: { folderId: string } },
      { material: { folderId: string } },
    ],
  };
}

export type ExistingChunk = { ord: number; hash: string; model: string };

export type ChunkPlan = {
  /** ords whose stored vector is still valid and must not be re-embedded */
  reuse: number[];
  /** chunks that need an embedding call */
  embed: { ord: number; text: string; hash: string }[];
  /** every stored chunk with ord >= this is stale and must be deleted */
  deleteFrom: number;
};

/**
 * Decides the minimum embedding work for a source whose text may have changed.
 * A chunk is reusable only when both its content hash and the embedding model
 * match — a model change invalidates every vector, because vectors from two
 * models are not comparable (and often not even the same dimension).
 */
export function planChunkWork(
  existing: ExistingChunk[],
  incoming: string[],
  model: string
): ChunkPlan {
  const byOrd = new Map(existing.map((c) => [c.ord, c]));
  const reuse: number[] = [];
  const embed: { ord: number; text: string; hash: string }[] = [];

  incoming.forEach((text, ord) => {
    const hash = hashChunk(text);
    const prior = byOrd.get(ord);
    if (prior && prior.hash === hash && prior.model === model) {
      reuse.push(ord);
    } else {
      embed.push({ ord, text, hash });
    }
  });

  return { reuse, embed, deleteFrom: incoming.length };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — every `embed-math` test green, existing tests still green.

- [ ] **Step 6: Add the `Chunk` model to the schema**

In `prisma/schema.prisma`, add the enum next to `MaterialKind`:

```prisma
enum ChunkSource {
  LECTURE_TRANSCRIPT
  LECTURE_NOTES
  MATERIAL
}
```

Add the model:

```prisma
model Chunk {
  id         String      @id @default(cuid())
  source     ChunkSource
  pageId     String?
  materialId String?
  ord        Int
  text       String
  vector     Bytes
  hash       String
  model      String
  createdAt  DateTime    @default(now())

  page     Page?     @relation(fields: [pageId], references: [id], onDelete: Cascade)
  material Material? @relation(fields: [materialId], references: [id], onDelete: Cascade)

  @@index([pageId])
  @@index([materialId])
}
```

Add the back-relations — `chunks Chunk[]` inside `model Page` and inside `model Material`.

- [ ] **Step 7: Create and apply the migration**

```bash
npx prisma migrate dev --name add_chunk_table
```

Expected: a new folder under `prisma/migrations/`, and `src/generated/prisma` regenerated with a `Chunk` model.

- [ ] **Step 8: Keep the ONNX runtime out of the bundler**

In `next.config.ts`, extend the existing array:

```ts
serverExternalPackages: ["@modelcontextprotocol/sdk", "@huggingface/transformers"],
```

Without this, Next tries to trace `onnxruntime-node`'s native binary and the build fails.

- [ ] **Step 9: Write `src/lib/embeddings.ts`**

```ts
import { db } from "@/lib/db";
import { splitTextIntoChunks } from "@/lib/text-chunks";
import {
  cosine,
  courseChunkFilter,
  decodeVector,
  encodeVector,
  planChunkWork,
  type ExistingChunk,
} from "@/lib/embed-math";

const CHUNK_CHARS = 1200;
const LOCAL_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_K = 8;

type Provider = "local" | "openrouter";

function provider(): Provider {
  const raw = (process.env.EMBED_PROVIDER || "local").trim().toLowerCase();
  if (raw === "openrouter") return "openrouter";
  if (raw !== "local") {
    throw new Error(`Unknown EMBED_PROVIDER "${raw}". Use "local" or "openrouter".`);
  }
  return "local";
}

/**
 * The label stored in `Chunk.model`. Every vector is tagged with the exact
 * embedder that produced it, because vectors from two models cannot be
 * compared — often not even the same dimension. `searchCourse` filters on this
 * label, so a provider switch makes old vectors invisible rather than wrong.
 */
export function activeEmbedModelLabel(): string {
  if (provider() === "openrouter") {
    return `openrouter:${process.env.OPENROUTER_MODEL_EMBED ?? "openai/text-embedding-3-small"}`;
  }
  return `local:${LOCAL_MODEL}`;
}

// The pipeline holds a loaded model in memory; build it once per process.
let extractorPromise: Promise<unknown> | null = null;

async function localEmbed(texts: string[]): Promise<Float32Array[]> {
  const { pipeline } = await import("@huggingface/transformers");
  if (!extractorPromise) {
    // q8 keeps the download near 25MB and the quality difference is not
    // measurable for retrieval over one course.
    extractorPromise = pipeline("feature-extraction", LOCAL_MODEL, { dtype: "q8" });
  }
  const extractor = (await extractorPromise) as (
    input: string[],
    opts: { pooling: "mean"; normalize: boolean }
  ) => Promise<{ tolist: () => number[][] }>;

  const output = await extractor(texts, { pooling: "mean", normalize: true });
  return output.tolist().map((row) => new Float32Array(row));
}

async function openRouterEmbed(texts: string[]): Promise<Float32Array[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");
  const model = process.env.OPENROUTER_MODEL_EMBED ?? "openai/text-embedding-3-small";

  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter embeddings returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  const rows = data.data;
  if (!rows || rows.length !== texts.length) {
    throw new Error("OpenRouter embeddings returned an unexpected shape");
  }
  return rows.map((r) => new Float32Array(r.embedding));
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  return provider() === "openrouter" ? openRouterEmbed(texts) : localEmbed(texts);
}

/**
 * Re-embeds a lecture or material's text into `Chunk` rows, doing the minimum
 * work: unchanged chunks keep their stored vector. Returns null when there is
 * nothing to index, and throws when embedding itself fails — callers decide
 * whether that should fail their request (see indexSourceSafely usage in the
 * pipeline routes).
 */
export async function indexSource(
  target: { pageId: string } | { materialId: string }
): Promise<{ indexed: number; skipped: number } | null> {
  const model = activeEmbedModelLabel();

  const jobs: { source: "LECTURE_TRANSCRIPT" | "LECTURE_NOTES" | "MATERIAL"; text: string }[] = [];

  if ("pageId" in target) {
    const page = await db.page.findUnique({
      where: { id: target.pageId },
      include: { transcript: true, notes: true },
    });
    if (!page) return null;
    if (page.transcript?.rawText?.trim()) {
      jobs.push({ source: "LECTURE_TRANSCRIPT", text: page.transcript.rawText });
    }
    if (page.notes?.markdown?.trim()) {
      jobs.push({ source: "LECTURE_NOTES", text: page.notes.markdown });
    }
  } else {
    const material = await db.material.findUnique({
      where: { id: target.materialId },
      select: { text: true },
    });
    if (!material?.text.trim()) return null;
    jobs.push({ source: "MATERIAL", text: material.text });
  }

  if (jobs.length === 0) return null;

  let indexed = 0;
  let skipped = 0;

  for (const job of jobs) {
    const incoming = splitTextIntoChunks(job.text, CHUNK_CHARS);
    const where =
      "pageId" in target
        ? { pageId: target.pageId, source: job.source }
        : { materialId: target.materialId, source: job.source };

    const existing: ExistingChunk[] = await db.chunk.findMany({
      where,
      select: { ord: true, hash: true, model: true },
    });

    const plan = planChunkWork(existing, incoming, model);
    skipped += plan.reuse.length;

    const vectors = plan.embed.length ? await embedTexts(plan.embed.map((c) => c.text)) : [];
    indexed += plan.embed.length;

    await db.$transaction([
      db.chunk.deleteMany({
        where: {
          ...where,
          OR: [
            { ord: { gte: plan.deleteFrom } },
            { ord: { in: plan.embed.map((c) => c.ord) } },
          ],
        },
      }),
      ...plan.embed.map((chunk, i) =>
        db.chunk.create({
          data: {
            ...where,
            ord: chunk.ord,
            text: chunk.text,
            hash: chunk.hash,
            model,
            vector: encodeVector(vectors[i]),
          },
        })
      ),
    ]);
  }

  return { indexed, skipped };
}

export type CourseHit = {
  chunkId: string;
  text: string;
  score: number;
  source: "LECTURE_TRANSCRIPT" | "LECTURE_NOTES" | "MATERIAL";
  pageId: string | null;
  materialId: string | null;
  title: string;
};

/**
 * Semantic search over one course's chunks.
 *
 * ponytail: brute-force cosine over one course's chunks; move to sqlite-vec if
 * a course ever exceeds ~50k chunks.
 */
export async function searchCourse(
  folderId: string,
  query: string,
  k = DEFAULT_K
): Promise<CourseHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const model = activeEmbedModelLabel();
  const rows = await db.chunk.findMany({
    // Vectors written by a different embedder are invisible here, not wrong:
    // they come back only after `npm run reindex`.
    where: courseChunkFilter(folderId, model),
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
  if (rows.length === 0) return [];

  const [queryVector] = await embedTexts([trimmed]);

  return rows
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
    .slice(0, k);
}
```

- [ ] **Step 10: Document the new env values**

Append to `.env.example`:

```
# Embeddings for course-scoped semantic search.
# "local" runs Xenova/all-MiniLM-L6-v2 in this process — free, offline, no key.
# "openrouter" uses OPENROUTER_MODEL_EMBED instead. Switching provider or model
# invalidates every stored vector: run `npm run reindex` afterwards.
EMBED_PROVIDER="local"
OPENROUTER_MODEL_EMBED="openai/text-embedding-3-small"
```

- [ ] **Step 11: Verify the whole thing compiles and the suite is green**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: tests PASS, no type errors, no lint errors.

- [ ] **Step 12: Commit**

```bash
git add prisma/schema.prisma prisma/migrations next.config.ts package.json package-lock.json .env.example src/lib/embed-math.ts src/lib/embed-math.test.ts src/lib/embeddings.ts
git commit -m "feat: add local embedding engine and the Chunk table

Embedding runs in-process via transformers.js on all-MiniLM-L6-v2, with
OpenRouter's embeddings endpoint as an alternate provider. Every vector is
tagged with the embedder that produced it so search can never score across
two models' dimensions.

Vector math and the hash-diff planner live in embed-math.ts with no imports,
so the suite covers them without loading a model or opening SQLite."
```

---

### Task 2: Index on write, and a reindex script

**Files:**
- Create: `scripts/reindex.ts`
- Modify: `package.json` (add the `reindex` script)
- Modify: `src/app/api/pages/[id]/transcribe/route.ts` (index after the transcript is written)
- Modify: `src/app/api/pages/[id]/summarize/route.ts` (index after notes are written)
- Modify: `src/app/api/pages/[id]/edit-notes/route.ts` (index after notes are edited)
- Modify: `src/app/api/pages/from-text/route.ts` (index after an imported transcript is written)
- Modify: `src/app/api/folders/[id]/materials/route.ts:18-32` (index after the material is created)

**Interfaces:**
- Consumes: `indexSource`, `activeEmbedModelLabel` from Task 1.
- Produces: `npm run reindex` as a working command. No new exported functions.

- [ ] **Step 1: Find every place `upsertSearchIndex` is already called**

Run: `grep -rn "upsertSearchIndex" src/app src/lib`
Expected: the FTS sync points. Indexing goes beside each one that writes transcript, notes, or material text — that is the whole point of the placement.

- [ ] **Step 2: Add indexing beside each FTS sync**

In each route listed under **Files**, after the existing `await upsertSearchIndex(id)` (or after the material `create`), add:

```ts
// Semantic index is best-effort: a failed embedding must not fail the write
// the user just made. Course ask degrades to FTS when chunks are missing.
try {
  await indexSource({ pageId: id });
} catch (e) {
  console.error(`[embeddings] indexing page ${id} failed:`, e);
}
```

with the import:

```ts
import { indexSource } from "@/lib/embeddings";
```

`id` here means whichever variable that route holds the page's id in —
`src/app/api/pages/from-text/route.ts` names it after the row it just created,
not `id`. Use the created page's id there.

For `src/app/api/folders/[id]/materials/route.ts`, the target is the material and the id is the created row's:

```ts
try {
  await indexSource({ materialId: material.id });
} catch (e) {
  console.error(`[embeddings] indexing material ${material.id} failed:`, e);
}
```

placed after the `db.material.create` call and before the `NextResponse.json` return.

- [ ] **Step 3: Write the reindex script**

Create `scripts/reindex.ts`:

```ts
/**
 * Backfills semantic chunks for content that predates the Chunk table, and
 * re-embeds everything after an embedding provider or model change.
 *
 * Run: npm run reindex
 */
import "dotenv/config";
import { db } from "../src/lib/db.ts";
import { activeEmbedModelLabel, indexSource } from "../src/lib/embeddings.ts";

async function main() {
  const model = activeEmbedModelLabel();
  console.log(`Reindexing with ${model}`);

  const stale = await db.chunk.count({ where: { model: { not: model } } });
  if (stale > 0) {
    console.log(`${stale} chunks were embedded by a different model and will be replaced.`);
  }

  const pages = await db.page.findMany({ select: { id: true, title: true } });
  const materials = await db.material.findMany({ select: { id: true, title: true } });

  let indexed = 0;
  let skipped = 0;
  let failed = 0;

  for (const page of pages) {
    try {
      const result = await indexSource({ pageId: page.id });
      indexed += result?.indexed ?? 0;
      skipped += result?.skipped ?? 0;
      console.log(`  lecture "${page.title}" — ${result ? `${result.indexed} embedded, ${result.skipped} reused` : "nothing to index"}`);
    } catch (e) {
      failed++;
      console.error(`  lecture "${page.title}" FAILED:`, e instanceof Error ? e.message : e);
    }
  }

  for (const material of materials) {
    try {
      const result = await indexSource({ materialId: material.id });
      indexed += result?.indexed ?? 0;
      skipped += result?.skipped ?? 0;
      console.log(`  material "${material.title}" — ${result ? `${result.indexed} embedded, ${result.skipped} reused` : "nothing to index"}`);
    } catch (e) {
      failed++;
      console.error(`  material "${material.title}" FAILED:`, e instanceof Error ? e.message : e);
    }
  }

  // Anything still tagged with another model belongs to content that no longer
  // exists; leaving it would keep it invisible but occupying space.
  const orphaned = await db.chunk.deleteMany({ where: { model: { not: model } } });

  console.log(
    `\nDone: ${indexed} chunks embedded, ${skipped} reused, ${orphaned.count} stale rows removed, ${failed} sources failed.`
  );
  if (failed > 0) process.exitCode = 1;
}

main().finally(() => db.$disconnect());
```

- [ ] **Step 4: Register the script**

In `package.json`, add to `scripts`:

```json
"reindex": "node --import tsx scripts/reindex.ts"
```

- [ ] **Step 5: Run the reindex against your local database**

Run: `npm run reindex`
Expected: it prints a line per lecture and material, and finishes with a `Done:` summary. The first run downloads the model — a one-off pause of up to a minute with no output is normal.

- [ ] **Step 6: Verify chunks actually landed**

```bash
npx prisma studio
```

Expected: the `Chunk` table has rows, each with a `model` of `local:Xenova/all-MiniLM-L6-v2` and a non-empty `vector`. Close Studio when done.

- [ ] **Step 7: Verify a second run does no work**

Run: `npm run reindex`
Expected: every line reports `0 embedded, N reused`. This is the hash-diff doing its job; if it re-embeds, `planChunkWork` or the `hash` write is wrong.

- [ ] **Step 8: Check types, lint, tests**

```bash
npm test
npx tsc --noEmit
npm run lint
```

- [ ] **Step 9: Commit**

```bash
git add package.json scripts/reindex.ts src/app/api
git commit -m "feat: index content for semantic search as it is written

Indexing sits beside each existing upsertSearchIndex call, and is
best-effort: a failed embedding logs and lets the user's write succeed,
because course ask degrades to FTS when chunks are missing.

npm run reindex backfills pre-existing content, re-embeds after a model
change, and drops vectors left behind by a previous embedder."
```

---

### Task 3: The nullable-`pageId` migration (lands alone)

This is the riskiest change in Phase 2 (spec §14). It ships as its own commit with no feature work attached, so a revert is surgical. The exclusive-or between `pageId` and `materialId` cannot be expressed in SQLite through Prisma, so a code-level guard plus its test is the only enforcement.

**Files:**
- Create: `src/lib/cards.ts`
- Create: `src/lib/cards.test.ts`
- Modify: `prisma/schema.prisma` (`Flashcard` and `QuizQuestion`: nullable `pageId`, new `materialId`; `Material` gains both back-relations)
- Modify: `src/app/api/review/due/route.ts` (course filter across both relations, nullable page in the payload)
- Modify: `src/components/review/ReviewSession.tsx:9-14,93-94` (a card's source may be a material)
- Modify: `src/app/folders/[folderId]/page.tsx:35` (quiz count across both relations)
- Modify: `src/app/folders/[folderId]/cram/page.tsx:25-27` (questions across both relations)
- Modify: `src/components/flashcards/FlashcardList.tsx` (only if it reads `card.page`; check first)
- Test: `src/lib/cards.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type CardParent = { pageId?: string | null; materialId?: string | null }`
  - `assertSingleParent(parent: CardParent): { pageId: string; materialId: null } | { pageId: null; materialId: string }`
  - `courseScopeFilter(folderId: string): { OR: [{ page: { folderId: string } }, { material: { folderId: string } }] }`
  - `type CardSource = { kind: "lecture"; id: string; title: string } | { kind: "material"; id: string; title: string }`
  - `cardSource(row: { page: { id: string; title: string } | null; material: { id: string; title: string } | null }): CardSource | null`

- [ ] **Step 1: Grep every read of a card's page before touching the schema**

```bash
grep -rn "pageId" src/app src/components src/lib | grep -iv "generated" | grep -i "flashcard\|quiz\|card"
grep -rn "\.page\b" src/components/review src/components/flashcards src/components/quiz
```

Expected: the call sites listed under **Files**. If the grep surfaces a site not listed, add it to this task — a missed read is exactly how this migration breaks review.

- [ ] **Step 2: Write the failing tests for the guard and the scope filter**

Create `src/lib/cards.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSingleParent, cardSource, courseScopeFilter } from "./cards.ts";

test("assertSingleParent accepts a lecture-parented card", () => {
  assert.deepEqual(assertSingleParent({ pageId: "p1" }), { pageId: "p1", materialId: null });
});

test("assertSingleParent accepts a material-parented card", () => {
  assert.deepEqual(assertSingleParent({ materialId: "m1" }), { pageId: null, materialId: "m1" });
});

test("assertSingleParent rejects a card with no parent", () => {
  assert.throws(() => assertSingleParent({}), /exactly one/i);
  assert.throws(() => assertSingleParent({ pageId: null, materialId: null }), /exactly one/i);
});

test("assertSingleParent rejects a card parented to both", () => {
  assert.throws(() => assertSingleParent({ pageId: "p1", materialId: "m1" }), /exactly one/i);
});

test("courseScopeFilter matches cards through either relation", () => {
  assert.deepEqual(courseScopeFilter("f1"), {
    OR: [{ page: { folderId: "f1" } }, { material: { folderId: "f1" } }],
  });
});

test("cardSource describes a lecture-parented card", () => {
  const out = cardSource({ page: { id: "p1", title: "Photosynthesis" }, material: null });
  assert.deepEqual(out, { kind: "lecture", id: "p1", title: "Photosynthesis" });
});

test("cardSource describes a material-parented card", () => {
  const out = cardSource({ page: null, material: { id: "m1", title: "Week 2 slides" } });
  assert.deepEqual(out, { kind: "material", id: "m1", title: "Week 2 slides" });
});

test("cardSource returns null when a card has lost its parent", () => {
  assert.equal(cardSource({ page: null, material: null }), null);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './cards.ts'`

- [ ] **Step 4: Write `src/lib/cards.ts`**

```ts
/**
 * Flashcards and quiz questions hang from exactly one parent: a lecture or a
 * course material. SQLite cannot express that exclusive-or through Prisma, so
 * these helpers are the enforcement — every create path routes through
 * assertSingleParent, and every course-scoped read through courseScopeFilter.
 */

export type CardParent = { pageId?: string | null; materialId?: string | null };

export function assertSingleParent(
  parent: CardParent
): { pageId: string; materialId: null } | { pageId: null; materialId: string } {
  const hasPage = typeof parent.pageId === "string" && parent.pageId.length > 0;
  const hasMaterial = typeof parent.materialId === "string" && parent.materialId.length > 0;

  if (hasPage === hasMaterial) {
    throw new Error(
      "A card must belong to exactly one of a lecture or a material, not both and not neither."
    );
  }
  return hasPage
    ? { pageId: parent.pageId as string, materialId: null }
    : { pageId: null, materialId: parent.materialId as string };
}

/**
 * Course scoping for cards, which now reach a course through either relation.
 * Filtering on `page: { folderId }` alone silently hides every material card.
 */
export function courseScopeFilter(folderId: string) {
  return {
    OR: [{ page: { folderId } }, { material: { folderId } }] as [
      { page: { folderId: string } },
      { material: { folderId: string } },
    ],
  };
}

export type CardSource =
  | { kind: "lecture"; id: string; title: string }
  | { kind: "material"; id: string; title: string };

export function cardSource(row: {
  page: { id: string; title: string } | null;
  material: { id: string; title: string } | null;
}): CardSource | null {
  if (row.page) return { kind: "lecture", id: row.page.id, title: row.page.title };
  if (row.material) return { kind: "material", id: row.material.id, title: row.material.title };
  return null;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Change the schema**

In `prisma/schema.prisma`, `model Flashcard` — `pageId` becomes optional, `materialId` is added, and the relation becomes optional:

```prisma
model Flashcard {
  id               String   @id @default(cuid())
  pageId           String?
  materialId       String?
  prompt           String
  idealExplanation String
  sourceTerm       String?
  // ...scheduling fields unchanged...

  page       Page?       @relation(fields: [pageId], references: [id], onDelete: Cascade)
  material   Material?   @relation(fields: [materialId], references: [id], onDelete: Cascade)
  reviewLogs ReviewLog[]

  @@index([pageId])
  @@index([materialId])
  @@index([nextReviewAt])
}
```

`model QuizQuestion` — the same treatment:

```prisma
model QuizQuestion {
  id            String       @id @default(cuid())
  pageId        String?
  materialId    String?
  type          QuestionType
  prompt        String
  correctAnswer String
  options       String?
  explanation   String?
  createdAt     DateTime     @default(now())

  page     Page?         @relation(fields: [pageId], references: [id], onDelete: Cascade)
  material Material?     @relation(fields: [materialId], references: [id], onDelete: Cascade)
  attempts QuizAttempt[]

  @@index([pageId])
  @@index([materialId])
}
```

And `model Material` gains the two back-relations:

```prisma
  flashcards    Flashcard[]
  quizQuestions QuizQuestion[]
```

- [ ] **Step 7: Migrate**

```bash
npx prisma migrate dev --name nullable_card_parent
```

Expected: migration applies with no data loss prompt — widening a column to nullable and adding a nullable column are both non-destructive. If Prisma warns about data loss, STOP and read the generated SQL before continuing.

- [ ] **Step 8: Fix `/api/review/due` to scope across both relations**

Replace the body of `src/app/api/review/due/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { courseScopeFilter } from "@/lib/cards";

export async function GET(req: NextRequest) {
  const folderId = req.nextUrl.searchParams.get("folderId");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Math.min(100, Math.max(1, Number(limitParam))) : 20;

  const where = {
    nextReviewAt: { lte: new Date() },
    ...(folderId ? courseScopeFilter(folderId) : {}),
  };

  const [cards, total] = await Promise.all([
    db.flashcard.findMany({
      where,
      orderBy: { nextReviewAt: "asc" },
      take: limit,
      include: {
        page: { select: { id: true, title: true } },
        material: { select: { id: true, title: true } },
      },
    }),
    db.flashcard.count({ where }),
  ]);

  return NextResponse.json({ cards, total });
}
```

- [ ] **Step 9: Teach `ReviewSession` that a card may come from a material**

In `src/components/review/ReviewSession.tsx`, replace the `DueCard` type:

```ts
type DueCard = {
  id: string;
  prompt: string;
  idealExplanation: string;
  page: { id: string; title: string } | null;
  material: { id: string; title: string } | null;
};
```

and replace the source link (currently lines 93-94) with a branch that links a lecture card to its lecture and labels a material card, which has no page to open:

```tsx
{card.page ? (
  <Link href={`/pages/${card.page.id}`} className="truncate font-medium hover:text-brand">
    {card.page.title}
  </Link>
) : card.material ? (
  <span className="truncate font-medium">{card.material.title}</span>
) : (
  <span className="truncate font-medium text-zinc-400">Unknown source</span>
)}
```

- [ ] **Step 10: Fix the course page's quiz count**

In `src/app/folders/[folderId]/page.tsx`, line 35 becomes:

```ts
db.quizQuestion.count({ where: courseScopeFilter(folderId) }),
```

with `import { courseScopeFilter } from "@/lib/cards";` added.

- [ ] **Step 11: Fix the cram page's question query**

In `src/app/folders/[folderId]/cram/page.tsx`, the query becomes:

```ts
const questions = await db.quizQuestion.findMany({
  where: courseScopeFilter(folderId),
  select: { id: true, type: true, prompt: true, options: true },
});
```

with `import { courseScopeFilter } from "@/lib/cards";` added. Also update the subtitle copy, which currently claims every lecture:

```tsx
{runnerQuestions.length} question{runnerQuestions.length === 1 ? "" : "s"} mixed from this course&apos;s lectures and materials.
```

- [ ] **Step 12: Route every existing card create through the guard**

In `src/app/api/pages/[id]/generate-flashcards/route.ts`, the `createMany` data becomes:

```ts
data: parsed.flashcards.map((card) => ({
  ...assertSingleParent({ pageId: id }),
  prompt: card.prompt,
  idealExplanation: card.idealExplanation,
  sourceTerm: card.sourceTerm,
})),
```

In `src/app/api/pages/[id]/generate-quiz/route.ts`:

```ts
data: parsed.questions.map((q) => ({
  ...assertSingleParent({ pageId: id }),
  type: q.type,
  prompt: q.prompt,
  correctAnswer: q.correctAnswer,
  options: q.type === "MULTIPLE_CHOICE" ? JSON.stringify(q.options) : null,
  explanation: q.explanation,
})),
```

Both need `import { assertSingleParent } from "@/lib/cards";`.

- [ ] **Step 13: Find anything the compiler now rejects**

Run: `npx tsc --noEmit`
Expected: errors at every remaining place that assumed a non-null `page` on a card. Fix each by branching on `card.page` the way Step 9 does. `flashcardCount`/`quizCount` reads filtered by `{ pageId: id }` still work unchanged — that filter is still valid for lecture cards.

- [ ] **Step 14: Verify review and cram still work in the browser**

```bash
npm run dev
```

Check, on an existing course that already has cards:
1. `/review` lists due cards and each shows its lecture title as a link.
2. Grading a card advances the session.
3. `/folders/<id>` shows the same quiz count as before this task.
4. `/folders/<id>/cram` runs with the same questions as before.

Expected: no behavior change at all. This task is a schema widening; a visible difference means a read path is wrong.

- [ ] **Step 15: Full check**

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all green. `npm run build` matters here — a broken card read that only appears in a server component shows up at build time.

- [ ] **Step 16: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/cards.ts src/lib/cards.test.ts src/app src/components
git commit -m "feat: let flashcards and quiz questions hang from a material

Flashcard.pageId and QuizQuestion.pageId become nullable with an optional
materialId alongside, so an uploaded syllabus or slide deck can produce
cards. SQLite cannot express the exclusive-or, so assertSingleParent is the
enforcement and courseScopeFilter is the read-side counterpart — filtering
on page.folderId alone would silently hide every material card.

Lands alone, with no feature work attached, because it is the one change in
this phase that can break existing review and cram."
```

---

### Task 4: Per-material flashcard and quiz generation

**Files:**
- Create: `src/app/api/materials/[id]/generate-flashcards/route.ts`
- Create: `src/app/api/materials/[id]/generate-quiz/route.ts`
- Modify: `src/components/dashboard/MaterialList.tsx` (per-row generate buttons and counts)
- Modify: `src/app/folders/[folderId]/page.tsx:36-46` (select the card counts for each material)

**Interfaces:**
- Consumes: `assertSingleParent` from Task 3; `indexSource` from Task 1; `flashcardsResponseSchema`, `quizResponseSchema` from `src/lib/validation.ts`; `FLASHCARDS_SYSTEM_PROMPT`/`buildFlashcardsUserPrompt`, `QUIZ_SYSTEM_PROMPT`/`buildQuizUserPrompt` from `src/lib/prompts/`.
- Produces: `POST /api/materials/[id]/generate-flashcards` and `POST /api/materials/[id]/generate-quiz`, both returning `{ count: number }`. `MaterialSummary` gains `flashcardCount: number` and `quizCount: number`.

- [ ] **Step 1: Write the flashcards route**

Create `src/app/api/materials/[id]/generate-flashcards/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { FLASHCARDS_SYSTEM_PROMPT, buildFlashcardsUserPrompt } from "@/lib/prompts/flashcards";
import { flashcardsResponseSchema } from "@/lib/validation";
import { assertSingleParent } from "@/lib/cards";

// A material has no notes step, so its raw text is the source. Cap what goes
// into one prompt: a 200-page reading would otherwise blow past a free model's
// context window and fail with an opaque provider error.
const MAX_PROMPT_CHARS = 24_000;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const material = await db.material.findUnique({
    where: { id },
    select: { id: true, title: true, text: true },
  });
  if (!material) return jsonError("Material not found", 404);
  if (!material.text.trim()) return jsonError("This material has no text to generate from", 422);

  const model = process.env.OPENROUTER_MODEL_FLASHCARDS ?? "meta-llama/llama-3.3-70b-instruct:free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: FLASHCARDS_SYSTEM_PROMPT,
      userPrompt: buildFlashcardsUserPrompt(material.text.slice(0, MAX_PROMPT_CHARS)),
    });
    const parsed = await flashcardsResponseSchema.parseAsync(raw);

    await db.flashcard.deleteMany({ where: { materialId: id } });
    await db.flashcard.createMany({
      data: parsed.flashcards.map((card) => ({
        ...assertSingleParent({ materialId: id }),
        prompt: card.prompt,
        idealExplanation: card.idealExplanation,
        sourceTerm: card.sourceTerm,
      })),
    });

    return NextResponse.json({ count: parsed.flashcards.length });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Flashcard generation failed";
    return jsonError(message, 502);
  }
}
```

Note what is deliberately absent: no `page.status` transitions. A material has no pipeline status, and inventing one would mean a new column for a spinner a button already provides.

- [ ] **Step 2: Write the quiz route**

Create `src/app/api/materials/[id]/generate-quiz/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { QUIZ_SYSTEM_PROMPT, buildQuizUserPrompt } from "@/lib/prompts/quiz";
import { quizResponseSchema } from "@/lib/validation";
import { assertSingleParent } from "@/lib/cards";

const MAX_PROMPT_CHARS = 24_000;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const material = await db.material.findUnique({
    where: { id },
    select: { id: true, text: true },
  });
  if (!material) return jsonError("Material not found", 404);
  if (!material.text.trim()) return jsonError("This material has no text to generate from", 422);

  const model = process.env.OPENROUTER_MODEL_QUIZ ?? "meta-llama/llama-3.3-70b-instruct:free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: QUIZ_SYSTEM_PROMPT,
      userPrompt: buildQuizUserPrompt(material.text.slice(0, MAX_PROMPT_CHARS)),
    });
    const parsed = await quizResponseSchema.parseAsync(raw);

    await db.quizQuestion.deleteMany({ where: { materialId: id } });
    await db.quizQuestion.createMany({
      data: parsed.questions.map((q) => ({
        ...assertSingleParent({ materialId: id }),
        type: q.type,
        prompt: q.prompt,
        correctAnswer: q.correctAnswer,
        options: q.type === "MULTIPLE_CHOICE" ? JSON.stringify(q.options) : null,
        explanation: q.explanation,
      })),
    });

    return NextResponse.json({ count: parsed.questions.length });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Quiz generation failed";
    return jsonError(message, 502);
  }
}
```

- [ ] **Step 3: Select the card counts on the course page**

In `src/app/folders/[folderId]/page.tsx`, extend the material `select` to include:

```ts
_count: { select: { flashcards: true, quizQuestions: true } },
```

and map the rows before handing them to `MaterialList`:

```tsx
<MaterialList
  materials={materials.map((m) => ({
    id: m.id,
    kind: m.kind,
    title: m.title,
    sourceFileName: m.sourceFileName,
    slideCount: m.slideCount,
    createdAt: m.createdAt,
    flashcardCount: m._count.flashcards,
    quizCount: m._count.quizQuestions,
  }))}
/>
```

- [ ] **Step 4: Add the generate buttons to each material row**

In `src/components/dashboard/MaterialList.tsx`, extend the exported type:

```ts
export type MaterialSummary = {
  id: string;
  kind: string;
  title: string;
  sourceFileName: string | null;
  slideCount: number | null;
  createdAt: Date;
  flashcardCount: number;
  quizCount: number;
};
```

Add generation state and handler inside the component, next to the existing `deleting` state:

```tsx
const [generating, setGenerating] = useState<string | null>(null);

async function generate(id: string, kind: "flashcards" | "quiz") {
  setGenerating(`${id}:${kind}`);
  setError(null);
  try {
    const res = await fetch(`/api/materials/${id}/generate-${kind}`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Could not generate ${kind} from that material.`);
      return;
    }
    router.refresh();
  } catch {
    setError("Network error talking to the local server.");
  } finally {
    setGenerating(null);
  }
}
```

Add the buttons in each `<li>`, before the existing delete button, and show the counts in the metadata line:

```tsx
<button
  onClick={() => generate(material.id, "flashcards")}
  disabled={generating !== null}
  className="rounded-md px-2 py-1 text-[12.5px] font-medium text-zinc-500 transition-colors hover:bg-brand-soft/50 hover:text-brand disabled:opacity-50"
>
  {generating === `${material.id}:flashcards`
    ? "Generating…"
    : material.flashcardCount > 0
      ? `${material.flashcardCount} cards`
      : "Flashcards"}
</button>
<button
  onClick={() => generate(material.id, "quiz")}
  disabled={generating !== null}
  className="rounded-md px-2 py-1 text-[12.5px] font-medium text-zinc-500 transition-colors hover:bg-brand-soft/50 hover:text-brand disabled:opacity-50"
>
  {generating === `${material.id}:quiz`
    ? "Generating…"
    : material.quizCount > 0
      ? `${material.quizCount} questions`
      : "Quiz"}
</button>
```

A material with cards already shows the count; clicking again regenerates, matching how a lecture's generate buttons already behave.

- [ ] **Step 5: Verify in the browser**

```bash
npm run dev
```

On a course with a slide deck uploaded:
1. Materials tab shows "Flashcards" and "Quiz" on each row.
2. Clicking Flashcards shows "Generating…", then the row shows a card count.
3. Clicking Quiz produces a question count, and the course header's "Exam cram" button appears (or its count grows) because `courseScopeFilter` now counts material questions.
4. `/folders/<id>/cram` includes questions written from the slide deck.
5. `/review` shows a material card with the material's title as its source, unlinked.

- [ ] **Step 6: Full check**

```bash
npm test
npx tsc --noEmit
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/materials src/components/dashboard/MaterialList.tsx "src/app/folders/[folderId]/page.tsx"
git commit -m "feat: generate flashcards and a quiz from a course material

Each material row gets its own generate buttons, so you choose what is worth
carding — a slide deck yes, a 200-page reading maybe not. Prompt input is
capped so a long reading fails as a clear message rather than an opaque
provider context error.

The routes reuse the existing prompts and Zod schemas verbatim; the only new
thing is a material parent instead of a lecture."
```

---

### Task 5: Course ask

**Files:**
- Create: `src/lib/citations.ts`
- Create: `src/lib/citations.test.ts`
- Create: `src/app/api/folders/[id]/ask/route.ts`
- Create: `src/components/ask/CourseChat.tsx`
- Modify: `src/app/folders/[folderId]/page.tsx` (add the Ask tab)
- Modify: `src/lib/llm.ts` (add `reasoningModel()`)
- Modify: `.env.example` (REASONING tier)
- Test: `src/lib/citations.test.ts`

**Interfaces:**
- Consumes: `searchCourse`, `type CourseHit` from Task 1; `searchPages` from `src/lib/fts.ts`; `callLLMText`, `type ChatMessage` from `src/lib/llm.ts`; `chatRequestSchema` from `src/lib/validation.ts`.
- Produces:
  - `slideNumberFromChunk(text: string): number | null`
  - `type Citation = { label: string; pageId: string | null; materialId: string | null }`
  - `formatCitation(hit: { title: string; text: string; pageId: string | null; materialId: string | null }): Citation`
  - `reasoningModel(): string`
  - `POST /api/folders/[id]/ask` → `{ reply: string; citations: Citation[]; retrieval: "semantic" | "fts" }`

- [ ] **Step 1: Write the failing citation tests**

Create `src/lib/citations.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCitation, slideNumberFromChunk } from "./citations.ts";

test("slideNumberFromChunk reads the slide prefix the pptx extractor writes", () => {
  assert.equal(slideNumberFromChunk("Slide 8: Calvin cycle\nThe dark reactions…"), 8);
});

test("slideNumberFromChunk finds the first slide in a chunk spanning several", () => {
  assert.equal(slideNumberFromChunk("Slide 11: intro\nSlide 12: detail"), 11);
});

test("slideNumberFromChunk returns null for text with no slide prefix", () => {
  assert.equal(slideNumberFromChunk("The mitochondrion is the site of…"), null);
});

test("slideNumberFromChunk ignores the word slide used in prose", () => {
  assert.equal(slideNumberFromChunk("as shown on the slide before this one"), null);
});

test("formatCitation labels a lecture chunk with just the lecture title", () => {
  const out = formatCitation({
    title: "Photosynthesis",
    text: "Light reactions happen in the thylakoid…",
    pageId: "p1",
    materialId: null,
  });
  assert.deepEqual(out, { label: "Photosynthesis", pageId: "p1", materialId: null });
});

test("formatCitation appends the slide number for a slide-deck chunk", () => {
  const out = formatCitation({
    title: "Week 2 slides",
    text: "Slide 8: Calvin cycle",
    pageId: null,
    materialId: "m1",
  });
  assert.deepEqual(out, { label: "Week 2 slides · Slide 8", pageId: null, materialId: "m1" });
});

test("formatCitation leaves a non-slide material with just its title", () => {
  const out = formatCitation({
    title: "Course syllabus",
    text: "Week 3 covers enzyme kinetics.",
    pageId: null,
    materialId: "m2",
  });
  assert.deepEqual(out, { label: "Course syllabus", pageId: null, materialId: "m2" });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module './citations.ts'`

- [ ] **Step 3: Write `src/lib/citations.ts`**

```ts
/**
 * Turns a retrieved chunk into the citation shown under an answer.
 *
 * A slide-deck chunk can cite a slide number because the pptx extractor emits
 * `Slide N: …` blocks. A transcript chunk deliberately does NOT cite a
 * timestamp: mapping a chunk's character offset back to a transcript segment is
 * real machinery for a deep link, and the lecture title is enough to trust the
 * answer. Deferred, not forgotten.
 */

export function slideNumberFromChunk(text: string): number | null {
  // Anchored to a line start so "on the slide before" in prose never matches.
  const match = /^Slide (\d+)\s*:/m.exec(text);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

export type Citation = { label: string; pageId: string | null; materialId: string | null };

export function formatCitation(hit: {
  title: string;
  text: string;
  pageId: string | null;
  materialId: string | null;
}): Citation {
  const slide = slideNumberFromChunk(hit.text);
  return {
    label: slide === null ? hit.title : `${hit.title} · Slide ${slide}`,
    pageId: hit.pageId,
    materialId: hit.materialId,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Add the REASONING tier to `src/lib/llm.ts`**

Append to `src/lib/llm.ts`. It goes here, not in the route: an App Router
`route.ts` may only export route handlers and a few config constants, so an
extra export there is a build error waiting to happen.

```ts
/**
 * The REASONING tier: course-scoped work that stuffs several retrieved chunks
 * into one prompt, which is the one place context length and reasoning quality
 * matter. Provider dispatch is the existing LLM_PROVIDER branch in
 * callLLMText, so this only names the OpenRouter model; on ollama the model
 * name is ignored and `ollamaModel()` wins.
 */
export function reasoningModel(): string {
  return (
    process.env.OPENROUTER_MODEL_REASONING ??
    process.env.OPENROUTER_MODEL_CHAT ??
    process.env.OPENROUTER_MODEL_SUMMARY ??
    "openrouter/free"
  );
}
```

- [ ] **Step 6: Write the course ask route**

Create `src/app/api/folders/[id]/ask/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMText, type ChatMessage } from "@/lib/llm";
import { chatRequestSchema } from "@/lib/validation";
import { searchCourse } from "@/lib/embeddings";
import { searchPages } from "@/lib/fts";
import { formatCitation, type Citation } from "@/lib/citations";
import { reasoningModel } from "@/lib/llm";

const K = 8;
const PER_CHUNK_CHARS = 1_400;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folder = await db.folder.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!folder) return jsonError("Course not found", 404);

  const body = await req.json().catch(() => null);
  const result = await withValidation(chatRequestSchema, body);
  if ("error" in result) return result.error;

  const messages = result.data.messages;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return jsonError("No question to answer", 422);

  let retrieval: "semantic" | "fts" = "semantic";
  let blocks: string[] = [];
  let citations: Citation[] = [];

  try {
    const hits = await searchCourse(id, lastUser.content, K);
    blocks = hits.map((h) => `### ${h.title}\n${h.text.slice(0, PER_CHUNK_CHARS)}`);
    citations = hits.map(formatCitation);
  } catch (e) {
    // Every rung of the embedding chain failed. Fall back to full-text search
    // scoped to this course: retrieval quality drops, the feature does not break.
    console.error(`[ask] semantic retrieval failed for course ${id}, falling back to FTS:`, e);
    retrieval = "fts";
    const ftsHits = await searchPages(lastUser.content, K);
    const pages = ftsHits.length
      ? await db.page.findMany({
          where: { id: { in: ftsHits.map((h) => h.pageId) }, folderId: id },
          include: { notes: true, transcript: true },
        })
      : [];
    for (const page of pages) {
      const text = page.notes?.markdown ?? page.transcript?.rawText ?? "";
      if (!text.trim()) continue;
      blocks.push(`### ${page.title}\n${text.slice(0, PER_CHUNK_CHARS * 2)}`);
      citations.push({ label: page.title, pageId: page.id, materialId: null });
    }
  }

  // De-duplicate citations: several chunks from one lecture cite it once.
  const seen = new Set<string>();
  citations = citations.filter((c) => {
    const key = c.label;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const context = blocks.length
    ? blocks.join("\n\n---\n\n")
    : `(Nothing in ${folder.name} matched this question.)`;

  const systemPrompt = `You are a study assistant for the course "${folder.name}". Answer using only the course excerpts below. When you use a fact, name the lecture or material it came from. Be concise and concrete. If the course material does not cover the question, say so plainly — you may then add general knowledge, clearly labeled as outside this course.\n\nCOURSE EXCERPTS:\n${context}`;

  const chatMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...messages];

  try {
    const reply = await callLLMText({ model: reasoningModel(), messages: chatMessages });
    return NextResponse.json({ reply, citations, retrieval });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ask failed";
    return jsonError(message, 502);
  }
}
```

- [ ] **Step 7: Document the REASONING tier**

Append to `.env.example`:

```
# Reasoning tier: course-scoped work that needs a longer prompt and better
# reasoning (course ask today; syllabus parsing and coverage matching later).
# Dispatched by LLM_PROVIDER like every other call. Free on both paths.
OPENROUTER_MODEL_REASONING="openrouter/free"
OLLAMA_MODEL_REASONING="qwen3:8b"
```

Note `OLLAMA_MODEL_REASONING` is documented but not yet read: `callLLMText` routes ollama calls through `ollamaModel()` today, and adding a per-stage ollama override is only worth it once you actually want a different local model for ask than for everything else.

- [ ] **Step 8: Write the course chat component**

Create `src/components/ask/CourseChat.tsx`. It is `LibraryChat` narrowed to one course: citations may point at a material (no page to link), and the suggestions are course-shaped.

```tsx
"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { BrainCircuit, FileText, Loader2, Presentation, Send } from "lucide-react";
import clsx from "@/lib/clsx";

type Citation = { label: string; pageId: string | null; materialId: string | null };
type Message = { role: "user" | "assistant"; content: string; citations?: Citation[] };

const SUGGESTIONS = [
  "What are the main themes of this course so far?",
  "What does the syllabus say I still haven't covered?",
  "Explain the hardest concept in these lectures simply",
  "Make me a study plan for this course",
];

export function CourseChat({ folderId }: { folderId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setError(null);
    const nextMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 30);

    try {
      const res = await fetch(`/api/folders/${folderId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(-12).map(({ role, content }) => ({ role, content })),
        }),
      });
      if (res.ok) {
        const { reply, citations, retrieval } = await res.json();
        setDegraded(retrieval === "fts");
        setMessages((m) => [...m, { role: "assistant", content: reply, citations }]);
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      } else {
        const b = await res.json().catch(() => ({}));
        setError(b.error ?? "The assistant couldn't reply. Try again.");
      }
    } catch {
      setError("Network error talking to the local server.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-[13px] text-zinc-500">
        Answers come from this course&apos;s lectures and materials, with the source cited.
      </p>

      {degraded && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800">
          Semantic search is unavailable, so this answer used keyword search instead. Run{" "}
          <code className="font-mono">npm run reindex</code> to rebuild the index.
        </p>
      )}

      <div className="flex min-h-[22rem] flex-col gap-3 rounded-2xl border border-zinc-200/80 bg-white p-4">
        {messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
              <BrainCircuit className="h-5 w-5" strokeWidth={2} />
            </span>
            <p className="text-[13px] text-zinc-400">Ask anything about this course.</p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600 transition-colors hover:border-brand-border hover:bg-brand-soft/50 hover:text-brand"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={clsx("flex flex-col gap-1.5", m.role === "user" ? "items-end" : "items-start")}
          >
            <div
              className={clsx(
                "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13.5px] leading-6",
                m.role === "user"
                  ? "rounded-br-md bg-zinc-900 text-white"
                  : "rounded-bl-md bg-zinc-100 text-zinc-800"
              )}
            >
              {m.content}
            </div>
            {m.citations && m.citations.length > 0 && (
              <div className="flex max-w-[85%] flex-wrap gap-1.5">
                {m.citations.map((c) =>
                  c.pageId ? (
                    <Link
                      key={c.label}
                      href={`/pages/${c.pageId}`}
                      className="flex items-center gap-1 rounded-full border border-brand-border bg-brand-soft/40 px-2.5 py-1 text-[11.5px] font-medium text-brand transition-colors hover:bg-brand-soft"
                    >
                      <FileText className="h-3 w-3" strokeWidth={2.2} />
                      {c.label}
                    </Link>
                  ) : (
                    <span
                      key={c.label}
                      className="flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11.5px] font-medium text-zinc-600"
                    >
                      <Presentation className="h-3 w-3" strokeWidth={2.2} />
                      {c.label}
                    </span>
                  )
                )}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-md bg-zinc-100 px-3.5 py-2 text-[13px] text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> Searching this
            course…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this course…"
          className="w-full rounded-xl border border-zinc-300 bg-white px-3.5 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl grad-brand text-white shadow-brand transition-opacity hover:opacity-95 disabled:opacity-50"
          aria-label="Send"
        >
          <Send className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 9: Add the Ask tab to the course page**

In `src/app/folders/[folderId]/page.tsx`, import the component and append a third tab entry after `materials`:

```tsx
{
  id: "ask",
  label: "Ask",
  content: <CourseChat folderId={folder.id} />,
},
```

with `import { CourseChat } from "@/components/ask/CourseChat";`.

- [ ] **Step 10: Verify in the browser**

```bash
npm run dev
```

On a course with at least one lecture and one slide deck uploaded, and after `npm run reindex`:
1. The course page shows an Ask tab.
2. Asking a question about something covered in a slide returns an answer citing `<deck title> · Slide N`.
3. Asking about something from a lecture returns a citation that links to that lecture.
4. Asking something the course does not cover gets a plain "this course does not cover it".
5. Set `EMBED_PROVIDER=openrouter` with no `OPENROUTER_API_KEY` and ask again: the amber degraded banner appears and an answer still comes back from keyword search. Set it back to `local`.

- [ ] **Step 11: Full check**

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

- [ ] **Step 12: Commit**

```bash
git add src/lib/citations.ts src/lib/citations.test.ts "src/app/api/folders/[id]/ask" src/components/ask/CourseChat.tsx "src/app/folders/[folderId]/page.tsx" .env.example
git commit -m "feat: ask a question at course scope with cited sources

A fourth tab on the course page answers from that course's lectures and
materials via semantic retrieval, falling back to course-scoped full-text
search with a visible banner when embedding is unavailable.

Citations name the source and, for a slide deck, the slide. Mapping a
transcript chunk back to a timestamp is deferred: it is real machinery for a
deep link, and the lecture title is enough to trust an answer."
```

---

### Task 6: Course review

Cram and the course quiz count already include materials as of Task 3. What is missing is a course-scoped review session — `/review` is global today, and `/api/review/due` already accepts the `folderId` this task starts sending.

**Files:**
- Create: `src/app/folders/[folderId]/review/page.tsx`
- Modify: `src/components/review/ReviewSession.tsx` (accept an optional `folderId`)
- Modify: `src/app/folders/[folderId]/page.tsx` (Review button beside Exam cram)

**Interfaces:**
- Consumes: `courseScopeFilter` from Task 3; the `folderId` query parameter on `/api/review/due`.
- Produces: `ReviewSession` accepts `{ folderId?: string }`. Route `/folders/[folderId]/review`.

- [ ] **Step 1: Let `ReviewSession` scope itself to a course**

In `src/components/review/ReviewSession.tsx`, change the signature and the fetch:

```tsx
export function ReviewSession({ folderId }: { folderId?: string }) {
```

and inside the `useEffect`:

```tsx
const url = folderId ? `/api/review/due?folderId=${encodeURIComponent(folderId)}` : "/api/review/due";
fetch(url)
```

Add `folderId` to the effect's dependency array so navigating between courses refetches:

```tsx
}, [folderId]);
```

- [ ] **Step 2: Create the course review page**

Create `src/app/folders/[folderId]/review/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCheck } from "lucide-react";
import { db } from "@/lib/db";
import { courseScopeFilter } from "@/lib/cards";
import { ReviewSession } from "@/components/review/ReviewSession";

export const dynamic = "force-dynamic";

export default async function CourseReviewPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  const folder = await db.folder.findUnique({ where: { id: folderId } });
  if (!folder) notFound();

  const dueCount = await db.flashcard.count({
    where: { nextReviewAt: { lte: new Date() }, ...courseScopeFilter(folderId) },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <Link
        href={`/folders/${folder.id}`}
        className="flex items-center gap-1 self-start text-[13px] font-medium text-zinc-400 hover:text-brand"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
        {folder.name}
      </Link>

      <div className="flex items-center gap-3 rounded-2xl border border-brand-border grad-brand-soft p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl grad-brand text-white shadow-brand">
          <CheckCheck className="h-5 w-5" strokeWidth={2} />
        </span>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-zinc-900">
            Review · {folder.name}
          </h1>
          <p className="text-[13px] text-zinc-500">
            {dueCount} card{dueCount === 1 ? "" : "s"} due from this course&apos;s lectures and
            materials.
          </p>
        </div>
      </div>

      <ReviewSession folderId={folder.id} />
    </div>
  );
}
```

- [ ] **Step 3: Add the Review button to the course header**

In `src/app/folders/[folderId]/page.tsx`, select the due count alongside the existing queries:

```ts
db.flashcard.count({
  where: { nextReviewAt: { lte: new Date() }, ...courseScopeFilter(folderId) },
}),
```

and add the link before the Exam cram link, so a due count is the first thing offered:

```tsx
{dueCount > 0 && (
  <Link
    href={`/folders/${folder.id}/review`}
    className="inline-flex items-center gap-1.5 rounded-lg border border-brand-border bg-brand-soft/40 px-3 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand-soft"
  >
    <CheckCheck className="h-4 w-4" strokeWidth={2} />
    Review {dueCount}
  </Link>
)}
```

with `CheckCheck` added to the existing `lucide-react` import.

- [ ] **Step 4: Verify in the browser**

```bash
npm run dev
```

1. A course with due cards shows "Review N" in its header.
2. `/folders/<id>/review` grades cards and the count drops as you grade.
3. A material-derived card appears in that session with the material's title as its source.
4. The global `/review` still works and still shows cards from every course.

- [ ] **Step 5: Full check**

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add "src/app/folders/[folderId]/review" src/components/review/ReviewSession.tsx "src/app/folders/[folderId]/page.tsx"
git commit -m "feat: review one course's due cards

ReviewSession takes an optional folderId and the course page links to it with
a live due count. The API already scoped by course as of the nullable-parent
change, so this is the surface that uses it — including cards written from
that course's materials."
```

---

## Phase Done-When Check

Run this once every task is committed, to confirm the spec's §13 Phase 2 exit criteria:

- [ ] Upload a slide deck to a course that already has a lecture, then `npm run reindex`.
- [ ] In the course's Ask tab, ask a question the slides and a lecture both bear on. The answer cites both a lecture and `<deck> · Slide N`. **This is the first half of "done when".**
- [ ] Generate flashcards from the course's syllabus material, then open `/folders/<id>/review`. A syllabus-derived card appears in the session. **This is the second half.**
- [ ] Delete the material and confirm its cards and chunks go with it (cascade), and that review and cram still run.
