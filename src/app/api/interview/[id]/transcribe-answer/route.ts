import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { saveAudioFile, extensionForMimeType } from "@/lib/audio-storage";
import { transcribeAudio } from "@/lib/transcribe";

/** Well past a spoken answer; the cap only stops a runaway upload filling the disk. */
const MAX_ANSWER_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.interviewSession.findUnique({ where: { id } });
  if (!session) return jsonError("Interview session not found", 404);

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof Blob)) {
    return jsonError("Missing audio file", 422);
  }
  if (file.size > MAX_ANSWER_BYTES) return jsonError("Recording too large", 413);

  const turnIdRaw = formData?.get("turnId");
  const turnId = typeof turnIdRaw === "string" && turnIdRaw.trim() ? turnIdRaw.trim() : null;
  // Checked before anything is written: a turn id is also a file name.
  if (turnId && !(await db.interviewTurn.findFirst({ where: { id: turnId, sessionId: id }, select: { id: true } }))) {
    return jsonError("Question not found in this session", 404);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "audio/webm";
  const extension = extensionForMimeType(mimeType, file instanceof File ? file.name : undefined);

  try {
    // Kept only when it belongs to a turn: a file no row points to is never shown or deleted.
    if (turnId) {
      // Prefixed so an answer can never overwrite a page's `<pageId>` recording.
      const relativePath = await saveAudioFile(`answer-${turnId}`, buffer, extension);
      await db.interviewTurn.update({ where: { id: turnId }, data: { answerAudioPath: relativePath } });
    }

    const result = await transcribeAudio(buffer, `answer.${extension}`, mimeType);
    return NextResponse.json({ text: result.text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Transcription failed";
    return jsonError(message, 502);
  }
}
