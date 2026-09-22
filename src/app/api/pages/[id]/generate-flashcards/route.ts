import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError, markStageFailed } from "@/lib/api-utils";
import { assertSingleParent, generatedCardFilter } from "@/lib/cards";
import { callLLMJSON } from "@/lib/llm";
import { FLASHCARDS_SYSTEM_PROMPT, buildFlashcardsUserPrompt } from "@/lib/prompts/flashcards";
import { flashcardsResponseSchema } from "@/lib/validation";
import { upsertSearchIndex } from "@/lib/fts";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, include: { notes: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.notes) return jsonError("This page has no notes to generate flashcards from yet", 422);

  await db.page.update({ where: { id }, data: { status: "GENERATING_GUIDE", errorMessage: null } });

  const model = process.env.OPENROUTER_MODEL_FLASHCARDS ?? "openrouter/free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: FLASHCARDS_SYSTEM_PROMPT,
      userPrompt: buildFlashcardsUserPrompt(page.notes.markdown),
    });
    const parsed = await flashcardsResponseSchema.parseAsync(raw);

    // Cards the student earned by missing something are kept: generation
    // never recreates them. One transaction, so a failed insert cannot leave
    // the old cards deleted and nothing in their place.
    await db.$transaction([
      db.flashcard.deleteMany({ where: { pageId: id, ...generatedCardFilter } }),
      db.flashcard.createMany({
        data: parsed.flashcards.map((card) => ({
          ...assertSingleParent({ pageId: id }),
          prompt: card.prompt,
          idealExplanation: card.idealExplanation,
          sourceTerm: card.sourceTerm,
        })),
      }),
    ]);

    const quizCount = await db.quizQuestion.count({ where: { pageId: id } });
    const updated = await db.page.update({
      where: { id },
      data: { errorMessage: null, status: quizCount > 0 ? "READY" : "GENERATING_GUIDE" },
    });
    await upsertSearchIndex(id);

    return NextResponse.json({ page: updated });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Flashcard generation failed";
    await markStageFailed(id, page.status, message);
    return jsonError(message, 502);
  }
}
