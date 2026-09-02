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
