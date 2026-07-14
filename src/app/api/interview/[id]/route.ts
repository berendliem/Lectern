import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api-utils";
import { deleteAudioFile } from "@/lib/audio-storage";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await db.interviewSession.findUnique({
    where: { id },
    include: { turns: { orderBy: { order: "asc" } } },
  });
  if (!session) return jsonError("Interview session not found", 404);
  return NextResponse.json({ session });
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
