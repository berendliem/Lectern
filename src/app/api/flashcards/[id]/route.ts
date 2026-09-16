import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { updateFlashcardSchema } from "@/lib/validation";
import { upsertSearchIndex } from "@/lib/fts";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(updateFlashcardSchema, body);
  if ("error" in result) return result.error;

  // No findUnique pre-check: a regenerate can replace every card between the
  // check and the update, so P2025 is the honest answer.
  try {
    const card = await db.flashcard.update({ where: { id }, data: result.data });
    // Card text is part of the lecture's search row; a material has none.
    if (card.pageId) await upsertSearchIndex(card.pageId);
    return NextResponse.json({ card });
  } catch {
    return jsonError("Flashcard not found — the set may have been regenerated", 404);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    // ReviewLog.flashcardId is SetNull, so the ledger keeps the evidence that
    // this card was once known; only the card's own schedule goes with it.
    const card = await db.flashcard.delete({ where: { id } });
    if (card.pageId) await upsertSearchIndex(card.pageId);
    return NextResponse.json({ ok: true });
  } catch {
    return jsonError("Flashcard not found — the set may have been regenerated", 404);
  }
}
