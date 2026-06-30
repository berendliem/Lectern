import type { TranscriptSegment } from "@/types";

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
