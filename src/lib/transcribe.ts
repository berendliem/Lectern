import { getDictionaryHotwords } from "@/lib/dictionary";
import { transcribeWithMacSpeech } from "@/lib/mac-speech";
import { transcribeAudio as transcribeWithWhisper, type TranscribeResult } from "@/lib/whisper-client";

export type { TranscribeResult };

export type TranscribeOptions = {
  /**
   * Speaker labels, which need the whole file. Saved recordings ask for them;
   * live copilot chunks cannot have them and do not ask.
   */
  diarize?: boolean;
};

export type TranscribeProvider = "whisper" | "apple";

/** Mirrors the LLM_PROVIDER pattern: an unknown value falls back rather than throwing. */
export function transcribeProvider(): TranscribeProvider {
  return process.env.TRANSCRIBE_PROVIDER === "apple" ? "apple" : "whisper";
}

/**
 * Transcribes one audio buffer with whichever provider is configured, and
 * reports which one actually ran so a silent fallback is visible afterwards in
 * `Transcript.modelUsed`.
 *
 * The Apple path is best-effort by design: a machine without the binary, an
 * OS without the Speech model, a webm without ffmpeg, or a diarizer that
 * cannot load its CoreML models all end up on whisper instead of in front of
 * the user as an error.
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  options: TranscribeOptions = {}
): Promise<TranscribeResult & { provider: TranscribeProvider }> {
  if (transcribeProvider() === "apple") {
    try {
      const hotwords = await getDictionaryHotwords().catch(() => "");
      const result = await transcribeWithMacSpeech(buffer, filename, { hotwords, diarize: options.diarize });
      return { ...result, provider: "apple" };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.warn(`[transcribe] on-device transcription unavailable, falling back to whisper: ${reason}`);
    }
  }

  const result = await transcribeWithWhisper(buffer, filename, mimeType);
  return { ...result, provider: "whisper" };
}
