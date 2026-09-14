import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMText } from "@/lib/llm";
import { CLEANUP_SYSTEM_PROMPT, buildCleanupUserPrompt } from "@/lib/prompts/cleanup";
import { getDictionaryEntries, buildSpellingGuide } from "@/lib/dictionary";
import { cleanupInput } from "@/lib/cleanup-input";
import type { TranscriptSegment } from "@/types";

// Chunk size keeps each request comfortably inside small-model context
// windows; chunks are cleaned independently and rejoined.
const CHUNK_CHARS = 8_000;
// Hard ceiling so one request can't spend hours of LLM time on a huge import.
const MAX_CHUNKS = 40;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, include: { transcript: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.transcript) return jsonError("This page has no transcript to clean up yet", 422);

  const model = process.env.OPENROUTER_MODEL_SUMMARY ?? "openrouter/free";

  try {
    const spellingGuide = buildSpellingGuide(await getDictionaryEntries().catch(() => []));
    const segments: TranscriptSegment[] = JSON.parse(page.transcript.segments);
    const { chunks, lecturer } = cleanupInput(page.transcript.rawText, segments, CHUNK_CHARS);
    if (chunks.length === 0) return jsonError("The transcript is empty", 422);
    if (chunks.length > MAX_CHUNKS) {
      return jsonError(
        `This transcript is too long to clean up in one go (${chunks.length} chunks, max ${MAX_CHUNKS}).`,
        422
      );
    }

    const cleanedParts: string[] = [];
    for (const chunk of chunks) {
      const cleaned = await callLLMText({
        model,
        stage: "summary",
        messages: [
          { role: "system", content: CLEANUP_SYSTEM_PROMPT },
          { role: "user", content: buildCleanupUserPrompt(chunk, spellingGuide, lecturer) },
        ],
      });
      cleanedParts.push(cleaned);
    }

    const cleanText = cleanedParts.join("\n\n");
    await db.transcript.update({ where: { pageId: id }, data: { cleanText } });

    return NextResponse.json({ cleanText });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Transcript cleanup failed";
    return jsonError(message, 502);
  }
}
