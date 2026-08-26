import type { TranscriptSegment } from "@/types";
import { getDictionaryHotwords } from "@/lib/dictionary";

export type TranscribeResult = {
  language: string;
  text: string;
  segments: TranscriptSegment[];
};

export async function transcribeAudio(buffer: Buffer, filename: string, mimeType: string): Promise<TranscribeResult> {
  const baseUrl = process.env.WHISPER_SERVICE_URL;
  if (!baseUrl) {
    throw new Error("WHISPER_SERVICE_URL is not set. Copy .env.example to .env and configure it.");
  }

  const formData = new FormData();
  formData.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);

  // Personal dictionary: bias whisper toward the user's names/acronyms/jargon.
  // Best-effort — a dictionary read failure shouldn't block transcription.
  const hotwords = await getDictionaryHotwords().catch(() => "");
  if (hotwords) formData.append("hotwords", hotwords);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/transcribe`, { method: "POST", body: formData });
  } catch {
    throw new Error(
      `Could not reach the whisper service at ${baseUrl}. Is it running? (cd whisper-service && uvicorn main:app --port 8000)`
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Whisper service returned ${res.status}`);
  }

  return res.json();
}
