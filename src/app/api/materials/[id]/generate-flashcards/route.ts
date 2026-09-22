import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { FLASHCARDS_SYSTEM_PROMPT, buildFlashcardsUserPrompt } from "@/lib/prompts/flashcards";
import { flashcardsResponseSchema } from "@/lib/validation";
import { assertSingleParent } from "@/lib/cards";
import { WALKTHROUGH_SOURCE_TERM } from "@/lib/walkthrough";

// A material has no notes step, so its raw text is the source. Cap what goes
// into one prompt: a 200-page reading would otherwise blow past a free model's
// context window and fail with an opaque provider error.
const MAX_PROMPT_CHARS = 24_000;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const material = await db.material.findUnique({
    where: { id },
    select: { id: true, text: true },
  });
  if (!material) return jsonError("Material not found", 404);
  if (!material.text.trim()) return jsonError("This material has no text to generate from", 422);

  const model = process.env.OPENROUTER_MODEL_FLASHCARDS ?? "openrouter/free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: FLASHCARDS_SYSTEM_PROMPT,
      userPrompt: buildFlashcardsUserPrompt(material.text.slice(0, MAX_PROMPT_CHARS)),
    });
    const parsed = await flashcardsResponseSchema.parseAsync(raw);

    // Walkthrough cards are the student's own misses, and generation never
    // recreates them, so only the generated cards are replaced. `not` alone
    // would skip a null sourceTerm, which is a generated card too.
    await db.flashcard.deleteMany({
      where: {
        materialId: id,
        OR: [{ sourceTerm: null }, { sourceTerm: { not: WALKTHROUGH_SOURCE_TERM } }],
      },
    });
    await db.flashcard.createMany({
      data: parsed.flashcards.map((card) => ({
        ...assertSingleParent({ materialId: id }),
        prompt: card.prompt,
        idealExplanation: card.idealExplanation,
        sourceTerm: card.sourceTerm,
      })),
    });

    return NextResponse.json({ count: parsed.flashcards.length });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Flashcard generation failed";
    return jsonError(message, 502);
  }
}
