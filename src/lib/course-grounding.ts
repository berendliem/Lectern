// src/lib/course-grounding.ts
import { searchCourse } from "@/lib/embeddings";
import type { DebateGrounding } from "@/lib/prompts/debate";

/**
 * Course chunks for a prompt to take its examples from. A retrieval failure
 * degrades to no grounding instead of failing the turn: the prompt then says
 * the course had nothing, and the model says its example is invented.
 */
export async function courseGrounding(
  folderId: string,
  query: string,
  k: number,
  label: string
): Promise<DebateGrounding> {
  try {
    const hits = await searchCourse(folderId, query, k);
    return hits.map((hit) => ({ title: hit.title, text: hit.text }));
  } catch (e) {
    console.error(`[${label}] semantic retrieval failed, continuing ungrounded:`, e);
    return [];
  }
}
