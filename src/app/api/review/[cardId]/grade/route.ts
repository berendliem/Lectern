import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { reviewGradeSchema } from "@/lib/validation";
import { scheduleNextReview } from "@/lib/sm2";

export async function POST(req: NextRequest, { params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(reviewGradeSchema, body);
  if ("error" in result) return result.error;

  const card = await db.flashcard.findUnique({ where: { id: cardId } });
  if (!card) return jsonError("Flashcard not found", 404);

  const now = new Date();
  const schedule = scheduleNextReview(card, result.data.quality, now);

  const updated = await db.flashcard.update({
    where: { id: cardId },
    data: { ...schedule, lastReviewedAt: now },
  });

  // Record the review event so the Study Planner can compute streaks and
  // daily review counts (lastReviewedAt only keeps the most recent review).
  await db.reviewLog.create({ data: { flashcardId: cardId, reviewedAt: now } });

  return NextResponse.json({ card: updated });
}
