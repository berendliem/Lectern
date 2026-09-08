import { spawn } from "node:child_process";
import { access, constants, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { TranscriptSegment } from "@/types";
import { mergeSameSpeaker } from "@/lib/transcript-import";
import { macSpeechResultSchema } from "@/lib/validation";

export type MacSpeechWord = { word: string; start: number; end: number; probability: number };
export type SpeakerSpan = { start: number; end: number; speakerId: string };

/**
 * The Swift CLI. Built by setup.sh into the package's own .build directory;
 * MAC_SPEECH_BIN overrides it for a binary installed elsewhere.
 */
export function macSpeechBinary(): string {
  return process.env.MAC_SPEECH_BIN || path.join(process.cwd(), "mac-speech", ".build", "release", "mac-speech");
}

/**
 * Apple's SpeechAnalyzer reads through AVFoundation, which opens m4a, mp3, wav
 * and the mp4 family but not the webm/opus Chrome's MediaRecorder produces.
 * Those containers get an ffmpeg pass first; everything else is handed over
 * untouched.
 */
const UNREADABLE_CONTAINERS = new Set(["webm", "ogg", "oga", "opus", "mkv", "avi"]);

export function needsConversion(filename: string): boolean {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  return UNREADABLE_CONTAINERS.has(extension);
}

/**
 * The speaker whose span covers a word's midpoint. Midpoint rather than start,
 * so a word straddling a handover is attributed to whoever said most of it.
 * Undefined when no span covers it — the caller decides what to do with that.
 */
export function speakerForMidpoint(word: MacSpeechWord, spans: SpeakerSpan[]): string | undefined {
  const midpoint = (word.start + word.end) / 2;
  return spans.find((span) => midpoint >= span.start && midpoint <= span.end)?.speakerId;
}

/** `S1` / `S2` from the diarizer become the labels a reader sees. */
export function speakerLabel(speakerId: string): string {
  const match = /^S(\d+)$/i.exec(speakerId.trim());
  return match ? `Speaker ${Number(match[1])}` : speakerId.trim();
}

/**
 * Assigns a speaker to every word. A word no span covers inherits the previous
 * word's speaker: a diarization gap is silence or breath, not a third person,
 * and leaving it blank would split one turn into three segments.
 */
export function assignSpeakers(
  words: MacSpeechWord[],
  spans: SpeakerSpan[]
): (MacSpeechWord & { speaker?: string })[] {
  let previous: string | undefined;
  return words.map((word) => {
    const found = speakerForMidpoint(word, spans);
    const speaker = found ? speakerLabel(found) : previous;
    previous = speaker;
    return speaker ? { ...word, speaker } : { ...word };
  });
}

// ponytail: a 1s gap starts a new segment, tuned by ear on lecture speech.
// It only decides where the candidate breaks are — mergeSameSpeaker then
// applies the same 15s window and 1500-char cap an imported transcript gets,
// so the real segment size policy lives in one place.
const PAUSE_BREAK_SEC = 1;

/**
 * Groups words into segments, breaking where the speaker changes or the pause
 * is long enough to read as one, then hands them to the same
 * `mergeSameSpeaker` window imported transcripts use — so a recorded lecture
 * and a Teams export segment identically.
 */
export function wordsToSegments(words: (MacSpeechWord & { speaker?: string })[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  for (const word of words) {
    const text = word.word.trim();
    if (!text) continue;

    const current = segments[segments.length - 1];
    const joinable = current && current.speaker === word.speaker && word.start - current.end <= PAUSE_BREAK_SEC;

    if (joinable) {
      // Apple's runs carry their own leading space; re-space from scratch and
      // keep punctuation tight to the word it follows.
      current.text = `${current.text} ${text}`.replace(/\s+([,.;:!?])/g, "$1");
      current.end = word.end;
      current.words = [...(current.words ?? []), word];
      continue;
    }

    segments.push({
      start: word.start,
      end: word.end,
      text,
      ...(word.speaker ? { speaker: word.speaker } : {}),
      words: [word],
    });
  }

  return mergeSameSpeaker(segments);
}

/** Rejects a binary that is missing or not executable, so the caller can fall back. */
async function assertExecutable(binary: string): Promise<void> {
  try {
    await access(binary, constants.X_OK);
  } catch {
    throw new Error(`mac-speech is not built at ${binary} — run scripts/setup.sh, or set MAC_SPEECH_BIN`);
  }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim().split("\n").at(-1) || `${command} exited with ${code}`));
    });
  });
}

export type MacSpeechOptions = { hotwords?: string; diarize?: boolean };

/**
 * Runs the on-device stack over one audio buffer. Throws on anything the
 * binary cannot do — the dispatcher in transcribe.ts turns that into a whisper
 * fallback rather than an error the user sees.
 */
export async function transcribeWithMacSpeech(
  buffer: Buffer,
  filename: string,
  { hotwords = "", diarize = false }: MacSpeechOptions = {}
): Promise<{ language: string; text: string; segments: TranscriptSegment[] }> {
  const binary = macSpeechBinary();
  await assertExecutable(binary);

  const directory = await mkdtemp(path.join(tmpdir(), "lectern-mac-speech-"));
  const extension = filename.toLowerCase().split(".").pop() || "bin";
  const source = path.join(directory, `audio.${extension}`);

  try {
    await writeFile(source, buffer);

    let audioPath = source;
    if (needsConversion(filename)) {
      audioPath = path.join(directory, "audio.wav");
      // 16 kHz mono is what the diarizer wants anyway, so one pass serves both
      // engines. A missing ffmpeg surfaces here as a spawn error and falls back.
      await run("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", source, "-ac", "1", "-ar", "16000", audioPath]);
    }

    const args = [audioPath];
    if (hotwords.trim()) args.push("--hotwords", hotwords.trim());
    if (process.env.TRANSCRIBE_LOCALE) args.push("--locale", process.env.TRANSCRIBE_LOCALE);
    if (diarize) args.push("--diarize");

    const stdout = await run(binary, args);
    const parsed = macSpeechResultSchema.safeParse(JSON.parse(stdout));
    if (!parsed.success) throw new Error(`mac-speech returned unexpected JSON: ${parsed.error.message}`);

    const { language, text, words, speakerSpans } = parsed.data;
    return { language, text, segments: wordsToSegments(assignSpeakers(words, speakerSpans)) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
