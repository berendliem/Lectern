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
  let card;
  try {
    card = await db.flashcard.update({ where: { id }, data: result.data });
  } catch (e) {
    if (isNotFound(e)) return jsonError("Flashcard not found — the set may have been regenerated", 404);
    throw e;
  }
  // Card text is part of the lecture's search row; a material has none. Outside
  // the catch above: the edit is already saved, and a failed re-index must not
  // be reported back as "your edit was lost".
  if (card.pageId) await upsertSearchIndex(card.pageId);
  return NextResponse.json({ card });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let card;
  try {
    // ReviewLog.flashcardId is SetNull, so the ledger keeps the evidence that
    // this card was once known; only the card's own schedule goes with it.
    card = await db.flashcard.delete({ where: { id } });
  } catch (e) {
    if (isNotFound(e)) return jsonError("Flashcard not found — the set may have been regenerated", 404);
    throw e;
  }
  if (card.pageId) await upsertSearchIndex(card.pageId);
  return NextResponse.json({ ok: true });
}

/** Prisma's "record to update/delete does not exist"; anything else is a real failure. */
function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2025";
}
