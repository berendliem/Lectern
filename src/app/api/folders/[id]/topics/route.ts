import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, withValidation } from "@/lib/api-utils";
import { createTopicSchema } from "@/lib/validation";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const topics = await db.courseTopic.findMany({
    where: { folderId: id },
    orderBy: { order: "asc" },
  });
  return NextResponse.json({ topics });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const folder = await db.folder.findUnique({ where: { id }, select: { id: true } });
  if (!folder) return jsonError("Course not found", 404);

  const body = await req.json().catch(() => null);
  const result = await withValidation(createTopicSchema, body);
  if ("error" in result) return result.error;

  const last = await db.courseTopic.findFirst({
    where: { folderId: id },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const topic = await db.courseTopic.create({
    data: {
      folderId: id,
      title: result.data.title,
      week: result.data.week ?? null,
      order: (last?.order ?? -1) + 1,
    },
  });
  return NextResponse.json({ topic }, { status: 201 });
}
