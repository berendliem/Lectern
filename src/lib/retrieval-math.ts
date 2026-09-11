import type { ChunkWhereInput } from "@/generated/prisma/models/Chunk";

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
  | { kind: "all"; pageIds: readonly string[]; folderIds: readonly string[] };

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
export function scopeFilter(scope: ResolvedScope, model: string): ChunkWhereInput {
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
          { pageId: { in: [...scope.pageIds] } },
          { material: { folderId: { in: [...scope.folderIds] } } },
        ],
      };
  }
}
