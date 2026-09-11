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
