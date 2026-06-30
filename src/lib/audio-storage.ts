import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const AUDIO_DIR = path.join(process.cwd(), "storage", "audio");

const EXTENSION_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
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
};

export function mimeTypeForExtension(extension: string): string {
  return MIME_BY_EXTENSION[extension.toLowerCase()] ?? "application/octet-stream";
}

export async function saveAudioFile(pageId: string, buffer: Buffer, extension: string): Promise<string> {
  await mkdir(AUDIO_DIR, { recursive: true });
  const filename = `${pageId}.${extension}`;
  const filePath = path.join(AUDIO_DIR, filename);
  await writeFile(filePath, buffer);
  return path.join("storage", "audio", filename);
}

export async function deleteAudioFile(relativePath: string | null): Promise<void> {
  if (!relativePath) return;
  const absolute = path.join(process.cwd(), relativePath);
  await unlink(absolute).catch(() => undefined);
}

export function absoluteAudioPath(relativePath: string): string {
  return path.join(process.cwd(), relativePath);
}
