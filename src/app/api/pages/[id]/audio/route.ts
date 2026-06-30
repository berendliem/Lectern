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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await db.page.findUnique({ where: { id } });
  if (!page?.audioFilePath) return jsonError("No audio for this page", 404);

  const buffer = await readFile(absoluteAudioPath(page.audioFilePath));
  const extension = page.audioFilePath.split(".").pop() ?? "";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": mimeTypeForExtension(extension),
      "Content-Length": String(buffer.length),
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
