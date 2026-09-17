import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { REWRITE_FLASHCARD_SYSTEM_PROMPT, buildRewriteFlashcardUserPrompt } from "@/lib/prompts/flashcards";
import { updateFlashcardSchema } from "@/lib/validation";

// Same cap the other single-page prompts use.
const MAX_CONTEXT_CHARS = 24_000;

/**
 * A fresh framing for a card the learner keeps failing. Returns a draft and
 * writes nothing: the student's card only changes when they save the draft
 * through PATCH, so a rewrite they dislike costs them a click, not a card.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await db.flashcard.findUnique({
    where: { id },
    include: {
      page: { select: { notes: { select: { markdown: true } }, transcript: { select: { cleanText: true, rawText: true } } } },
      material: { select: { text: true } },
    },
  });
  if (!card) return jsonError("Flashcard not found — the set may have been regenerated", 404);

  const notes =
    card.page?.notes?.markdown ??
    card.page?.transcript?.cleanText ??
    card.page?.transcript?.rawText ??
    card.material?.text ??
    "";
  const model = process.env.OPENROUTER_MODEL_FLASHCARDS ?? "openrouter/free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: REWRITE_FLASHCARD_SYSTEM_PROMPT,
      userPrompt: buildRewriteFlashcardUserPrompt(card, notes.slice(0, MAX_CONTEXT_CHARS)),
    });
    const draft = await updateFlashcardSchema.parseAsync(raw);
    return NextResponse.json({ draft });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Rewrite failed";
    return jsonError(message, 502);
  }
}
