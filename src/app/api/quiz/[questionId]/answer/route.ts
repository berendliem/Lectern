import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { quizAnswerSchema } from "@/lib/validation";
import { gradeMultipleChoice, MASTERY_SCORE } from "@/lib/grading";
import { gradeFreeTextAnswer } from "@/lib/answer-grade";
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
  // 0-100 on every branch, so the session can hold one bar for all four
  // question types. A right/wrong type scores the ends of the scale.
  let score: number;
  let verdict: string | null = null;
  let missing: string[] = [];
  let scoreDetail: Record<string, unknown> | null = null;
  let raw: RecallRaw;

  if (question.type === "MULTIPLE_CHOICE") {
    isCorrect = gradeMultipleChoice(answer, question.correctAnswer);
    score = isCorrect ? 100 : 0;
    raw = { kind: "QUIZ", correct: isCorrect };
  } else if (question.type === "MATH") {
    const grade = checkMathAnswer(answer, question.correctAnswer);
    isCorrect = grade.isCorrect;
    score = isCorrect ? 100 : 0;
    // Which strategy decided, so a miscalibrated one shows up in the data
    // rather than quietly inflating scores.
    scoreDetail = { strategy: grade.strategy };
    // The boolean form, like multiple choice. A math answer is right or wrong;
    // there is no partial credit to feed the interval, and inventing a
    // similarity for one would make the ledger lie.
    raw = { kind: "QUIZ", correct: isCorrect };
  } else {
    const grade = await gradeFreeTextAnswer({
      prompt: question.prompt,
      reference: question.correctAnswer,
      answer,
    });
    score = grade.score;
    isCorrect = score >= MASTERY_SCORE;
    verdict = grade.verdict;
    missing = grade.missing;
    // Which grader marked it, so a session run while the model was down is
    // visible in the data rather than blamed on the student.
    scoreDetail = { score, grader: grade.grader };
    // The score, not the pass/fail: a half-right short answer should shorten
    // the interval without being scored as a blackout.
    raw = { kind: "QUIZ", similarity: score / 100 };
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
    score,
    verdict,
    missing,
    correctAnswer: question.correctAnswer,
    explanation: question.explanation,
  });
}
