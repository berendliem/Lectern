import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMText, type ChatMessage } from "@/lib/llm";
import { CHAT_DIAGRAM_CLAUSE } from "@/lib/prompts/shared";
import { chatRequestSchema } from "@/lib/validation";
import { searchPages } from "@/lib/fts";
import { dedupeCitations, formatCitation, type Citation } from "@/lib/citations";
import { reasoningModel } from "@/lib/llm";
import { retrieve, CONTEXT_CHARS } from "@/lib/retrieval";
import { packContext } from "@/lib/retrieval-math";

// Caps how much of one FTS-matched page's raw (unchunked) text is even
// considered per source, before packContext trims whole blocks down to
// CONTEXT_CHARS below. Semantic hits need no such cap: Chunk rows are already
// capped at write time (CHUNK_CHARS in src/lib/embeddings.ts), so slicing
// them again here could never truncate anything.
const FTS_PAGE_CHARS = 2_800;
const FTS_FALLBACK_PAGES = 8;

async function ftsFallback(
  courseId: string,
  query: string,
  k: number
): Promise<{ blocks: string[]; citations: Citation[] }> {
  const ftsHits = await searchPages(query, k);
  const pages = ftsHits.length
    ? await db.page.findMany({
        where: { id: { in: ftsHits.map((h) => h.pageId) }, folderId: courseId },
        include: { notes: true, transcript: true },
      })
    : [];
  const byId = new Map(pages.map((p) => [p.id, p]));
  // Walk in ftsHits' bm25-ranked order, not `pages`' db-returned order — now
  // that packContext below trims whole blocks once the budget is spent, which
  // block survives depends on this order.
  const candidates: { text: string; title: string; pageId: string | null; materialId: string | null }[] = [];
  for (const hit of ftsHits) {
    const page = byId.get(hit.pageId);
    if (!page) continue;
    const text = page.notes?.markdown ?? page.transcript?.rawText ?? "";
    if (!text.trim()) continue;
    candidates.push({
      text: text.slice(0, FTS_PAGE_CHARS),
      title: page.title,
      pageId: page.id,
      materialId: null,
    });
  }
  const blocks: string[] = [];
  const citations: Citation[] = [];
  for (const kept of packContext(candidates, k, CONTEXT_CHARS)) {
    blocks.push(`### ${kept.title}\n${kept.text}`);
    citations.push({ label: kept.title, pageId: kept.pageId, materialId: kept.materialId });
  }
  return { blocks, citations };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folder = await db.folder.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!folder) return jsonError("Course not found", 404);

  const body = await req.json().catch(() => null);
  const result = await withValidation(chatRequestSchema, body);
  if ("error" in result) return result.error;

  const messages = result.data.messages;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return jsonError("No question to answer", 422);

  const { hits, mode } = await retrieve({
    scope: { kind: "course", folderId: id },
    query: lastUser.content,
  });
  let blocks: string[] = [];
  let citations: Citation[] = [];

  if (hits.length > 0) {
    blocks = hits.map((h) => `### ${h.title}\n${h.text}`);
    citations = hits.map(formatCitation);
  } else {
    // Either this course has no chunks for the active embedder, or embedding
    // failed. `mode` already records which; both fall back to full-text search
    // scoped to this course.
    ({ blocks, citations } = await ftsFallback(id, lastUser.content, FTS_FALLBACK_PAGES));
  }

  // Several chunks from one lecture or material collapse to a single citation.
  citations = dedupeCitations(citations);

  const context = blocks.length
    ? blocks.join("\n\n---\n\n")
    : `(Nothing in ${folder.name} matched this question.)`;

  const systemPrompt = `You are a study assistant for the course "${folder.name}". Answer using only the course excerpts below. When you use a fact, name the lecture or material it came from. Be concise and concrete. Format with plain markdown only — no HTML tags, and prefer short lists over wide tables. If the course material does not cover the question, say so plainly — you may then add general knowledge, clearly labeled as outside this course. ${CHAT_DIAGRAM_CLAUSE}\n\nCOURSE EXCERPTS:\n${context}`;

  const chatMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...messages];

  try {
    const reply = await callLLMText({
      model: reasoningModel(),
      messages: chatMessages,
      stage: "reasoning",
    });
    return NextResponse.json({ reply, citations, retrieval: mode });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ask failed";
    return jsonError(message, 502);
  }
}
