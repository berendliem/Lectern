# Lectern — Retrieval Floor Design

Date: 2026-09-11
Status: Approved design, ready for implementation planning

## 1. Context

Lectern has two retrievers and three places that assemble context for an LLM, and
only one of those three actually retrieves anything.

`searchCourse` (`src/lib/embeddings.ts:221`) is the real one: it embeds the
question, loads every chunk in the course, scores cosine similarity in JS, and
returns the top 8. `searchPages` (`src/lib/fts.ts:36`) is the SQLite FTS5 half,
ranked by bm25. Course ask (`src/app/api/folders/[id]/ask/route.ts`) uses the
first and degrades to the second, which is the behavior the rest of the app
should have had.

The other two paths never learned any of this.

**Lecture chat sends the whole lecture on every message.** `src/app/api/pages/[id]/chat/route.ts:24-30`
concatenates the notes and the raw transcript, slices at 24,000 characters, and
puts the result in the system prompt. The question is not consulted. A student
asking "what was the definition of a martingale" ships roughly 6,000 tokens of
unrelated lecture to get back two sentences, and a transcript longer than 24k
characters has its tail silently cut — the answer to a question about the last
twenty minutes of a two-hour lecture is not in the prompt at all, and nothing
says so.

**Global ask retrieves lectures, then sends them whole.** `src/app/api/ask/route.ts`
does use FTS to pick six pages, but then packs up to 4,500 characters of each
into a 22,000-character budget. The retrieval identifies the right lecture and
then defeats itself by shipping all of it.

The cost lands hardest exactly where this app is meant to run. `LLM_PROVIDER=ollama`
with an 8B model at an 8k context window cannot fit a 6,000-token system prompt
plus history plus an answer. The `openrouter/free` default has the same ceiling
on many of its models. The pipeline stages were written with this in mind —
summarize map-reduces at 28,000 characters (`summarize/route.ts:41`) — but the
two conversational paths were not.

Underneath both sits a quality problem that affects course ask too: cosine
similarity over 1,200-character chunks is a coarse ranker. The top 8 routinely
includes near-duplicates and passages that share vocabulary with the question
without answering it, and all 8 go into the prompt at full length.

## 2. Goals

- One retrieval entry point, used by every path that puts course material in a
  prompt.
- Question-scoped context for lecture chat and global ask: roughly 1,300 tokens
  where there are now 5,500–6,000.
- Better ranking than raw cosine, at zero API cost and no LLM call on the query
  path.
- Evidence, kept over a semester, about whether flat retrieval is failing in the
  way that would justify a concept graph.
- No new npm dependency.

## 3. Non-goals

- **Re-indexing, or any change to how chunks are written.** `indexSource`
  (`src/lib/embeddings.ts:107`) already does the minimum work via content hashes
  and stays LLM-free. This design only reads.
- **Replacing brute-force cosine with a vector index.** The `ponytail:` note at
  `embeddings.ts:217` stands: sqlite-vec when a course passes ~50k chunks. A
  course is ~3k chunks today.
- **Touching the generation stages.** Summarize, flashcards, quiz, syllabus and
  action items keep their character caps. They are batch jobs over a known
  document, not retrieval.
- **A concept graph, or traversal of any kind.** Separate design, same date.
- **Streaming or interactive citation UI.** `formatCitation` already produces
  what the three routes render.

## 4. Mechanism — `src/lib/retrieval.ts`

A new file rather than more of `embeddings.ts`, which is already 326 lines
covering indexing, search and topic scoring. The split follows the existing
`embed-math.ts` precedent: pure logic separate from anything that opens SQLite
or loads a model.

```ts
export type Scope =
  | { kind: "page"; pageId: string }
  | { kind: "course"; folderId: string }
  | { kind: "all" };

export type RetrievalMode = "semantic" | "fts" | "unindexed";

export async function retrieve(opts: {
  scope: Scope;
  query: string;
}): Promise<{ hits: CourseHit[]; mode: RetrievalMode }>;
```

