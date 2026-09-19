import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { deleteAudioFile } from "@/lib/audio-storage";
import { liveToggleSchema } from "@/lib/live-interview";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.interviewSession.findUnique({
    where: { id },
    include: { turns: { orderBy: { order: "asc" } } },
  });
  if (!session) return jsonError("Interview session not found", 404);
  return NextResponse.json({ session });
}

/** "Talk it through" and "Switch to typing": the same session, a different runner. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(liveToggleSchema, body);
  if ("error" in result) return result.error;

  const session = await db.interviewSession.findUnique({ where: { id } });
  if (!session) return jsonError("Interview session not found", 404);

  const updated = await db.interviewSession.update({ where: { id }, data: { live: result.data.live } });
  return NextResponse.json({ session: updated });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.interviewSession.findUnique({
    where: { id },
    include: { turns: true },
  });
  if (!session) return jsonError("Interview session not found", 404);

  for (const turn of session.turns) {
    await deleteAudioFile(turn.answerAudioPath);
  }
  await db.interviewSession.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
