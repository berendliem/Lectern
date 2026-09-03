import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { saveSessionSchema } from "@/lib/copilot";
import { upsertSearchIndex } from "@/lib/fts";
import { indexSource } from "@/lib/embeddings";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const result = await withValidation(saveSessionSchema, body);
  if ("error" in result) return result.error;

  const { title, transcript } = result.data;

  try {
    const page = await db.page.create({
      data: { title, status: "TRANSCRIBED" },
    });

    await db.transcript.create({
      data: {
        pageId: page.id,
        rawText: transcript,
        segments: "[]",
        modelUsed: "live-copilot",
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

    return NextResponse.json({ pageId: page.id }, { status: 201 });
  } catch {
    return jsonError("Could not save this session as a lecture.", 500);
  }
}
