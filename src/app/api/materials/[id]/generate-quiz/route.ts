import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { QUIZ_SYSTEM_PROMPT, buildQuizUserPrompt } from "@/lib/prompts/quiz";
import { quizResponseSchema } from "@/lib/validation";
import { assertSingleParent } from "@/lib/cards";

const MAX_PROMPT_CHARS = 24_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const material = await db.material.findUnique({
    where: { id },
    select: { id: true, text: true },
  });
  if (!material) return jsonError("Material not found", 404);
  if (!material.text.trim()) return jsonError("This material has no text to generate from", 422);

  // Exam cram's bulk run only fills gaps. Regenerating here would delete
  // questions that appeared since the cram page rendered, and the attempts on them.
  // This early check only saves the LLM call; the guard is the re-check in the
  // transaction below.
  const ifEmpty = req.nextUrl.searchParams.get("ifEmpty") === "1";
  if (ifEmpty) {
    const existing = await db.quizQuestion.count({ where: { materialId: id } });
    if (existing > 0) return NextResponse.json({ count: existing, skipped: true });
  }

  const model = process.env.OPENROUTER_MODEL_QUIZ ?? "openrouter/free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: QUIZ_SYSTEM_PROMPT,
      userPrompt: buildQuizUserPrompt(material.text.slice(0, MAX_PROMPT_CHARS)),
    });
    const parsed = await quizResponseSchema.parseAsync(raw);

    // One transaction, so a failed write cannot leave the material with its old
    // questions deleted and nothing in their place. The ifEmpty check runs again
    // inside it: a regenerate from another tab may have landed during the LLM call.
    const skippedFor = await db.$transaction(async (tx) => {
      if (ifEmpty) {
        const existing = await tx.quizQuestion.count({ where: { materialId: id } });
        if (existing > 0) return existing;
      }
      await tx.quizQuestion.deleteMany({ where: { materialId: id } });
      await tx.quizQuestion.createMany({
        data: parsed.questions.map((q) => ({
          ...assertSingleParent({ materialId: id }),
          type: q.type,
          prompt: q.prompt,
          correctAnswer: q.correctAnswer,
          options: q.type === "MULTIPLE_CHOICE" ? JSON.stringify(q.options) : null,
          explanation: q.explanation,
        })),
      });
      return null;
    });

    if (skippedFor !== null) return NextResponse.json({ count: skippedFor, skipped: true });
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
