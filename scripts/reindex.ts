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
  // exists; leaving it would keep it invisible but occupying space. Only safe
  // to sweep when every source was re-embedded — otherwise a source that
  // failed above would lose its old (stale but present) index entirely,
  // trading a stale index for no index.
  let orphanedCount = 0;
  if (failed === 0) {
    orphanedCount = (await db.chunk.deleteMany({ where: { model: { not: model } } })).count;
  } else {
    console.log(`Skipping stale-row cleanup: ${failed} source(s) failed this run.`);
  }

  console.log(
    `\nDone: ${indexed} chunks embedded, ${skipped} reused, ${orphanedCount} stale rows removed, ${failed} sources failed.`
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("Reindex failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
