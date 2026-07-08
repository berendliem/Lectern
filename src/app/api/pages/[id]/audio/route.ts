import { readFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import {
  saveAudioFile,
  extensionForMimeType,
  deleteAudioFile,
  absoluteAudioPath,
  mimeTypeForExtension,
} from "@/lib/audio-storage";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id } });
  if (!page?.audioFilePath) return jsonError("No audio for this page", 404);

  const buffer = await readFile(absoluteAudioPath(page.audioFilePath));
  const extension = page.audioFilePath.split(".").pop() ?? "";
  const contentType = mimeTypeForExtension(extension);

  // Honor single-range requests so <audio>/<video> seeking works reliably —
  // browsers probe with Range and some refuse to seek without a 206.
  const range = req.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    const size = buffer.length;
    let start: number;
    let end: number;
    if (match[1]) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    } else {
      // Suffix range: the last N bytes.
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    }
    if (start > end || start >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    return new NextResponse(new Uint8Array(buffer.subarray(start, end + 1)), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
      },
    });
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(buffer.length),
      "Accept-Ranges": "bytes",
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id } });
  if (!page) return jsonError("Page not found", 404);

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || !(file instanceof Blob)) {
    return jsonError("Missing audio file", 422);
  }

  const durationRaw = formData?.get("durationSeconds");
  const duration = typeof durationRaw === "string" ? Number(durationRaw) : null;

  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = extensionForMimeType(file.type, file instanceof File ? file.name : undefined);

  // Replace any previously stored audio for this page before saving the new file.
  await deleteAudioFile(page.audioFilePath);

  const relativePath = await saveAudioFile(id, buffer, extension);

  const updated = await db.page.update({
    where: { id },
    data: {
      audioFilePath: relativePath,
      audioDuration: duration && Number.isFinite(duration) ? duration : null,
      status: "DRAFT",
      errorMessage: null,
    },
  });

  return NextResponse.json({ page: updated });
}
