import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { QUIZ_SYSTEM_PROMPT, buildQuizUserPrompt } from "@/lib/prompts/quiz";
import { quizResponseSchema } from "@/lib/validation";
import { assertSingleParent } from "@/lib/cards";

const MAX_PROMPT_CHARS = 24_000;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const material = await db.material.findUnique({
    where: { id },
    select: { id: true, text: true },
  });
  if (!material) return jsonError("Material not found", 404);
  if (!material.text.trim()) return jsonError("This material has no text to generate from", 422);

  const model = process.env.OPENROUTER_MODEL_QUIZ ?? "meta-llama/llama-3.3-70b-instruct:free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: QUIZ_SYSTEM_PROMPT,
      userPrompt: buildQuizUserPrompt(material.text.slice(0, MAX_PROMPT_CHARS)),
    });
    const parsed = await quizResponseSchema.parseAsync(raw);

    await db.quizQuestion.deleteMany({ where: { materialId: id } });
    await db.quizQuestion.createMany({
      data: parsed.questions.map((q) => ({
        ...assertSingleParent({ materialId: id }),
        type: q.type,
        prompt: q.prompt,
        correctAnswer: q.correctAnswer,
        options: q.type === "MULTIPLE_CHOICE" ? JSON.stringify(q.options) : null,
        explanation: q.explanation,
      })),
    });

    return NextResponse.json({ count: parsed.questions.length });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Quiz generation failed";
    return jsonError(message, 502);
  }
}
