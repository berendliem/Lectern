import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMText, type ChatMessage } from "@/lib/llm";
import { chatRequestSchema } from "@/lib/validation";
import { searchCourse } from "@/lib/embeddings";
import { searchPages } from "@/lib/fts";
import { formatCitation, type Citation } from "@/lib/citations";
import { reasoningModel } from "@/lib/llm";

const K = 8;
const PER_CHUNK_CHARS = 1_400;

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

  let retrieval: "semantic" | "fts" = "semantic";
  let blocks: string[] = [];
  let citations: Citation[] = [];

  try {
    const hits = await searchCourse(id, lastUser.content, K);
    blocks = hits.map((h) => `### ${h.title}\n${h.text.slice(0, PER_CHUNK_CHARS)}`);
    citations = hits.map(formatCitation);
  } catch (e) {
    // Every rung of the embedding chain failed. Fall back to full-text search
    // scoped to this course: retrieval quality drops, the feature does not break.
    console.error(`[ask] semantic retrieval failed for course ${id}, falling back to FTS:`, e);
    retrieval = "fts";
    const ftsHits = await searchPages(lastUser.content, K);
    const pages = ftsHits.length
      ? await db.page.findMany({
          where: { id: { in: ftsHits.map((h) => h.pageId) }, folderId: id },
          include: { notes: true, transcript: true },
        })
      : [];
    for (const page of pages) {
      const text = page.notes?.markdown ?? page.transcript?.rawText ?? "";
      if (!text.trim()) continue;
      blocks.push(`### ${page.title}\n${text.slice(0, PER_CHUNK_CHARS * 2)}`);
      citations.push({ label: page.title, pageId: page.id, materialId: null });
    }
  }

  // De-duplicate citations: several chunks from one lecture cite it once.
  const seen = new Set<string>();
  citations = citations.filter((c) => {
    const key = c.label;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const context = blocks.length
    ? blocks.join("\n\n---\n\n")
    : `(Nothing in ${folder.name} matched this question.)`;

  const systemPrompt = `You are a study assistant for the course "${folder.name}". Answer using only the course excerpts below. When you use a fact, name the lecture or material it came from. Be concise and concrete. If the course material does not cover the question, say so plainly — you may then add general knowledge, clearly labeled as outside this course.\n\nCOURSE EXCERPTS:\n${context}`;

  const chatMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...messages];

  try {
    const reply = await callLLMText({ model: reasoningModel(), messages: chatMessages });
    return NextResponse.json({ reply, citations, retrieval });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ask failed";
    return jsonError(message, 502);
  }
}
