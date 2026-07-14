import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { saveAudioFile, extensionForMimeType } from "@/lib/audio-storage";
import { transcribeAudio } from "@/lib/whisper-client";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.interviewSession.findUnique({ where: { id } });
  if (!session) return jsonError("Interview session not found", 404);

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof Blob)) {
    return jsonError("Missing audio file", 422);
  }

  const turnIdRaw = formData?.get("turnId");
  const turnId = typeof turnIdRaw === "string" && turnIdRaw.trim() ? turnIdRaw.trim() : null;

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "audio/webm";
  const extension = extensionForMimeType(mimeType, file instanceof File ? file.name : undefined);
  const stem = turnId ?? randomUUID();

  try {
    const relativePath = await saveAudioFile(stem, buffer, extension);
    if (turnId) {
      await db.interviewTurn.updateMany({
        where: { id: turnId, sessionId: id },
        data: { answerAudioPath: relativePath },
      });
    }

    const result = await transcribeAudio(buffer, `answer.${extension}`, mimeType);
    return NextResponse.json({ text: result.text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Transcription failed";
    return jsonError(message, 502);
  }
}
