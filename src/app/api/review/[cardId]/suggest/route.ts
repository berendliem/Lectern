import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { reviewSuggestSchema } from "@/lib/validation";
import { embedTexts } from "@/lib/embeddings";
import { cosine } from "@/lib/embed-math";
import { gradeShortAnswer } from "@/lib/grading";
import { suggestQuality } from "@/lib/recall";

/**
 * Scores what the student typed before the reveal, so the card can pre-highlight
 * a grade instead of asking them to mark their own homework from memory.
 *
 * Separate from the grade route on purpose: the suggestion has to exist before
 * the button is pressed, so it cannot ride along on the grade call.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ cardId: string }> }) {
  const { cardId } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(reviewSuggestSchema, body);
  if ("error" in result) return result.error;

  const card = await db.flashcard.findUnique({
    where: { id: cardId },
    select: { idealExplanation: true },
  });
  if (!card) return jsonError("Flashcard not found", 404);

  const { typed } = result.data;

  let similarity: number;
  let grader: "embedding" | "overlap";
  try {
    const [typedVector, idealVector] = await embedTexts([typed, card.idealExplanation]);
    similarity = cosine(typedVector, idealVector);
    grader = "embedding";
  } catch (e) {
    // Every embedding rung failed. The quiz's Jaccard grader is harsher on
    // paraphrase, which is why it is the fallback and not the default — but a
    // rough suggestion beats none, and the student overrides it either way.
    console.error(`[review] embedding a typed recall for card ${cardId} failed:`, e);
    similarity = gradeShortAnswer(typed, card.idealExplanation).similarity;
    grader = "overlap";
  }

  return NextResponse.json({ quality: suggestQuality(similarity), similarity, grader });
}
