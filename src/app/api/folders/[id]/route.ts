import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { updateFolderSchema } from "@/lib/validation";
import { withValidation } from "@/lib/api-utils";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const result = await withValidation(updateFolderSchema, body);
  if ("error" in result) return result.error;

  const folder = await db.folder.update({ where: { id }, data: result.data });
  return NextResponse.json({ folder });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.folder.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
