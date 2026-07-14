import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { absoluteAudioPath, mimeTypeForExtension } from "@/lib/audio-storage";
import { transcribeAudio } from "@/lib/whisper-client";
import { upsertSearchIndex } from "@/lib/fts";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.audioFilePath) return jsonError("This page has no audio to transcribe yet", 422);

  await db.page.update({ where: { id }, data: { status: "TRANSCRIBING", errorMessage: null } });

  try {
    const buffer = await readFile(absoluteAudioPath(page.audioFilePath));
    const extension = page.audioFilePath.split(".").pop() ?? "";
    const result = await transcribeAudio(buffer, `audio.${extension}`, mimeTypeForExtension(extension));

    await db.transcript.upsert({
      where: { pageId: id },
      update: {
        rawText: result.text,
        segments: JSON.stringify(result.segments),
        language: result.language,
        modelUsed: process.env.WHISPER_MODEL_SIZE ?? "small",
      },
      create: {
        pageId: id,
        rawText: result.text,
        segments: JSON.stringify(result.segments),
        language: result.language,
        modelUsed: process.env.WHISPER_MODEL_SIZE ?? "small",
      },
    });

    const updated = await db.page.update({
      where: { id },
      data: { status: "TRANSCRIBED", errorMessage: null },
    });
    await upsertSearchIndex(id);

    return NextResponse.json({ page: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Transcription failed";
    await db.page.update({ where: { id }, data: { status: "ERROR", errorMessage: message } });
    return jsonError(message, 502);
  }
}
