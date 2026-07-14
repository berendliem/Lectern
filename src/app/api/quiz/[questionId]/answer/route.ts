import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { quizAnswerSchema } from "@/lib/validation";
import { gradeShortAnswer, gradeMultipleChoice } from "@/lib/grading";

export async function POST(req: NextRequest, { params }: { params: Promise<{ questionId: string }> }) {
  const { questionId } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(quizAnswerSchema, body);
  if ("error" in result) return result.error;

  const question = await db.quizQuestion.findUnique({ where: { id: questionId } });
  if (!question) return jsonError("Question not found", 404);

  const { answer } = result.data;

  let isCorrect: boolean;
  let scoreDetail: Record<string, unknown> | null = null;

  if (question.type === "MULTIPLE_CHOICE") {
    isCorrect = gradeMultipleChoice(answer, question.correctAnswer);
  } else {
    const grade = gradeShortAnswer(answer, question.correctAnswer);
    isCorrect = grade.isCorrect;
    scoreDetail = { similarity: grade.similarity };
  }

  await db.quizAttempt.create({
    data: {
      questionId,
      userAnswer: answer,
      isCorrect,
      scoreDetail: scoreDetail ? JSON.stringify(scoreDetail) : null,
    },
  });

  return NextResponse.json({
    isCorrect,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
  });
}
