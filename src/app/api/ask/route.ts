import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMText, type ChatMessage } from "@/lib/llm";
import { chatRequestSchema } from "@/lib/validation";
import { searchPages } from "@/lib/fts";

const MAX_SOURCES = 6;
const MAX_CONTEXT_CHARS = 22_000;
const PER_SOURCE_CHARS = 4_500;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(chatRequestSchema, body);
  if ("error" in result) return result.error;

  const messages = result.data.messages;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return jsonError("No question to answer", 422);

  // Retrieve the most relevant lectures for the latest question via full-text
  // search, then ground the answer in their notes/transcripts.
  const hits = await searchPages(lastUser.content, MAX_SOURCES);
  const pages = hits.length
    ? await db.page.findMany({
        where: { id: { in: hits.map((h) => h.pageId) } },
        include: { notes: true, transcript: true },
      })
    : [];
  // Preserve FTS relevance ordering.
  const byId = new Map(pages.map((p) => [p.id, p]));

  let used = 0;
  const contextBlocks: string[] = [];
  const sources: { pageId: string; title: string }[] = [];
  for (const hit of hits) {
    const page = byId.get(hit.pageId);
    if (!page) continue;
    const material = page.notes?.markdown ?? page.transcript?.rawText ?? "";
    if (!material.trim()) continue;
    const block = `### Lecture: ${page.title}\n${material.slice(0, PER_SOURCE_CHARS)}`;
    if (used + block.length > MAX_CONTEXT_CHARS) break;
    used += block.length;
    contextBlocks.push(block);
    sources.push({ pageId: page.id, title: page.title });
  }

  const context = contextBlocks.length
    ? contextBlocks.join("\n\n---\n\n")
    : "(No lectures in the library matched this question.)";

  const systemPrompt = `You are a study assistant with access to the student's personal lecture library. Answer their question using the lecture excerpts below. When you use a fact from a lecture, name the lecture it came from (e.g. "In your Photosynthesis lecture…"). Be concise and concrete. If the library doesn't cover the question, say so plainly — you may then add general knowledge, clearly labeled as outside their lectures.\n\nLECTURE EXCERPTS:\n${context}`;

  const model =
    process.env.OPENROUTER_MODEL_CHAT ??
    process.env.OPENROUTER_MODEL_SUMMARY ??
    "meta-llama/llama-3.3-70b-instruct:free";

  const chatMessages: ChatMessage[] = [{ role: "system", content: systemPrompt }, ...messages];

  try {
    const reply = await callLLMText({ model, messages: chatMessages });
    return NextResponse.json({ reply, sources });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ask failed";
    return jsonError(message, 502);
  }
}
