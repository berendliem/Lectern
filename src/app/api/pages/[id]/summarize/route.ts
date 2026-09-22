import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError, markStageFailed } from "@/lib/api-utils";
import { callLLMJSON, callLLMText, llmModelLabel } from "@/lib/llm";
import { getDictionaryEntries, buildSpellingGuide } from "@/lib/dictionary";
import {
  SUMMARIZE_MAP_SYSTEM_PROMPT,
  buildSummarizeMapUserPrompt,
  summarizePromptsFor,
} from "@/lib/prompts/summarize";
import { splitTextIntoChunks } from "@/lib/text-chunks";
import { summaryResponseSchema } from "@/lib/validation";
import { upsertSearchIndex } from "@/lib/fts";
import { indexSourceSafely } from "@/lib/embeddings";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, include: { transcript: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.transcript) return jsonError("This page has no transcript to summarize yet", 422);
  const existingNotes = await db.notes.findUnique({ where: { pageId: id }, select: { markdown: true } });

  await db.page.update({ where: { id }, data: { status: "SUMMARIZING", errorMessage: null } });

  const model = process.env.OPENROUTER_MODEL_SUMMARY ?? "openrouter/free";

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

    // A deck longer than one chunk would crowd the recording out of the final
    // prompt, so it goes through the same map step the transcript uses.
    if (page.transcript.contextText && page.transcript.contextText.length > CHUNK_CHARS) {
      const contextChunks = splitTextIntoChunks(page.transcript.contextText, CHUNK_CHARS);
      if (contextChunks.length > MAX_CHUNKS) {
        throw new Error(
          `This lecture's slides are too long to summarize in one go (${contextChunks.length} chunks, max ${MAX_CHUNKS}).`
        );
      }
      const condensed: string[] = [];
      for (let i = 0; i < contextChunks.length; i++) {
        condensed.push(
          await callLLMText({
            model,
            stage: "summary",
            messages: [
              { role: "system", content: SUMMARIZE_MAP_SYSTEM_PROMPT },
              { role: "user", content: buildSummarizeMapUserPrompt(contextChunks[i], i, contextChunks.length) },
            ],
          })
        );
      }
      page.transcript.contextText = condensed.join("\n\n");
    }

    const { systemPrompt, buildUserPrompt, buildReduceUserPrompt } = summarizePromptsFor(page.transcript);

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
      userPrompt = buildReduceUserPrompt(interim.join("\n\n"), spellingGuide);
    } else {
      userPrompt = buildUserPrompt(transcript, spellingGuide);
    }

    const raw = await callLLMJSON({
      model,
      stage: "summary",
      systemPrompt,
      userPrompt,
    });
    const parsed = await summaryResponseSchema.parseAsync(raw);

    await db.notes.upsert({
      where: { pageId: id },
      update: {
        markdown: parsed.markdown,
        keyTerms: JSON.stringify(parsed.keyTerms),
        modelUsed,
        // The notes being replaced may hold the student's own edits; Undo in the
        // Notes tab reads this.
        previousMarkdown: existingNotes?.markdown ?? null,
      },
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

    await indexSourceSafely({ pageId: id });

    return NextResponse.json({ page: updated });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Summarization failed";
    await markStageFailed(id, page.status, message);
    return jsonError(message, 502);
  }
}
