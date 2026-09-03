import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createPageFromTextSchema } from "@/lib/validation";
import { withValidation } from "@/lib/api-utils";
import { upsertSearchIndex } from "@/lib/fts";
import { indexSource } from "@/lib/embeddings";

// Creates a lecture page directly from text (pasted notes/readings or text
// extracted from a PDF client-side), skipping the audio → transcription step.
// The text becomes the page's transcript so the existing summarize / flashcard
// / quiz pipeline works on it unchanged.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(createPageFromTextSchema, body);
  if ("error" in result) return result.error;
  const { title, text, folderId, segments, source } = result.data;

  const page = await db.page.create({
    data: { title, folderId, status: "TRANSCRIBED" },
  });

  await db.transcript.create({
    data: {
      pageId: page.id,
      rawText: text,
      segments: JSON.stringify(segments ?? []),
      modelUsed: source ? `import:${source}` : "import",
    },
  });

  await upsertSearchIndex(page.id);

  // Semantic index is best-effort: a failed embedding must not fail the write
  // the user just made. Course ask degrades to FTS when chunks are missing.
  try {
    await indexSource({ pageId: page.id });
  } catch (e) {
    console.error(`[embeddings] indexing page ${page.id} failed:`, e);
  }

  return NextResponse.json({ page }, { status: 201 });
}
