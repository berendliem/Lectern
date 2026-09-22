import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { setPageContextSchema } from "@/lib/validation";
import { IMPORT_TRANSCRIPT_SOURCE, SLIDES_TRANSCRIPT_SOURCE } from "@/lib/prompts/summarize";
import { upsertSearchIndex } from "@/lib/fts";
import { contextKind } from "@/lib/transcript-layer";

// Attaches a course material to a lecture page as its context layer: the slides
// or reading the lecture was delivered over. The other direction — recording
// onto a page made from a material — is handled in the transcribe route, which
// moves the imported text down into these same two columns.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(setPageContextSchema, body);
  if ("error" in result) return result.error;

  const page = await db.page.findUnique({
    where: { id },
    select: {
      id: true,
      folderId: true,
      transcript: { select: { contextText: true, contextSource: true } },
    },
  });
  if (!page) return jsonError("Page not found", 404);
  if (!page.transcript) {
    return jsonError("This page has no transcript to attach context to yet", 422);
  }
  if (page.transcript.contextText !== null && !result.data.replace) {
    const attached = contextKind(page.transcript.contextSource) === "slides" ? "slides" : "a reading";
    return jsonError(`This lecture already has ${attached} attached.`, 409);
  }

  const material = await db.material.findUnique({
    where: { id: result.data.materialId },
    select: { folderId: true, kind: true, text: true },
  });
  if (!material) return jsonError("Material not found", 404);
  // A deck from another course is never the text this lecture was given over,
  // and accepting one would ground every later answer in the wrong course.
  if (material.folderId !== page.folderId) {
    return jsonError("That material belongs to a different course.", 409);
  }

  await db.transcript.update({
    where: { pageId: id },
    data: {
      contextText: material.text,
      contextSource: material.kind === "SLIDES" ? SLIDES_TRANSCRIPT_SOURCE : IMPORT_TRANSCRIPT_SOURCE,
    },
  });

  await upsertSearchIndex(id);

  return NextResponse.json({ ok: true });
}
