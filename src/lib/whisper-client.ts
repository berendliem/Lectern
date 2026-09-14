import type { TranscriptSegment } from "@/types";
import { getDictionaryHotwords } from "@/lib/dictionary";
import { postForm } from "@/lib/post-form";

export type TranscribeResult = {
  language: string;
  text: string;
  segments: TranscriptSegment[];
};

/** Errors that mean the service was never reached, as opposed to dying mid-request. */
const UNREACHABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "EADDRNOTAVAIL"]);

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

  // The service answers only once the whole file is transcribed — about 15
  // minutes for a three-hour lecture — so this must not be fetch; see postForm.
  let res: { status: number; body: string };
  try {
    res = await postForm(new URL(`${baseUrl}/transcribe`), formData);
  } catch (e) {
    if (UNREACHABLE_CODES.has((e as NodeJS.ErrnoException).code ?? "")) {
      throw new Error(
        `Could not reach the whisper service at ${baseUrl}. Is it running? (cd whisper-service && uvicorn main:app --port 8000)`
      );
    }
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`The whisper service dropped the connection before finishing: ${reason}`);
  }

  if (res.status < 200 || res.status >= 300) {
    let detail: unknown;
    try {
      detail = JSON.parse(res.body).detail;
    } catch {
      // Not JSON; report the status code instead.
    }
    throw new Error(typeof detail === "string" ? detail : `Whisper service returned ${res.status}`);
  }

  return JSON.parse(res.body);
}
