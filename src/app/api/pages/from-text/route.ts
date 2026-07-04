import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createPageFromTextSchema } from "@/lib/validation";
import { withValidation } from "@/lib/api-utils";
import { upsertSearchIndex } from "@/lib/fts";

// Creates a lecture page directly from text (pasted notes/readings or text
// extracted from a PDF client-side), skipping the audio → transcription step.
// The text becomes the page's transcript so the existing summarize / flashcard
// / quiz pipeline works on it unchanged.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(createPageFromTextSchema, body);
  if ("error" in result) return result.error;
  const { title, text, folderId } = result.data;

  const page = await db.page.create({
    data: { title, folderId, status: "TRANSCRIBED" },
  });

  await db.transcript.create({
    data: { pageId: page.id, rawText: text, segments: "[]", modelUsed: "import" },
  });

  await upsertSearchIndex(page.id);

  return NextResponse.json({ page }, { status: 201 });
}
