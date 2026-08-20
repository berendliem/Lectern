import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { callLLMJSON } from "@/lib/llm";
import { QUIZ_SYSTEM_PROMPT, buildQuizUserPrompt } from "@/lib/prompts/quiz";
import { quizResponseSchema } from "@/lib/validation";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, include: { notes: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.notes) return jsonError("This page has no notes to generate a quiz from yet", 422);

  await db.page.update({ where: { id }, data: { status: "GENERATING_GUIDE", errorMessage: null } });

  const model = process.env.OPENROUTER_MODEL_QUIZ ?? "meta-llama/llama-3.3-70b-instruct:free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: QUIZ_SYSTEM_PROMPT,
      userPrompt: buildQuizUserPrompt(page.notes.markdown),
    });
    const parsed = await quizResponseSchema.parseAsync(raw);

    await db.quizQuestion.deleteMany({ where: { pageId: id } });
    await db.quizQuestion.createMany({
      data: parsed.questions.map((q) => ({
        pageId: id,
        type: q.type,
        prompt: q.prompt,
        correctAnswer: q.correctAnswer,
        options: q.type === "MULTIPLE_CHOICE" ? JSON.stringify(q.options) : null,
        explanation: q.explanation,
      })),
    });

    const flashcardCount = await db.flashcard.count({ where: { pageId: id } });
    const updated = await db.page.update({
      where: { id },
      data: { errorMessage: null, status: flashcardCount > 0 ? "READY" : "GENERATING_GUIDE" },
    });

    return NextResponse.json({ page: updated });
  } catch (e) {
    const message =
      e instanceof ZodError
        ? "The model's response didn't match the expected format. You can retry this step."
        : e instanceof Error
          ? e.message
          : "Quiz generation failed";
    await db.page.update({ where: { id }, data: { status: "ERROR", errorMessage: message } });
    return jsonError(message, 502);
  }
}
