import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createMaterialSchema } from "@/lib/validation";
import { jsonError, withValidation } from "@/lib/api-utils";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(createMaterialSchema, body);
  if ("error" in result) return result.error;

  const folder = await db.folder.findUnique({ where: { id }, select: { id: true } });
  if (!folder) return jsonError("Course not found", 404);

  // `text` is deliberately not selected here either: a material's body can run
  // to megabytes and the caller only needs the row's metadata back.
  const material = await db.material.create({
    data: { folderId: id, ...result.data },
    select: {
      id: true,
      folderId: true,
      kind: true,
      title: true,
      sourceFileName: true,
      slideCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ material }, { status: 201 });
}
