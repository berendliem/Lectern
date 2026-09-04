import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { updateTopicSchema } from "@/lib/validation";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(updateTopicSchema, body);
  if ("error" in result) return result.error;

  const existing = await db.courseTopic.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return jsonError("Topic not found", 404);

  const topic = await db.courseTopic.update({
    where: { id },
    data: {
      ...(result.data.title !== undefined ? { title: result.data.title } : {}),
      ...(result.data.week !== undefined ? { week: result.data.week } : {}),
    },
  });
  return NextResponse.json({ topic });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // deleteMany rather than delete: deleting an already-deleted topic (a
  // double-click, or a second tab) is a no-op, not a 500.
  await db.courseTopic.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
