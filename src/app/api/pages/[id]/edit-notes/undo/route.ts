import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { upsertSearchIndex } from "@/lib/fts";
import { indexSourceSafely } from "@/lib/embeddings";

// Restores the notes from before the last AI edit. The snapshot lives in the
// database, not the browser, so the undo survives a refresh.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const markdown = await db.$transaction(async (tx) => {
    const notes = await tx.notes.findUnique({ where: { pageId: id }, select: { previousMarkdown: true } });
    if (notes?.previousMarkdown == null) return null;
    await tx.notes.update({
      where: { pageId: id },
      data: { markdown: notes.previousMarkdown, previousMarkdown: null },
    });
    return notes.previousMarkdown;
  });
  if (markdown === null) return jsonError("There is no edit to undo", 409);

  await upsertSearchIndex(id);
  await indexSourceSafely({ pageId: id });

  return NextResponse.json({ markdown });
}
