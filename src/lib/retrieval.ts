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
 * `semantic` — vectors were used to rank real candidates.
 * `unindexed` — the scope had real candidate ids but the chunks table has
 *   none of them for the active embedder. A broken/missing-index signal:
 *   most likely the source predates the vector index, or `EMBED_PROVIDER`
 *   changed and `npm run reindex` has not run.
 * `empty` — no search was meaningfully attempted: the query was blank, or (on
 *   `all` scope) the FTS prefilter matched no lectures. A normal outcome —
 *   most often an off-topic question — not evidence anything is broken, and
 *   worth telling apart from `unindexed` for that reason.
 * `fts` — embedding threw; the caller's keyword fallback carries the answer.
 * Callers degrade differently on each, so the distinction is preserved.
 */
export type RetrievalMode = "semantic" | "fts" | "unindexed" | "empty";

const MAX_HITS = 4;
/**
 * ~1,250 tokens. Leaves an 8k-context model room for the system prompt,
 * several turns of history, and an answer — the budget this branch exists to
 * establish. Exported so both routes' FTS fallback paths can cap themselves
 * to it instead of inventing their own multi-thousand-character budgets.
 */
export const CONTEXT_CHARS = 5_000;
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
  // Page.folderId is nullable (SetNull when its folder is deleted, per the
  // ReviewLog-never-cascades convention) — an orphaned page isn't part of any
  // course, so it can't narrow one.
  const folderIds = [
    ...new Set(pages.map((p) => p.folderId).filter((id): id is string => id !== null)),
  ];
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
  const scopeLabel = opts.scope.kind;

  if (!trimmed) {
    // chatRequestSchema's role enum accepts "assistant" and only requires the
    // array to be non-empty, so an all-assistant messages array reaches here
    // with pages/[id]/chat/route.ts's `lastUser?.content ?? ""`. No search was
    // attempted — keep the row so the ledger still catches this upstream bug,
    // but don't claim a mode that implies vectors were computed.
    const mode: RetrievalMode = "empty";
    await logRetrieval({ query: trimmed, scope: scopeLabel, mode, hits: [], topScore: 0 });
    return { hits: [], mode };
  }

  let mode: RetrievalMode = "semantic";
  let hits: CourseHit[] = [];

  try {
    const model = activeEmbedModelLabel();
    const resolved = await resolveScope(opts.scope, trimmed);

    if (resolved.kind === "all" && resolved.pageIds.length === 0) {
      // The FTS prefilter matched no lectures for this question — a normal
      // outcome for an off-topic question, not evidence the index is broken.
      // scopeFilter would just match zero rows below; skip the query and say
      // so honestly instead of logging the same "unindexed" a broken index
      // would produce.
      mode = "empty";
    } else {
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
        // Not "nothing was relevant enough" — this scope had real candidate
        // ids but no chunks at all for the active embedder. A clean, distinct
        // signal the caller can act on.
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
