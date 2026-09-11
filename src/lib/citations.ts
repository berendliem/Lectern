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

/**
 * Collapses several chunks from one lecture or material into a single
 * citation. Keyed on the id, not the label: two materials (e.g. two terms'
 * syllabi) can share a title, and keying on the label would silently merge
 * citations that point at different sources.
 */
export function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((c) => {
    const key = c.pageId ?? c.materialId ?? c.label;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
