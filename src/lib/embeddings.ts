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
            // Prisma's Bytes type is Uint8Array<ArrayBuffer>; a Buffer's backing
            // ArrayBufferLike (possibly a pooled/shared allocation) isn't
            // assignable to that, so copy into a plain-ArrayBuffer view.
            vector: new Uint8Array(encodeVector(vectors[i])),
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
