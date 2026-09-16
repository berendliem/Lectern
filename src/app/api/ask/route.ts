import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMText, type ChatMessage } from "@/lib/llm";
import { CHAT_DIAGRAM_CLAUSE } from "@/lib/prompts/shared";
import { chatRequestSchema } from "@/lib/validation";
import { searchPages } from "@/lib/fts";
import { retrieve, CONTEXT_CHARS } from "@/lib/retrieval";
import { packContext } from "@/lib/retrieval-math";
import { dedupeCitations, formatCitation, type Citation } from "@/lib/citations";

// Caps how much of one FTS-matched page's raw (unchunked) text is even
// considered per source, before packContext trims whole blocks down to
// CONTEXT_CHARS below.
const PER_SOURCE_CHARS = 4_500;
const FTS_FALLBACK_PAGES = 6;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(chatRequestSchema, body);
  if ("error" in result) return result.error;

  const messages = result.data.messages;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return jsonError("No question to answer", 422);

  const { hits } = await retrieve({ scope: { kind: "all" }, query: lastUser.content });

  const blocks: string[] = [];
  let citations: Citation[] = [];

  if (hits.length > 0) {
    for (const hit of hits) {
      blocks.push(`### ${hit.title}\n${hit.text}`);
    }
    citations = hits.map(formatCitation);
  } else {
    // No vectors to work with — the library has never been indexed, or every
    // rung of the embedding chain failed. Keyword search is what this route ran
    // on before it had a vector index, and it still answers. Whole per-page
    // blocks are trimmed by the same CONTEXT_CHARS budget the semantic path
    // honours, instead of shipping every fallback page at full length.
    const ftsHits = await searchPages(lastUser.content, FTS_FALLBACK_PAGES);
    const pages = ftsHits.length
      ? await db.page.findMany({
          where: { id: { in: ftsHits.map((h) => h.pageId) } },
          include: { notes: true, transcript: true },
        })
      : [];
    const byId = new Map(pages.map((p) => [p.id, p]));
    const candidates: { text: string; title: string; pageId: string | null; materialId: string | null }[] = [];
    for (const hit of ftsHits) {
      const page = byId.get(hit.pageId);
      if (!page) continue;
      const text = page.notes?.markdown ?? page.transcript?.rawText ?? "";
      if (!text.trim()) continue;
      candidates.push({
        text: text.slice(0, PER_SOURCE_CHARS),
        title: page.title,
        pageId: page.id,
        materialId: null,
      });
    }
    for (const kept of packContext(candidates, FTS_FALLBACK_PAGES, CONTEXT_CHARS)) {
      blocks.push(`### Lecture: ${kept.title}\n${kept.text}`);
      citations.push({ label: kept.title, pageId: kept.pageId, materialId: kept.materialId });
    }
  }

  // Several chunks from one lecture collapse to a single citation.
  citations = dedupeCitations(citations);

  const context = blocks.length
    ? blocks.join("\n\n---\n\n")
    : "(No lectures in the library matched this question.)";

  const systemPrompt = `You are a study assistant with access to the student's personal lecture library. Answer their question using the lecture excerpts below. When you use a fact from a lecture, name the lecture it came from (e.g. "In your Photosynthesis lecture…"). Be concise and concrete. If the library doesn't cover the question, say so plainly — you may then add general knowledge, clearly labeled as outside their lectures. ${CHAT_DIAGRAM_CLAUSE}\n\nLECTURE EXCERPTS:\n${context}`;

  const model =
    process.env.OPENROUTER_MODEL_CHAT ??
    process.env.OPENROUTER_MODEL_SUMMARY ??
    "openrouter/free";

  const chatMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...messages];

  try {
    const reply = await callLLMText({ model, messages: chatMessages });
    return NextResponse.json({ reply, citations });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ask failed";
    return jsonError(message, 502);
  }
}
