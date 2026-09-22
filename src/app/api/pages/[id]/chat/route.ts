import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { callLLMText, type ChatMessage } from "@/lib/llm";
import { CHAT_DIAGRAM_CLAUSE, UNTRUSTED_CONTENT_CLAUSE, WEB_SEARCH_CLAUSE } from "@/lib/prompts/shared";
import { retrieve } from "@/lib/retrieval";
import { chatRequestSchema } from "@/lib/validation";
import { lectureText } from "@/lib/transcript-layer";

const MAX_CONTEXT_CHARS = 24_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(chatRequestSchema, body);
  if ("error" in result) return result.error;

  const page = await db.page.findUnique({
    where: { id },
    include: { transcript: true, notes: true },
  });
  if (!page) return jsonError("Page not found", 404);
  if (!page.transcript && !page.notes) {
    return jsonError("This page has no transcript or notes to chat about yet", 422);
  }

  const lastUser = [...result.data.messages].reverse().find((m) => m.role === "user");
  const { hits, mode } = await retrieve({
    scope: { kind: "page", pageId: id },
    query: lastUser?.content ?? "",
  });

  // A lecture that predates the vector index, or whose embedder changed and has
  // not been through `npm run reindex`, has no chunks to retrieve. Falling back
  // to the whole-lecture slice keeps it working exactly as it did before.
  const context =
    mode === "semantic" && hits.length > 0
      ? hits.map((h) => `### ${h.title}\n${h.text}`).join("\n\n---\n\n")
      : [
          page.notes ? `NOTES:\n${page.notes.markdown}` : "",
          lectureText(page.transcript),
        ]
          .filter(Boolean)
          .join("\n\n")
          .slice(0, MAX_CONTEXT_CHARS);

  const systemPrompt = `You are a study assistant for the lecture "${page.title}". Answer the student's questions using the lecture material below. Be concise and concrete. If the material doesn't cover something, say so plainly instead of inventing an answer — you may then add general knowledge, clearly labeled as outside the lecture. ${CHAT_DIAGRAM_CLAUSE}${result.data.web ? ` ${WEB_SEARCH_CLAUSE}` : ""}\n\n${UNTRUSTED_CONTENT_CLAUSE}\n\n${context}`;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...result.data.messages,
  ];

  const model =
    process.env.OPENROUTER_MODEL_CHAT ??
    process.env.OPENROUTER_MODEL_SUMMARY ??
    "openrouter/free";

  try {
    const reply = await callLLMText({ model, messages, web: result.data.web });
    return NextResponse.json({ reply });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Chat failed";
    return jsonError(message, 502);
  }
}
