import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { quizAnswerSchema } from "@/lib/validation";
import { gradeShortAnswer, gradeMultipleChoice } from "@/lib/grading";
import { checkMathAnswer } from "@/lib/math-answer";
import { writeRecallSafely } from "@/lib/recall-log";
import type { RecallRaw } from "@/lib/recall";

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
  let raw: RecallRaw;

  if (question.type === "MULTIPLE_CHOICE") {
    isCorrect = gradeMultipleChoice(answer, question.correctAnswer);
    raw = { kind: "QUIZ", correct: isCorrect };
  } else if (question.type === "MATH") {
    const grade = checkMathAnswer(answer, question.correctAnswer);
    isCorrect = grade.isCorrect;
    // Which strategy decided, so a miscalibrated one shows up in the data
    // rather than quietly inflating scores.
    scoreDetail = { strategy: grade.strategy };
    // The boolean form, like multiple choice. A math answer is right or wrong;
    // there is no partial credit to feed the interval, and inventing a
    // similarity for one would make the ledger lie.
    raw = { kind: "QUIZ", correct: isCorrect };
  } else {
    const grade = gradeShortAnswer(answer, question.correctAnswer);
    isCorrect = grade.isCorrect;
    scoreDetail = { similarity: grade.similarity };
    // The similarity, not the pass/fail: a half-right short answer should
    // shorten the interval without being scored as a blackout.
    raw = { kind: "QUIZ", similarity: grade.similarity };
  }

  await db.quizAttempt.create({
    data: {
      questionId,
      userAnswer: answer,
      isCorrect,
      scoreDetail: scoreDetail ? JSON.stringify(scoreDetail) : null,
    },
  });

  // The explanation is written for exactly this moment and thrown away today.
  // On a wrong answer it is the misconception, verbatim.
  await writeRecallSafely({
    raw,
    pageId: question.pageId,
    materialId: question.materialId,
    misconception: question.explanation,
    detail: { answer, ...(scoreDetail ?? {}) },
  });

  return NextResponse.json({
    isCorrect,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
  });
}
