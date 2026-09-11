# Lectern — Persistent Concept Graph Design

Date: 2026-09-11
Status: Approved design, ready for implementation planning

## 1. Context

Lectern already extracts a concept graph from every lecture, and already throws
it away.

`src/app/api/pages/[id]/concept-map/route.ts` sends a lecture's notes to the
model with `CONCEPT_MAP_SYSTEM_PROMPT`, which asks for 8–16 concepts and the
**labeled** relationships between them — "causes", "part of", "enables",
"contrasts with" — plus a cluster group per node. It validates the JSON, drops
edges pointing at unknown nodes, and returns the result to the browser. Nothing
is written to the database. `grep ConceptMap prisma/schema.prisma` returns
nothing.

`src/components/page-detail/ConceptMapTab.tsx` renders that graph in 234 lines of
hand-rolled SVG — deterministic elliptical layout, the app's palette tokens per
group, hover highlighting, no dependency.

So the two expensive halves of a concept-graph memory system are built. What is
missing is that they are per-lecture and momentary. Every tab open is a fresh
paid LLM call producing a graph that lives until the component unmounts. Week 3's
"Bayes' theorem" and week 9's "Bayes' theorem" are two unrelated strings in two
throwaway responses. There is no object in the system that represents a concept
the course returns to, and no way to ask what a course says about one.

Two smaller faults come with it:

**Long lectures are silently half-mapped.** `buildConceptMapUserPrompt`
(`src/lib/prompts/concept-map.ts:21`) ends with `material.slice(0, 8000)`. A
lecture whose notes run longer has its tail dropped, with no indication in the
UI that the map covers the first two-thirds of the lecture. The map looks
complete because a concept map always looks complete.

**The work is unbounded and repeated.** Nothing caches, so the cost of looking at
a map ten times is ten extractions.

This design persists the graph and resolves concepts across lectures and courses.
It deliberately stops there: nothing here changes what any question retrieves.
Query-time traversal and the cross-course visualizer are the next project, and
they depend on this one plus the retrieval floor
(`2026-09-11-retrieval-floor-design.md`).

## 2. Goals

- A concept that appears in six lectures is one row, with six mentions.
- Relationships are stored with the lecture that asserted them, and strengthen
  when asserted again.
- Extraction is one-off: re-running over unchanged notes costs nothing.
- Backfilling a semester is a terminal command, not a UI flow.
- The concept map tab keeps behaving as it does today, with caching available to
  those who want it.
- No new npm dependency.

## 3. Non-goals

- **Query-time traversal.** No question's answer changes because of this design.
  Retrieval is unchanged; the graph is written and read by the concept map tab
  and nothing else.
- **A cross-course visualizer.** Project 3.
- **LLM-based entity resolution.** Merging is decided by normalization, an
  embedding the app already computes, and pure lexical guards. Asking a model
  "are these the same concept?" once per candidate pair is thousands of calls to
  answer a question a string comparison answers most of the time.
- **A server-side job runner.** The in-flight backgroundable-long-tasks design
  rules one out for this app; the backfill is a CLI script, following
  `scripts/reindex.ts`.
- **Replacing `Chunk`.** The vector index stays the retrieval substrate. The
  graph sits beside it and points into it.
- **Extracting concepts from raw transcripts.** See §6.

## 4. Schema

```prisma
model ConceptNode {
  id        String   @id @default(cuid())
  label     String   // display form, from the extraction that created the node
  slug      String   // normalized key — see §5.1
  vector    Bytes    // Float32 embedding of the label
  model     String   // embedder label, e.g. "local:Xenova/all-MiniLM-L6-v2"
  createdAt DateTime @default(now())

  mentions ConceptMention[]
  outEdges ConceptEdge[] @relation("ConceptEdgeFrom")
  inEdges  ConceptEdge[] @relation("ConceptEdgeTo")

  @@unique([slug, model])
}

model ConceptMention {
  id         String  @id @default(cuid())
  nodeId     String
  pageId     String?
  materialId String?
  chunkId    String?

  node     ConceptNode @relation(fields: [nodeId], references: [id], onDelete: Cascade)
  page     Page?       @relation(fields: [pageId], references: [id], onDelete: Cascade)
  material Material?   @relation(fields: [materialId], references: [id], onDelete: Cascade)

  @@index([nodeId])
  @@index([pageId])
}

model ConceptEdge {
  id     String  @id @default(cuid())
  fromId String
  toId   String
  label  String  // "causes", "part of", "enables", …
  pageId String? // the lecture that asserted this relation
  weight Int     @default(1)

  from ConceptNode @relation("ConceptEdgeFrom", fields: [fromId], references: [id], onDelete: Cascade)
  to   ConceptNode @relation("ConceptEdgeTo",   fields: [toId],   references: [id], onDelete: Cascade)
  page Page?       @relation(fields: [pageId],  references: [id], onDelete: SetNull)

  @@unique([fromId, toId, label])
  @@index([fromId])
}

model ConceptExtraction {
  id          String   @id @default(cuid())
  pageId      String   @unique
  sourceHash  String   // hashChunk() of the notes the extraction read
  model       String   // the LLM label, via llmModelLabel()
  extractedAt DateTime @default(now())

  page Page @relation(fields: [pageId], references: [id], onDelete: Cascade)
}
```