`CourseHit` is the shape `searchCourse` already returns, so `formatCitation`
(`src/lib/citations.ts:24`) consumes the result unchanged.

`mode` carries the same three-state signal course ask already distinguishes at
`folders/[id]/ask/route.ts:60-78`, and for the same reason: "this scope has no
chunks for the active embedder" is a different fact from "embedding failed", and
callers degrade differently. Every scope keeps the `model` filter from
`courseChunkFilter` — vectors from two embedders are not comparable, and
dropping that filter is the easiest way to make retrieval quietly wrong.

### 4.1 Candidate generation

**`page`** — chunks with that `pageId` and the active model. The `Chunk.pageId`
index exists (`prisma/schema.prisma:347`). A two-hour lecture is ~92 transcript
chunks plus a handful of notes chunks; take all of them.

**`course`** — `courseChunkFilter(folderId, model)`, unchanged from today.

**`all`** — `searchPages(query, 15)` narrows to fifteen lectures by bm25, then
their chunks are loaded. Without the prefilter, a global question loads every
chunk in the database: at six courses that is ~17k chunks and ~26MB of vectors
read per question, nearly all of it discarded.

The prefilter has a hole that must be handled rather than accepted. `page_search`
is populated only from pages — title, transcript, notes, flashcards
(`src/lib/fts.ts:18-22`). Materials are not in it. An FTS prefilter alone would
make every PDF and slide deck in the library permanently invisible to global
ask, which is worse than the cost it saves.

So `all` candidates are the FTS-hit pages' chunks **plus** every `MATERIAL`
chunk in those pages' folders. Materials are the smaller population — roughly
5k chunks across six courses against ~17k transcript chunks — so this stays
bounded while keeping materials reachable.

```ts
// ponytail: materials bypass the FTS prefilter and are loaded whole for the
// folders in play. Add a material_search FTS table if material volume ever
// approaches transcript volume.
```

### 4.2 Ranking

Cosine over the candidate set, as today, then a cross-encoder rerank of the top
`RERANK_CANDIDATES = 40`.

A bi-encoder scores the question and a chunk independently and compares two
vectors, which is why it retrieves well and orders badly. A cross-encoder reads
the pair together and scores relevance directly. It is too slow to run over a
corpus and exactly right over 40 candidates.

### 4.3 `src/lib/rerank.ts`

`Xenova/ms-marco-MiniLM-L-6-v2` at `dtype: "q8"` through
`@huggingface/transformers`, which is already a dependency and already loads a
q8 model this way (`embeddings.ts:47-66`). ~23MB, downloaded once, cached with
the embedder.

Two behaviors copied deliberately from `localEmbed`:

- The pipeline promise is built once per process and **not** memoized on
  rejection. A network hiccup during the first download must not poison every
  subsequent query for the life of the process.
- Failure is not fatal. If the model cannot load or scoring throws, log once and
  return the candidates in cosine order. Reranking is a quality improvement; a
  question must never fail because it was unavailable. This mirrors
  `indexSourceSafely`'s posture (`embeddings.ts:190`).

### 4.4 Budget

```ts
const MAX_HITS = 4;
const CONTEXT_CHARS = 5_000;
```

`packContext(hits, budget)` walks hits in rank order and accumulates until
adding the next would exceed the budget, returning the blocks and the hits that
survived — so the citation list always matches what the model actually saw. Pure,
in `retrieval-math.ts`, tested.

Five thousand characters is roughly 1,250 tokens, which leaves an 8k-window model
room for the system prompt, several turns of history, and an answer. Both
constants are single values in one file; tuning them is a one-line change.

### 4.5 Route rewiring

**`folders/[id]/ask`** — swaps `searchCourse` for `retrieve({ kind: "course" })`.
Its `ftsFallback` helper moves into `retrieval.ts` as the `fts` mode so all three
routes share one degradation path. User-visible behavior is unchanged except that
answers get better and shorter.

