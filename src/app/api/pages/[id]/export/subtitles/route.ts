import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { buildSrt, buildVtt } from "@/lib/subtitle-export";
import type { TranscriptSegment } from "@/types";

// GET /api/pages/[id]/export/subtitles?format=srt|vtt
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = req.nextUrl.searchParams.get("format") === "vtt" ? "vtt" : "srt";

  const page = await db.page.findUnique({ where: { id }, include: { transcript: true } });
  if (!page) return jsonError("Page not found", 404);
  if (!page.transcript) return jsonError("This page has no transcript to export yet", 422);

  const segments: TranscriptSegment[] = JSON.parse(page.transcript.segments);
  if (segments.length === 0) {
    return jsonError("This transcript has no timestamped segments to export", 422);
  }

  const body = format === "vtt" ? buildVtt(segments) : buildSrt(segments);
  const base = page.title.replace(/[^a-z0-9-_ ]/gi, "").trim() || "transcript";

  return new NextResponse(body, {
    headers: {
      "Content-Type": format === "vtt" ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.${format}"`,
    },
  });
}
