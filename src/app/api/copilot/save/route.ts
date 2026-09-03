import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { saveSessionSchema } from "@/lib/copilot";
import { upsertSearchIndex } from "@/lib/fts";
import { indexSourceSafely } from "@/lib/embeddings";

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

    await indexSourceSafely({ pageId: page.id });

    return NextResponse.json({ pageId: page.id }, { status: 201 });
  } catch {
    return jsonError("Could not save this session as a lecture.", 500);
  }
}
