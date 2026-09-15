import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { reviewSuggestSchema } from "@/lib/validation";
import { gradeFreeTextAnswer } from "@/lib/answer-grade";
import { normalizeQuality } from "@/lib/recall";

/**
 * Scores what the student typed before the reveal, so the card can grade itself
 * instead of asking them to mark their own homework from memory.
 *
 * Separate from the grade route on purpose: the score has to exist before the
 * card is graded, so it cannot ride along on the grade call.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(reviewSuggestSchema, body);
  if ("error" in result) return result.error;

  const card = await db.flashcard.findUnique({
    where: { id: cardId },
    select: { prompt: true, idealExplanation: true },
  });
  if (!card) return jsonError("Flashcard not found", 404);

  const { typed } = result.data;

  const grade = await gradeFreeTextAnswer({
    prompt: card.prompt,
    reference: card.idealExplanation,
    answer: typed,
  });

  return NextResponse.json({
    // The ledger's reading of the score, so an offline overlap grade is capped
    // the same way here as on a quiz answer.
    quality: normalizeQuality({ kind: "QUIZ", score: grade.score, grader: grade.grader }),
    score: grade.score,
    verdict: grade.verdict,
    missing: grade.missing,
    grader: grade.grader,
  });
}
