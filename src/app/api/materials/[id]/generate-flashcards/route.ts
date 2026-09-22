import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { FLASHCARDS_SYSTEM_PROMPT, buildFlashcardsUserPrompt } from "@/lib/prompts/flashcards";
import { flashcardsResponseSchema } from "@/lib/validation";
import { assertSingleParent, generatedCardFilter } from "@/lib/cards";

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

    // Cards the student earned by missing something are kept: generation
    // never recreates them.
    await db.flashcard.deleteMany({ where: { materialId: id, ...generatedCardFilter } });
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
