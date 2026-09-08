import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/transcribe";
import { extensionForMimeType } from "@/lib/audio-storage";

// Transcribes one complete, standalone rolling-recorder clip. Clips that are
// too short/empty (or that fail transcription for any reason) are not fatal
// to the live session: we return 200 with an empty transcript so the client's
// capture loop just keeps going.
export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ text: "" });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ text: "" });
  }

  const mimeType = file.type || "audio/webm";
  const extension = extensionForMimeType(mimeType, file instanceof File ? file.name : undefined);

  try {
    const result = await transcribeAudio(buffer, `clip.${extension}`, mimeType);
    return NextResponse.json({ text: result.text ?? "" });
  } catch {
    return NextResponse.json({ text: "" });
  }
}
