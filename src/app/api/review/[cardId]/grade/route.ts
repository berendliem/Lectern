import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { reviewGradeSchema } from "@/lib/validation";
import { scheduleNextReview } from "@/lib/sm2";
import { applyCalibrationPenalty } from "@/lib/recall";
import { writeRecallSafely } from "@/lib/recall-log";

export async function POST(req: NextRequest, { params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(reviewGradeSchema, body);
  if ("error" in result) return result.error;

  const card = await db.flashcard.findUnique({ where: { id: cardId } });
  if (!card) return jsonError("Flashcard not found", 404);

  const { quality, typed, confidence } = result.data;

  const now = new Date();
  // SM-2 first, then the one thing SM-2 cannot see: a student who was certain
  // and wrong is not going to come back to this card on their own.
  const schedule = applyCalibrationPenalty(
    scheduleNextReview(card, quality, now),
    confidence,
    quality,
    now
  );

  const updated = await db.flashcard.update({
    where: { id: cardId },
    data: { ...schedule, lastReviewedAt: now },
  });

  // The ledger, not just the streak: this row is what lets a later quiz or
  // blurt on the same lecture argue with the interval just computed.
  await writeRecallSafely({
    raw: { kind: "FLASHCARD", quality },
    flashcardId: cardId,
    pageId: card.pageId,
    materialId: card.materialId,
    confidence,
    detail: typed ? { typed } : undefined,
  });

  return NextResponse.json({ card: updated });
}
