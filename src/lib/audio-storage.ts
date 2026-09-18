import { mkdir, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export const AUDIO_DIR = path.join(process.cwd(), "storage", "audio");

/**
 * Reduce an untrusted string to a safe filename segment. Some callers pass
 * user-controlled values (e.g. a turnId from form data) as the filename stem,
 * so strip anything that could traverse directories or otherwise escape
 * AUDIO_DIR before it reaches the filesystem.
 */
function safeSegment(value: string, fallback: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 64) : fallback;
}

/** Throws if `absolute` is not contained within AUDIO_DIR. */
function assertInsideAudioDir(absolute: string): void {
  const root = path.resolve(AUDIO_DIR) + path.sep;
  if (!path.resolve(absolute).startsWith(root)) {
    throw new Error("Refusing to access a path outside the audio storage directory");
  }
}

const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  // Video containers: the whisper service (ffmpeg/PyAV) decodes the audio track.
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
};

export function extensionForMimeType(mimeType: string, fallbackName?: string): string {
  if (EXTENSION_BY_MIME[mimeType]) return EXTENSION_BY_MIME[mimeType];
  const fromName = fallbackName?.split(".").pop();
  return fromName && fromName.length <= 5 ? fromName : "bin";
}

const MIME_BY_EXTENSION: Record<string, string> = {
  webm: "audio/webm",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
};

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "mkv", "avi"]);

export function mimeTypeForExtension(extension: string): string {
  return MIME_BY_EXTENSION[extension.toLowerCase()] ?? "application/octet-stream";
}

export function isVideoExtension(extension: string): boolean {
  return VIDEO_EXTENSIONS.has(extension.toLowerCase());
}

export async function saveAudioFile(stem: string, buffer: Buffer, extension: string): Promise<string> {
  await mkdir(AUDIO_DIR, { recursive: true });
  const safeStem = safeSegment(stem, randomUUID());
  const safeExt = safeSegment(extension, "bin").toLowerCase().slice(0, 5);
  const filename = `${safeStem}.${safeExt}`;
  const filePath = path.join(AUDIO_DIR, filename);
  assertInsideAudioDir(filePath);
  await writeFile(filePath, buffer);
  return path.join("storage", "audio", filename);
}

export async function deleteAudioFile(relativePath: string | null): Promise<void> {
  if (!relativePath) return;
  const absolute = path.join(process.cwd(), relativePath);
  try {
    assertInsideAudioDir(absolute);
  } catch {
    return;
  }
  await unlink(absolute).catch(() => undefined);
}

export function absoluteAudioPath(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}