Four deliberate choices.

**`chunkId` is a loose id, not a relation.** `indexSource` deletes and recreates
`Chunk` rows whenever text changes (`embeddings.ts:161-178`), so a foreign key
here would cascade-delete a lecture's mentions every time its notes were edited
and re-indexed — the graph would quietly erode as the user worked. The id is
stored for provenance and read defensively; a mention whose chunk no longer
exists still points at a valid page.

**`@@unique([slug, model])`.** Node identity is scoped to the embedder that
resolved it, for the same reason `Chunk.model` exists: vectors from two embedders
are not comparable and often not even the same dimension. Switching
`EMBED_PROVIDER` makes the old graph invisible rather than silently wrong, and
`npm run graph:build` rebuilds it — the same contract `searchCourse` already has.

**Mentions cascade, edges keep their assertion loosely.** Deleting a lecture
removes its mentions (they are statements about that lecture) but an edge's
`pageId` goes `SetNull`, leaving the relationship standing with its provenance
cleared rather than deleting a relationship two other lectures also assert.
`AGENTS.md`'s rule is about `ReviewLog` specifically, but the reasoning carries:
a delete should not quietly erase more than the thing deleted.

**A node with no mentions is garbage.** The delete path leaves orphans behind;
`npm run graph:build` prunes them, and §9 covers the case.

## 5. Entity resolution

This is the part that decides whether the result is a second brain or a hairball,
so it is a pure module, `src/lib/concept-resolve.ts`, with real tests.

### 5.1 Normalization

`slugify(label)` lowercases, strips punctuation and diacritics, drops leading
articles, collapses whitespace, and trims a trailing possessive. `"Bayes'
Theorem"` and `"the Bayes theorem"` both become `"bayes theorem"`.

An exact slug hit resolves to that node. This alone handles most repetition,
because lecturers and their slides are more consistent than they feel.

### 5.2 Similarity, with guards

Otherwise the label is embedded (`embedTexts`, the same MiniLM already loaded for
chunks — one short string, no new model) and compared by cosine against existing
nodes of the same `model`. A merge requires **all** of:

1. `cosine >= 0.90`
2. identical numeric tokens
3. a lexical tie: the token sets are equal, or one label is an acronym of the
   other

and additionally must **not** be blocked by:

4. strict superset — one label's tokens contain all of the other's plus at least
   one extra content word

Guard 2 is not a refinement, it is the whole reason this is not a one-line
threshold. `"Type I error"` and `"Type II error"` embed at roughly 0.95
similarity and are opposites; merging them corrupts every statistics lecture in
the library. The same holds for `"Phase 1"` / `"Phase 2"`, `"Lemma 3"` /
`"Lemma 4"`, `"World War I"` / `"World War II"`. Numerals — arabic and roman —
are compared as a set, and any difference blocks the merge outright regardless of
cosine.

Guard 4 handles the other direction. `"gradient descent"` and `"stochastic
gradient descent"` sit close in embedding space and are concepts a course
deliberately distinguishes; the extra word is almost always the discriminator,
not noise. So a strict superset blocks the merge even at high cosine.
`"conditional probability"` / `"probability"` and `"partial derivative"` /
`"derivative"` are the same shape.

Guard 3 is what the embedding actually buys, since slug equality is already
handled in §5.1: token sets that are equal but ordered differently — `"Bayes
theorem"` and `"theorem of Bayes"` slugify apart and resolve together. The
acronym clause covers `"SGD"` against `"stochastic gradient descent"` when the
initials line up.

The net effect is a resolver that **under-merges rather than over-merges**, on
purpose. A duplicate node is visible in the graph and can be fixed; a wrong merge
silently fuses two concepts and every mention, edge and future answer inherits
the error. That asymmetry is the same one `AGENTS.md` applies to the user's data.

```ts
// ponytail: threshold plus lexical guards, no LLM. Under-merges synonyms that
// share no tokens ("eigenvalue" / "characteristic root") and anything expressed
// in two languages. Duplicate nodes are visible in the graph; revisit if they
// pile up.
```

No merge, no match: a new node.

### 5.3 Ordering

Resolution is sequential within one extraction, so two new concepts in the same
lecture that resolve to each other collapse correctly instead of racing to create
two rows. The backfill processes one lecture at a time for the same reason.

## 6. Extraction

