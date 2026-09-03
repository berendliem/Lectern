import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { updatePageSchema } from "@/lib/validation";
import { withValidation, jsonError } from "@/lib/api-utils";
import { deleteAudioFile } from "@/lib/audio-storage";
import { removeFromSearchIndex, upsertSearchIndex } from "@/lib/fts";
import { indexSourceSafely } from "@/lib/embeddings";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({
    where: { id },
    include: {
      folder: true,
      transcript: true,
      notes: true,
      flashcards: { orderBy: { createdAt: "asc" } },
      quizQuestions: { orderBy: { createdAt: "asc" } },
      tags: { include: { tag: true } },
    },
  });
  if (!page) return jsonError("Page not found", 404);
  return NextResponse.json({ page });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(updatePageSchema, body);
  if ("error" in result) return result.error;

  const { notesMarkdown, ...pageFields } = result.data;

  if (notesMarkdown !== undefined) {
    await db.notes.upsert({
      where: { pageId: id },
      update: { markdown: notesMarkdown },
      create: { pageId: id, markdown: notesMarkdown, keyTerms: "[]" },
    });

    await indexSourceSafely({ pageId: id });
  }

  const page = await db.page.update({ where: { id }, data: pageFields });
  await upsertSearchIndex(id);
  return NextResponse.json({ page });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id } });
  if (!page) return jsonError("Page not found", 404);

  await deleteAudioFile(page.audioFilePath);
  await removeFromSearchIndex(id);
  await db.page.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