**`pages/[id]/chat`** — replaces the 24,000-character concatenation with
`retrieve({ kind: "page", pageId })`. When `mode === "unindexed"` — a lecture
predating Phase 2, or one whose embedder changed and has not been through
`npm run reindex` — it falls back to exactly today's slice, so no existing
lecture stops working. Gains citations, which it has never had.

**`api/ask`** — replaces the six-page 22,000-character loop with
`retrieve({ kind: "all" })`. Keeps its existing FTS path as the `fts` mode.

## 5. Mechanism — `RetrievalLog`

The question this table exists to answer: are there real questions whose answer
is spread across lectures such that no single chunk can carry it? That is the one
retrieval failure a concept graph fixes and a better ranker does not, and it is
not answerable from memory or from a log that dies on restart.

```prisma
model RetrievalLog {
  id        String   @id @default(cuid())
  query     String
  scope     String   // "page" | "course" | "all"
  mode      String   // "semantic" | "fts" | "unindexed"
  hitCount  Int
  spread    Int      // distinct lectures/materials among the surviving hits
  topScore  Float
  sourceIds String   // JSON array of the page/material ids that were sent
  createdAt DateTime @default(now())

  @@index([createdAt])
}
```

**No relations, by design.** `AGENTS.md` requires that deleting a lecture never
erase the evidence of study that referenced it, and solves that for `ReviewLog`
with `SetNull` on every relation. This table reaches the same end more simply:
source ids are stored as JSON text, so there is no foreign key to cascade, no
null to handle, and deleting a course cannot corrupt or truncate the log.

Writes are best-effort and wrapped, in the `indexSourceSafely` idiom — a failed
log write must never fail a question.

Retention: the newest 5,000 rows are kept. Pruning runs on write when
`Math.random() < 0.02`, which is a few deletes a week at study volumes and avoids
a scheduled job the app has no runner for.

`npm run db:migrate` takes a snapshot before applying, per `AGENTS.md`.

## 6. Error handling

| Failure | Behavior |
| --- | --- |
| Embedding the query throws | `mode: "fts"`, FTS blocks, answer proceeds |
| Scope has no chunks for the active model | `mode: "unindexed"`; page chat falls back to its raw slice, others to FTS |
| Rerank model unavailable | Cosine order, logged once, answer proceeds |
| FTS prefilter returns nothing on `all` | Empty hits; existing "nothing matched" prompt |
| `RetrievalLog` write fails | Caught and logged; answer already returned |

No failure in this design is allowed to fail a user's question. Every path
degrades to something that still answers, and `mode` tells the caller which one
it got.

## 7. Testing

Pure logic in `retrieval-math.ts`, covered by `node --test` alongside the
existing `embed-math.test.ts`:

- `packContext` respects the budget, preserves rank order, and returns exactly
  the hits it packed — the property that keeps citations honest.
- `packContext` with a single oversized hit still returns one block rather than
  an empty context.
- `spread` counts distinct sources, not chunks — four chunks from one lecture is
  a spread of 1.
- `scopeFilter(scope, ftsPageIds, folderIds, model)` builds the right where-clause
  shape for each of the three scopes, always carrying the `model` filter — the
  one omission that would make retrieval silently wrong. Pure: it returns a
  clause, it does not run one.
- The `all` clause includes `MATERIAL` chunks for a folder whose page matched and
  excludes folders that did not match.

The model-loading and SQLite paths are verified by hand: ask the same question on
each of the three scopes, confirm the mode, the citation list, and the prompt
size.

## 8. Deferred

- **Material FTS.** §4.1's ceiling. Add `material_search` when materials grow
  comparable to transcripts.
- **sqlite-vec.** At ~50k chunks per course, per `embeddings.ts:217`.
- **Tuning `MAX_HITS` / `CONTEXT_CHARS` per provider.** One knob that reads the
  configured model's window is plausible later; two constants are enough now.
- **Hybrid scoring.** Candidates come from bm25 or cosine; the two scores are
  never combined into one ranking. The cross-encoder makes that largely moot.