Extraction stays **decoupled from `indexSource`**. That path is deliberately
LLM-free — local embeddings only — and folding a model call into it would make
every note save depend on a provider being reachable.

Instead `extractConcepts(pageId)` lives in `src/lib/concept-graph.ts` and runs
best-effort where `indexSourceSafely` already runs, after notes are written. It
follows that function's posture exactly (`embeddings.ts:190`): catch, log, never
fail the write the user just made.

**It maps over note chunks rather than truncating.** Notes are split at 8,000
characters — the window the existing prompt was written against — and each
segment gets one extraction call, with the results unioned through §5. Most
lectures are one call; a long one is two. This fixes the silent truncation in
§1 without changing the prompt.

**Notes, not transcripts.** Notes are already model-condensed and free of ASR
errors, so the extraction is both cleaner and roughly fifteen times cheaper: ~1
call per lecture against ~92 transcript chunks. The existing route already
prefers notes; this makes it a rule. A lecture with no notes yet is skipped, not
extracted from its transcript.

`ConceptExtraction.sourceHash` makes the whole thing idempotent: unchanged notes
extract zero times, using `hashChunk` from `embed-math.ts`.

## 7. Backfill

`scripts/build-graph.ts`, wired as `npm run graph:build`, following
`scripts/reindex.ts`.

Walks every page with notes, skips those whose `sourceHash` and LLM model already
match, extracts the rest one at a time, and prunes mention-less nodes at the end.
Interruptible and resumable by construction — progress is the extraction rows
themselves. Prints a per-lecture line and a final count of nodes, edges, and
merges performed.

Roughly 30 LLM calls per course. At study volumes that is minutes, once.

## 8. The concept map tab

**Regeneration stays the default.** Opening the tab extracts, as it does today.
The difference is that the result is now persisted on the way to the screen, so
every view strengthens the graph — new mentions recorded, repeated edges
incrementing `weight`.

Caching is opt-in: a "Use saved map when available" checkbox stored under
`lectern.conceptMap.useSaved`, matching the `lectern.theme` /
`PomodoroTimer` localStorage idiom already in the app, read in a `try/catch`
because these reads can throw. When it is on and a stored map exists, the tab
renders it immediately with its extraction date and a Regenerate button.

Rendering is unchanged — the stored graph is loaded into the same
`{ nodes, edges }` shape `ConceptMapTab` already takes, with `group` recomputed
from edge density at read time since it is a display concern rather than
something worth storing.

## 9. Error handling

| Failure | Behavior |
| --- | --- |
| Extraction LLM call fails | Caught and logged; the note write succeeds; no extraction row, so the next run retries |
| Model returns unparseable JSON | Existing behavior — 502 to the tab, nothing written |
| Edge references an unknown node | Existing behavior — edge dropped, map kept |
| Label embedding fails during resolution | Fall back to exact-slug matching only; the node is created rather than merged |
| `EMBED_PROVIDER` changed | Old nodes are invisible (different `model`); `npm run graph:build` rebuilds |
| Lecture deleted | Mentions cascade, edge provenance nulls, orphan nodes pruned on next build |

## 10. Testing

`concept-resolve.ts` is pure and carries the risk, so it carries the tests
(`node --test`, beside `embed-math.test.ts`):

- `slugify` collapses `"Bayes' Theorem"`, `"the Bayes theorem"`, `"BAYES
  THEOREM"` to one key.
- **`"Type I error"` never merges with `"Type II error"`**, at any cosine.
- `"Phase 1"` never merges with `"Phase 2"`.
- `"gradient descent"` does not absorb `"stochastic gradient descent"` — guard 4,
  at a cosine well above threshold.
- `"probability"` does not absorb `"conditional probability"`.
- `"Bayes theorem"` and `"theorem of Bayes"` do merge — equal token sets,
  different slugs.
- `"SGD"` merges with `"SGD"` by slug without consulting an embedding.
- A cosine above threshold with disjoint tokens does not merge.
- Union of two extractions increments `weight` for a repeated edge instead of
  inserting a duplicate.

The LLM and SQLite paths are checked by hand: run `npm run graph:build` on a
course, confirm a concept taught twice has one node and two mentions, and confirm
a second run reports zero extractions.

## 11. Deferred

- **Traversal, cross-course ask, and the hit visualizer.** Project 3, which is
  what this graph exists to enable.
- **Materials as a concept source.** Only lecture notes are extracted here.
  Slide decks and PDFs are the obvious second source.
- **Node descriptions.** A one-line gloss per concept would make the eventual
  visualizer far more readable and costs one more field in the extraction JSON.
- **Manual merge and split.** When §5.2's guards get it wrong, there is currently
  no way to correct the graph by hand.
- **Edge decay.** `weight` only rises. A relation asserted once in September and
  contradicted in November looks identical to a stable one.
