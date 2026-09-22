import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, markStageFailed } from "@/lib/api-utils";
import { absoluteAudioPath, mimeTypeForExtension } from "@/lib/audio-storage";
import { transcribeAudio } from "@/lib/transcribe";
import { upsertSearchIndex } from "@/lib/fts";
import { indexSourceSafely } from "@/lib/embeddings";
import { contextKind, planTranscribeWrite, recordingWouldDestroyImport } from "@/lib/transcript-layer";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id }, include: { transcript: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.audioFilePath) return jsonError("This page has no audio to transcribe yet", 422);
  // Refused before a single second is transcribed: the imported text has no
  // free layer to move down into, so transcribing would overwrite the only
  // copy of it. The Transcript tab hides the recording controls in this state,
  // so reaching here means a stale tab or a direct call.
  if (recordingWouldDestroyImport(page.transcript)) {
    const kind = contextKind(page.transcript?.contextSource);
    return jsonError(
      `Recording here would replace this page's imported transcript, and its ${
        kind === "slides" ? "slides are" : "reading is"
      } already attached. Record on a new lecture page instead.`,
      422
    );
  }

  await db.page.update({ where: { id }, data: { status: "TRANSCRIBING", errorMessage: null } });

  try {
    const buffer = await readFile(absoluteAudioPath(page.audioFilePath));
    const extension = page.audioFilePath.split(".").pop() ?? "";
    // A saved recording is the one place diarization can run: it needs the
    // whole file, which live copilot chunks never have.
    const result = await transcribeAudio(buffer, `audio.${extension}`, mimeTypeForExtension(extension), {
      diarize: true,
    });
    // Which provider actually ran, so a silent fallback to whisper is
    // visible afterwards rather than indistinguishable from a local run.
    const modelUsed =
      result.provider === "apple"
        ? "apple-speech+fluidaudio"
        : (process.env.WHISPER_MODEL_SIZE ?? "small");

    // Imported slide or reading text is not overwritten by a recording: it moves
    // into the context layer, and the notes prompt reads both. cleanText and
    // chapters go either way — see planTranscribeWrite.
    const layer = planTranscribeWrite(page.transcript);

    await db.transcript.upsert({
      where: { pageId: id },
      update: {
        rawText: result.text,
        segments: JSON.stringify(result.segments),
        language: result.language,
        modelUsed,
        ...layer,
      },
      create: {
        pageId: id,
        rawText: result.text,
        segments: JSON.stringify(result.segments),
        language: result.language,
        modelUsed,
      },
    });

    const updated = await db.page.update({
      where: { id },
      data: { status: "TRANSCRIBED", errorMessage: null },
    });
    await upsertSearchIndex(id);

    await indexSourceSafely({ pageId: id });

    return NextResponse.json({ page: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Transcription failed";
    await markStageFailed(id, page.status, message);
    return jsonError(message, 502);
  }
}
