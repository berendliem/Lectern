import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { saveAudioFile, deleteAudioFile } from "@/lib/audio-storage";
import { assertFetchableMediaUrl, downloadAudio, MediaUrlError, YtDlpMissingError } from "@/lib/media-url";
import { mediaUrlSchema } from "@/lib/validation";

/**
 * Fetches the audio of a lecture that lives at a URL — a recorded class on
 * YouTube, a lecture-capture link, an mp3 on a department page — and attaches
 * it to this page as if it had been uploaded. Everything downstream
 * (transcribe, summarize, the guide) then works unchanged.
 *
 * ponytail: the download happens inside the request, so a two-hour lecture is
 * a long-held connection with no progress bar. The backgroundable-tasks work
 * is where this belongs once that lands.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id } });
  if (!page) return jsonError("Page not found", 404);

  const body = await req.json().catch(() => null);
  const result = await withValidation(mediaUrlSchema, body);
  if ("error" in result) return result.error;

  let url: URL;
  try {
    url = assertFetchableMediaUrl(result.data.url);
  } catch (e) {
    if (e instanceof MediaUrlError) return jsonError(e.message, 422);
    throw e;
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "lectern-url-"));
  try {
    const { filePath, title } = await downloadAudio(url, workDir);
    const buffer = await readFile(filePath);

    // Replace any previously stored audio for this page, as an upload does.
    await deleteAudioFile(page.audioFilePath);
    const relativePath = await saveAudioFile(id, buffer, "m4a");

    const updated = await db.page.update({
      where: { id },
      data: {
        audioFilePath: relativePath,
        audioDuration: null,
        status: "DRAFT",
        errorMessage: null,
        // Only fill in a title the student never gave one. A title they typed
        // is theirs, and the source's own is often worse.
        ...(page.title.trim() === "" && title ? { title } : {}),
      },
    });

    return NextResponse.json({ page: updated });
  } catch (e) {
    if (e instanceof YtDlpMissingError) return jsonError(e.message, 503);
    const message = e instanceof Error ? e.message : "Could not fetch the audio from that link";
    return jsonError(message, 502);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
