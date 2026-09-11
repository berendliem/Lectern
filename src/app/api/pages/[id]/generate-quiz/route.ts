import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { assertSingleParent } from "@/lib/cards";
import { callLLMJSON } from "@/lib/llm";
import { QUIZ_SYSTEM_PROMPT, buildQuizUserPrompt, buildMissesQuizUserPrompt } from "@/lib/prompts/quiz";
import { quizResponseSchema } from "@/lib/validation";

/**
 * The questions this page has been answered wrongly on, most recent first, one
 * entry per question however many times it was missed — a question failed five
 * times is one shaky concept, not five.
 */
async function missedQuestions(pageId: string) {
  const attempts = await db.quizAttempt.findMany({
    where: { isCorrect: false, question: { pageId } },
    include: { question: { select: { id: true, prompt: true, correctAnswer: true } } },
    orderBy: { attemptedAt: "desc" },
  });

  const seen = new Set<string>();
  return attempts
    .filter((a) => !seen.has(a.question.id) && seen.add(a.question.id))
    .map((a) => ({ prompt: a.question.prompt, correctAnswer: a.question.correctAnswer }));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, include: { notes: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.notes) return jsonError("This page has no notes to generate a quiz from yet", 422);

  // Drilling misses adds to the quiz. The plain regenerate replaces it, and
  // replacing cascades to the attempts on the questions it removes, so the two
  // paths must not be confused.
  const drillMisses = req.nextUrl.searchParams.get("misses") === "1";
  const misses = drillMisses ? await missedQuestions(id) : [];
  if (drillMisses && misses.length === 0) {
    return jsonError("Nothing to drill yet — answer some quiz questions wrongly first", 422);
  }

  // Drilling is an optional extra on top of a finished page, so it stays out
  // of the pipeline status the banner reads. Moving a READY page to
  // GENERATING_GUIDE and then to ERROR would hide a working quiz behind an
  // error banner because a bonus step failed.
  if (!drillMisses) {
    await db.page.update({ where: { id }, data: { status: "GENERATING_GUIDE", errorMessage: null } });
  }

  const model = process.env.OPENROUTER_MODEL_QUIZ ?? "openrouter/free";

  try {
    const raw = await callLLMJSON({
      model,
      systemPrompt: QUIZ_SYSTEM_PROMPT,
      userPrompt: drillMisses
        ? buildMissesQuizUserPrompt(page.notes.markdown, misses)
        : buildQuizUserPrompt(page.notes.markdown),
    });
    const parsed = await quizResponseSchema.parseAsync(raw);

    if (!drillMisses) await db.quizQuestion.deleteMany({ where: { pageId: id } });
    await db.quizQuestion.createMany({
      data: parsed.questions.map((q) => ({
        ...assertSingleParent({ pageId: id }),
        type: q.type,
        prompt: q.prompt,
        correctAnswer: q.correctAnswer,
        options: q.type === "MULTIPLE_CHOICE" ? JSON.stringify(q.options) : null,
        explanation: q.explanation,
      })),
    });

    if (drillMisses) return NextResponse.json({ page });

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
    if (!drillMisses) {
      await db.page.update({ where: { id }, data: { status: "ERROR", errorMessage: message } });
    }
    return jsonError(message, 502);
  }
}
