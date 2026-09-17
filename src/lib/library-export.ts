import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { AUDIO_DIR } from "@/lib/audio-storage";

/** Where the live database file is, from the same URL Prisma opens. */
export function databasePath(): string {
  const url = process.env.DATABASE_URL ?? "";
  const file = url.replace(/^file:/, "");
  return path.resolve(process.cwd(), file);
}

export async function libraryStats(): Promise<{ dbBytes: number; audioBytes: number; audioFiles: number }> {
  const dbBytes = await stat(databasePath())
    .then((s) => s.size)
    .catch(() => 0);
  let audioBytes = 0;
  let audioFiles = 0;
  for (const name of await readdir(AUDIO_DIR).catch(() => [] as string[])) {
    const s = await stat(path.join(AUDIO_DIR, name)).catch(() => null);
    if (!s?.isFile() || name.startsWith(".")) continue;
    audioBytes += s.size;
    audioFiles += 1;
  }
  return { dbBytes, audioBytes, audioFiles };
}

/**
 * One tar of everything the app cannot regenerate: a consistent snapshot of
 * the database (`VACUUM INTO`, not a file copy — the app is mid-write) and
 * the audio directory. Uncompressed on purpose: the audio is already
 * compressed, and a plain tar streams as fast as the disk reads.
 *
 * The snapshot lives in a temp directory that is removed when the tar
 * process ends, however it ends.
 */
export async function streamLibraryTar(): Promise<ReadableStream<Uint8Array>> {
  const dir = await mkdtemp(path.join(tmpdir(), "lectern-export-"));
  const snapshot = path.join(dir, "lectern.db");
  try {
    // The path is ours (mkdtemp + a fixed name), never user input.
    await db.$executeRawUnsafe(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
  const child = spawn(
    "tar",
    ["-cf", "-", "-C", dir, "lectern.db", "-C", path.dirname(path.dirname(AUDIO_DIR)), "storage/audio"],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.on("close", (code) => {
    if (code !== 0) console.error(`library export: tar exited ${code}: ${Buffer.concat(stderr).toString("utf8")}`);
    void rm(dir, { recursive: true, force: true });
  });
  return Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
}

export function exportFileName(now = new Date()): string {
  return `lectern-${now.toISOString().slice(0, 10).replace(/-/g, "")}.tar`;
}
