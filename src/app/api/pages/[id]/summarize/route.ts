import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON, callLLMText, llmModelLabel } from "@/lib/llm";
import { getDictionaryEntries, buildSpellingGuide } from "@/lib/dictionary";
import {
  SUMMARIZE_SYSTEM_PROMPT,
  SUMMARIZE_MAP_SYSTEM_PROMPT,
  buildSummarizeUserPrompt,
  buildSummarizeMapUserPrompt,
  buildSummarizeReduceUserPrompt,
} from "@/lib/prompts/summarize";
import { splitTextIntoChunks } from "@/lib/text-chunks";
import { summaryResponseSchema } from "@/lib/validation";
import { upsertSearchIndex } from "@/lib/fts";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, include: { transcript: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.transcript) return jsonError("This page has no transcript to summarize yet", 422);

  await db.page.update({ where: { id }, data: { status: "SUMMARIZING", errorMessage: null } });

  const model = process.env.OPENROUTER_MODEL_SUMMARY ?? "meta-llama/llama-3.3-70b-instruct:free";

  try {
    // Inside the try: a misconfigured LLM_PROVIDER throws here, and must land
    // in the catch below so the page doesn't wedge in SUMMARIZING.
    const modelUsed = llmModelLabel(model, "summary");
    const spellingGuide = buildSpellingGuide(await getDictionaryEntries().catch(() => []));
    // Prefer the cleaned transcript when the user generated one — fewer
    // ASR errors and no filler makes for better notes.
    const transcript = page.transcript.cleanText ?? page.transcript.rawText;

    // Long lectures overflow small (especially local) model context windows:
    // map-reduce them — condense each portion, then summarize the condensates.
    const MAP_REDUCE_THRESHOLD = 28_000;
    const CHUNK_CHARS = 14_000;
    const MAX_CHUNKS = 40;
    let userPrompt: string;
    if (transcript.length > MAP_REDUCE_THRESHOLD) {
      const chunks = splitTextIntoChunks(transcript, CHUNK_CHARS);
      if (chunks.length > MAX_CHUNKS) {
        // Fail loudly rather than silently dropping the transcript's tail.
        throw new Error(
          `This transcript is too long to summarize in one go (${chunks.length} chunks, max ${MAX_CHUNKS}).`
        );
      }
      const interim: string[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const condensed = await callLLMText({
          model,
          stage: "summary",
          messages: [
            { role: "system", content: SUMMARIZE_MAP_SYSTEM_PROMPT },
            { role: "user", content: buildSummarizeMapUserPrompt(chunks[i], i, chunks.length) },
          ],
        });
        interim.push(condensed);
      }
      userPrompt = buildSummarizeReduceUserPrompt(interim.join("\n\n"), spellingGuide);
    } else {
      userPrompt = buildSummarizeUserPrompt(transcript, spellingGuide);
    }

    const raw = await callLLMJSON({
      model,
      stage: "summary",
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
      userPrompt,
    });
    const parsed = await summaryResponseSchema.parseAsync(raw);

    await db.notes.upsert({
      where: { pageId: id },
      update: { markdown: parsed.markdown, keyTerms: JSON.stringify(parsed.keyTerms), modelUsed },
      create: {
        pageId: id,
        markdown: parsed.markdown,
        keyTerms: JSON.stringify(parsed.keyTerms),
        modelUsed,
      },
    });

    const updated = await db.page.update({
      where: { id },
      data: { status: "SUMMARIZED", errorMessage: null },
    });
    await upsertSearchIndex(id);

    return NextResponse.json({ page: updated });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Summarization failed";
    await db.page.update({ where: { id }, data: { status: "ERROR", errorMessage: message } });
    return jsonError(message, 502);
  }
}
