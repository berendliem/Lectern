import { NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { transcribeAudio } from "@/lib/transcribe";

// Stateless transcription for the live-recording preview: takes a short,
// self-contained audio segment and returns its text without persisting
// anything. The authoritative transcript is still produced from the full
// recording by /api/pages/[id]/transcribe after saving.
export async function POST(req: NextRequest) {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof Blob)) return jsonError("Missing audio segment", 422);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await transcribeAudio(buffer, "segment.webm", file.type || "audio/webm");
    return NextResponse.json({ text: result.text });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Live transcription failed";
    return jsonError(message, 502);
  }
}
