import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON, llmModelLabel } from "@/lib/llm";
import { getDictionaryEntries, buildSpellingGuide } from "@/lib/dictionary";
import { SUMMARIZE_SYSTEM_PROMPT, buildSummarizeUserPrompt } from "@/lib/prompts/summarize";
import { summaryResponseSchema } from "@/lib/validation";
import { upsertSearchIndex } from "@/lib/fts";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, include: { transcript: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.transcript) return jsonError("This page has no transcript to summarize yet", 422);

  await db.page.update({ where: { id }, data: { status: "SUMMARIZING", errorMessage: null } });

  const model = process.env.OPENROUTER_MODEL_SUMMARY ?? "meta-llama/llama-3.3-70b-instruct:free";
  const modelUsed = llmModelLabel(model, "summary");

  try {
    const spellingGuide = buildSpellingGuide(await getDictionaryEntries().catch(() => []));
    const raw = await callLLMJSON({
      model,
      stage: "summary",
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
      userPrompt: buildSummarizeUserPrompt(page.transcript.rawText, spellingGuide),
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
